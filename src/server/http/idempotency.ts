import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { appConfig } from "../../config/appConfig";
import { prisma } from "../../lib/db";
import { DB_FIELD_LIMITS } from "../contracts/dbFieldLimits";
const IDEMPOTENCY_HEADER_NAME = "Idempotency-Key";
const IN_PROGRESS_STATE = "in_progress";
const COMPLETED_STATE = "completed";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]+$/;
type IdempotencyStore = {
    idempotencyRequest: {
        create: (args: {
            data: {
                accountId: number;
                endpoint: string;
                method: string;
                idempotencyKey: string;
                requestHash: string;
                state: string;
                expiresAt: Date;
            };
        }) => Promise<unknown>;
        findUnique: (args: {
            where: {
                accountId_endpoint_method_idempotencyKey: {
                    accountId: number;
                    endpoint: string;
                    method: string;
                    idempotencyKey: string;
                };
            };
            select: {
                requestHash: true;
                state: true;
                responseStatus: true;
                responseBody: true;
                expiresAt: true;
            };
        }) => Promise<{
            requestHash: string;
            state: string;
            responseStatus: number | null;
            responseBody: Prisma.JsonValue | null;
            expiresAt: Date;
        } | null>;
        update: (args: {
            where: {
                accountId_endpoint_method_idempotencyKey: {
                    accountId: number;
                    endpoint: string;
                    method: string;
                    idempotencyKey: string;
                };
            };
            data: {
                state: string;
                responseStatus: number;
                responseBody: Prisma.InputJsonValue;
                expiresAt: Date;
            };
        }) => Promise<unknown>;
        deleteMany: (args: {
            where: Record<string, unknown>;
        }) => Promise<unknown>;
    };
};
export type IdempotencyExecutionResult<T> = {
    status: number;
    body: T;
    replayed: boolean;
};
type IdempotencyExecutionInput<T> = {
    accountId: number;
    endpoint: string;
    method: "POST" | "PATCH" | "DELETE";
    idempotencyKey: string | null;
    requestHash: string;
    execute: () => Promise<{
        status: number;
        body: T;
    }>;
    store?: IdempotencyStore;
};
class IdempotencyError extends Error {
    code: "VALIDATION" | "CONFLICT";
    status: 400 | 409;
    constructor(code: "VALIDATION" | "CONFLICT", status: 400 | 409, message: string) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
function normalizeForStableStringify(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => normalizeForStableStringify(item));
    }
    if (value && typeof value === "object") {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((accumulator, key) => {
            accumulator[key] = normalizeForStableStringify((value as Record<string, unknown>)[key]);
            return accumulator;
        }, {});
    }
    return value;
}
function stableStringify(value: unknown): string {
    return JSON.stringify(normalizeForStableStringify(value));
}
function toJsonValue<T>(value: T): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function validateIdempotencyKey(idempotencyKey: string): void {
    if (idempotencyKey.length === 0 ||
        idempotencyKey.length > DB_FIELD_LIMITS.idempotency.key ||
        !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
        throw new IdempotencyError("VALIDATION", 400, "Invalid Idempotency-Key header. Use 1-128 chars: letters, numbers, colon, underscore, or dash.");
    }
}
function validateEndpoint(endpoint: string): void {
    if (endpoint.length === 0 || endpoint.length > DB_FIELD_LIMITS.idempotency.endpoint) {
        throw new IdempotencyError("VALIDATION", 400, "Invalid idempotency endpoint identifier.");
    }
}
function validateMethod(method: string): void {
    if (method.length === 0 || method.length > DB_FIELD_LIMITS.idempotency.method) {
        throw new IdempotencyError("VALIDATION", 400, "Invalid idempotency method identifier.");
    }
}
function validateRequestHash(requestHash: string): void {
    if (requestHash.length !== DB_FIELD_LIMITS.idempotency.requestHash) {
        throw new IdempotencyError("VALIDATION", 400, "Invalid idempotency request hash.");
    }
}
function computeInProgressExpiry(now: Date): Date {
    return new Date(now.getTime() + appConfig.apiIdempotencyInProgressTtlSeconds * 1000);
}
function computeReplayExpiry(now: Date): Date {
    return new Date(now.getTime() + appConfig.apiIdempotencyReplayTtlHours * 60 * 60 * 1000);
}
function getCompositeKeyWhere(input: {
    accountId: number;
    endpoint: string;
    method: string;
    idempotencyKey: string;
}) {
    return {
        accountId_endpoint_method_idempotencyKey: {
            accountId: input.accountId,
            endpoint: input.endpoint,
            method: input.method,
            idempotencyKey: input.idempotencyKey
        }
    } as const;
}
async function tryClaimIdempotencyKey(args: {
    store: IdempotencyStore;
    accountId: number;
    endpoint: string;
    method: string;
    idempotencyKey: string;
    requestHash: string;
    now: Date;
}): Promise<boolean> {
    try {
        await args.store.idempotencyRequest.create({
            data: {
                accountId: args.accountId,
                endpoint: args.endpoint,
                method: args.method,
                idempotencyKey: args.idempotencyKey,
                requestHash: args.requestHash,
                state: IN_PROGRESS_STATE,
                expiresAt: computeInProgressExpiry(args.now)
            }
        });
        return true;
    }
    catch (error) {
        const errorCode = error instanceof Prisma.PrismaClientKnownRequestError
            ? error.code
            : (error as {
                code?: string;
            })?.code;
        if (errorCode === "P2002") {
            return false;
        }
        throw error;
    }
}
export function readIdempotencyKeyFromRequest(request: Request): string | null {
    const rawKey = request.headers.get(IDEMPOTENCY_HEADER_NAME);
    if (rawKey === null) {
        return null;
    }
    return rawKey.trim();
}
export function createIdempotencyRequestHash(input: unknown): string {
    return createHash("sha256").update(stableStringify(input)).digest("hex");
}
export async function executeWithIdempotency<T>(input: IdempotencyExecutionInput<T>): Promise<IdempotencyExecutionResult<T>> {
    if (input.idempotencyKey === null) {
        const direct = await input.execute();
        return {
            ...direct,
            replayed: false
        };
    }
    validateIdempotencyKey(input.idempotencyKey);
    validateEndpoint(input.endpoint);
    validateMethod(input.method);
    validateRequestHash(input.requestHash);
    const store = input.store ?? prisma;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const now = new Date();
        const claimed = await tryClaimIdempotencyKey({
            store,
            accountId: input.accountId,
            endpoint: input.endpoint,
            method: input.method,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            now
        });
        if (claimed) {
            try {
                const executed = await input.execute();
                await store.idempotencyRequest.update({
                    where: getCompositeKeyWhere({
                        accountId: input.accountId,
                        endpoint: input.endpoint,
                        method: input.method,
                        idempotencyKey: input.idempotencyKey
                    }),
                    data: {
                        state: COMPLETED_STATE,
                        responseStatus: executed.status,
                        responseBody: toJsonValue(executed.body),
                        expiresAt: computeReplayExpiry(new Date())
                    }
                });
                return {
                    ...executed,
                    replayed: false
                };
            }
            catch (error) {
                await store.idempotencyRequest.deleteMany({
                    where: {
                        accountId: input.accountId,
                        endpoint: input.endpoint,
                        method: input.method,
                        idempotencyKey: input.idempotencyKey,
                        state: IN_PROGRESS_STATE
                    }
                });
                throw error;
            }
        }
        const existing = await store.idempotencyRequest.findUnique({
            where: getCompositeKeyWhere({
                accountId: input.accountId,
                endpoint: input.endpoint,
                method: input.method,
                idempotencyKey: input.idempotencyKey
            }),
            select: {
                requestHash: true,
                state: true,
                responseStatus: true,
                responseBody: true,
                expiresAt: true
            }
        });
        if (!existing) {
            continue;
        }
        if (existing.expiresAt <= now) {
            await store.idempotencyRequest.deleteMany({
                where: {
                    accountId: input.accountId,
                    endpoint: input.endpoint,
                    method: input.method,
                    idempotencyKey: input.idempotencyKey,
                    expiresAt: {
                        lte: now
                    }
                }
            });
            continue;
        }
        if (existing.requestHash !== input.requestHash) {
            throw new IdempotencyError("CONFLICT", 409, "Idempotency key was already used for a different request payload.");
        }
        if (existing.state === COMPLETED_STATE &&
            existing.responseStatus !== null &&
            existing.responseBody !== null) {
            return {
                status: existing.responseStatus,
                body: existing.responseBody as T,
                replayed: true
            };
        }
        throw new IdempotencyError("CONFLICT", 409, "A request with this idempotency key is already in progress. Retry in a few seconds.");
    }
    throw new IdempotencyError("CONFLICT", 409, "Unable to claim idempotency key. Retry with the same key.");
}
export function mapIdempotencyErrorToHttp(error: unknown): {
    status: number;
    message: string;
} {
    if (error instanceof IdempotencyError) {
        return {
            status: error.status,
            message: error.message
        };
    }
    const errorCode = error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : (error as {
            code?: string;
        })?.code;
    if (errorCode === "P2021" || errorCode === "P2022") {
        return {
            status: 503,
            message: "Database schema is out of date for idempotency processing. Run migrations with `npm run db:migrate:deploy` and retry."
        };
    }
    return {
        status: 500,
        message: "Internal server error."
    };
}

import { NextResponse } from "next/server";
import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../../server/http/accountAuth";
import { createIdempotencyRequestHash, executeWithIdempotency, mapIdempotencyErrorToHttp, readIdempotencyKeyFromRequest } from "../../../../../server/http/idempotency";
import { createPromptForConversation, mapPromptErrorToHttp } from "../../../../../server/services/promptService";
function parseConversationId(rawConversationId: string): number {
    const conversationId = Number(rawConversationId);
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
        throw new Error("Invalid conversation id.");
    }
    return conversationId;
}
function mapRouteError(error: unknown): {
    status: number;
    message: string;
} {
    if (error instanceof Error && error.message === "Invalid conversation id.") {
        return {
            status: 400,
            message: "Invalid conversation id."
        };
    }
    const authMapped = mapAccountAuthErrorToHttp(error);
    if (authMapped.status !== 500) {
        return authMapped;
    }
    const idempotencyMapped = mapIdempotencyErrorToHttp(error);
    if (idempotencyMapped.status !== 500) {
        return idempotencyMapped;
    }
    return mapPromptErrorToHttp(error);
}
export async function POST(request: Request, { params }: {
    params: Promise<{
        conversationId: string;
    }>;
}) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const idempotencyKey = readIdempotencyKeyFromRequest(request);
        const routeParams = await params;
        const conversationId = parseConversationId(routeParams.conversationId);
        const payload = await request.json();
        const created = await executeWithIdempotency({
            accountId,
            endpoint: "/api/conversations/[conversationId]/prompts",
            method: "POST",
            idempotencyKey,
            requestHash: createIdempotencyRequestHash({
                conversationId,
                payload
            }),
            execute: async () => {
                const promptResult = await createPromptForConversation(accountId, conversationId, payload);
                return {
                    status: 201,
                    body: promptResult
                };
            }
        });
        return NextResponse.json(created.body, {
            status: created.status,
            headers: idempotencyKey === null
                ? undefined
                : {
                    "X-Idempotency-Replayed": created.replayed ? "true" : "false"
                }
        });
    }
    catch (error) {
        console.error("Prompt API error:", error);
        const mapped = mapRouteError(error);
        const shouldExposeError = process.env.DEBUG_EXPOSE_ERROR_MESSAGES === "true" && error instanceof Error;
        const errorMessage = shouldExposeError ? error.message : mapped.message;
        return NextResponse.json({ error: errorMessage }, { status: mapped.status });
    }
}

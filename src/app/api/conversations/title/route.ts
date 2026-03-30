import { NextResponse } from "next/server";
import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../server/http/accountAuth";
import { createIdempotencyRequestHash, executeWithIdempotency, mapIdempotencyErrorToHttp, readIdempotencyKeyFromRequest } from "../../../../server/http/idempotency";
import { generateConversationTitleFromPrompt, mapConversationTitleErrorToHttp } from "../../../../server/services/conversationTitleService";
function mapRouteError(error: unknown): {
    status: number;
    message: string;
} {
    const authMapped = mapAccountAuthErrorToHttp(error);
    if (authMapped.status !== 500) {
        return authMapped;
    }
    const idempotencyMapped = mapIdempotencyErrorToHttp(error);
    if (idempotencyMapped.status !== 500) {
        return idempotencyMapped;
    }
    return mapConversationTitleErrorToHttp(error);
}
export async function POST(request: Request) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const idempotencyKey = readIdempotencyKeyFromRequest(request);
        const payload = await request.json();
        const result = await executeWithIdempotency({
            accountId,
            endpoint: "/api/conversations/title",
            method: "POST",
            idempotencyKey,
            requestHash: createIdempotencyRequestHash(payload),
            execute: async () => {
                const title = await generateConversationTitleFromPrompt(payload);
                return {
                    status: 200,
                    body: { title }
                };
            }
        });
        return NextResponse.json(result.body, {
            status: result.status,
            headers: idempotencyKey === null
                ? undefined
                : {
                    "X-Idempotency-Replayed": result.replayed ? "true" : "false"
                }
        });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}

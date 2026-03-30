import { NextResponse } from "next/server";
import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../server/http/accountAuth";
import { deleteConversationForAccount, getConversationForAccount, mapConversationErrorToHttp, renameConversationForAccount } from "../../../../server/services/conversationService";
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
    return mapConversationErrorToHttp(error);
}
export async function GET(request: Request, { params }: {
    params: Promise<{
        conversationId: string;
    }>;
}) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const routeParams = await params;
        const conversationId = parseConversationId(routeParams.conversationId);
        const conversation = await getConversationForAccount(accountId, conversationId);
        return NextResponse.json(conversation, { status: 200 });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
export async function DELETE(request: Request, { params }: {
    params: Promise<{
        conversationId: string;
    }>;
}) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const routeParams = await params;
        const conversationId = parseConversationId(routeParams.conversationId);
        const deletedConversation = await deleteConversationForAccount(accountId, conversationId);
        return NextResponse.json(deletedConversation, { status: 200 });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
export async function PATCH(request: Request, { params }: {
    params: Promise<{
        conversationId: string;
    }>;
}) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const routeParams = await params;
        const conversationId = parseConversationId(routeParams.conversationId);
        const payload = await request.json();
        const renamedConversation = await renameConversationForAccount(accountId, conversationId, payload);
        return NextResponse.json(renamedConversation, { status: 200 });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}

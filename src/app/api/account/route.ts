import { NextResponse } from "next/server";
import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../server/http/accountAuth";
import { deleteAccount, mapAuthErrorToHttp } from "../../../server/services/authService";
function mapDeleteAccountError(error: unknown): {
    status: number;
    message: string;
} {
    const authMapped = mapAccountAuthErrorToHttp(error);
    if (authMapped.status !== 500) {
        return authMapped;
    }
    return mapAuthErrorToHttp(error);
}
async function handleDeleteAccountRequest(request: Request) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const payload = await request.json();
        const result = await deleteAccount(accountId, payload);
        return NextResponse.json(result, { status: 200 });
    }
    catch (error) {
        const mapped = mapDeleteAccountError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
export async function DELETE(request: Request) {
    return handleDeleteAccountRequest(request);
}
export async function POST(request: Request) {
    return handleDeleteAccountRequest(request);
}

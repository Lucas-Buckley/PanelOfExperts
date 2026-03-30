import { NextResponse } from "next/server";
import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../server/http/accountAuth";
import { createPanelForAccount, listPanelsForAccount, mapPanelErrorToHttp } from "../../../server/services/panelService";
function mapRouteError(error: unknown): {
    status: number;
    message: string;
} {
    const authMapped = mapAccountAuthErrorToHttp(error);
    if (authMapped.status !== 500) {
        return authMapped;
    }
    return mapPanelErrorToHttp(error);
}
export async function POST(request: Request) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const payload = await request.json();
        const panel = await createPanelForAccount(accountId, payload);
        return NextResponse.json(panel, { status: 201 });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
export async function GET(request: Request) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const panels = await listPanelsForAccount(accountId);
        return NextResponse.json(panels, { status: 200 });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}

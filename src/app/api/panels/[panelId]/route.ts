import { NextResponse } from "next/server";
import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../server/http/accountAuth";
import { deletePanelForAccount, getPanelForAccount, mapPanelErrorToHttp, updatePanelForAccount } from "../../../../server/services/panelService";
function parsePanelId(rawPanelId: string): number {
    const panelId = Number(rawPanelId);
    if (!Number.isInteger(panelId) || panelId <= 0) {
        throw new Error("Invalid panel id.");
    }
    return panelId;
}
function mapRouteError(error: unknown): {
    status: number;
    message: string;
} {
    if (error instanceof Error && error.message === "Invalid panel id.") {
        return {
            status: 400,
            message: "Invalid panel id."
        };
    }
    const authMapped = mapAccountAuthErrorToHttp(error);
    if (authMapped.status !== 500) {
        return authMapped;
    }
    return mapPanelErrorToHttp(error);
}
export async function GET(request: Request, { params }: {
    params: Promise<{
        panelId: string;
    }>;
}) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const routeParams = await params;
        const panelId = parsePanelId(routeParams.panelId);
        const panel = await getPanelForAccount(accountId, panelId);
        return NextResponse.json(panel, { status: 200 });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
export async function PATCH(request: Request, { params }: {
    params: Promise<{
        panelId: string;
    }>;
}) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const routeParams = await params;
        const panelId = parsePanelId(routeParams.panelId);
        const payload = await request.json();
        const panel = await updatePanelForAccount(accountId, panelId, payload);
        return NextResponse.json(panel, { status: 200 });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}
export async function DELETE(request: Request, { params }: {
    params: Promise<{
        panelId: string;
    }>;
}) {
    try {
        const accountId = getAuthenticatedAccountId(request);
        const routeParams = await params;
        const panelId = parsePanelId(routeParams.panelId);
        const deletedPanel = await deletePanelForAccount(accountId, panelId);
        return NextResponse.json(deletedPanel, { status: 200 });
    }
    catch (error) {
        const mapped = mapRouteError(error);
        return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }
}

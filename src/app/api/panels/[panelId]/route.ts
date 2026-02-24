/**
 * Purpose: Handles single-panel API reads with ownership enforcement.
 * Inputs: Authenticated request with bearer token and `panelId` route param.
 * Outputs: JSON panel payload on success or mapped HTTP errors.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../server/http/accountAuth";
import { getPanelForAccount, mapPanelErrorToHttp } from "../../../../server/services/panelService";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function parsePanelId(rawPanelId: string): number {
  /**
   * Purpose: Parses and validates route `panelId` path value.
   * Inputs: Raw string panel id from route params.
   * Outputs: Positive integer panel id or throws validation error.
   */
  const panelId = Number(rawPanelId);
  if (!Number.isInteger(panelId) || panelId <= 0) {
    throw new Error("Invalid panel id.");
  }

  return panelId;
}

function mapRouteError(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Merges auth/panel/parameter errors into stable route HTTP metadata.
   * Inputs: Unknown thrown error.
   * Outputs: HTTP status + safe response message.
   */
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ panelId: string }> }
) {
  /**
   * Purpose: Returns one panel when owned by the authenticated account.
   * Inputs: HTTP request with bearer token + route `panelId`.
   * Outputs: HTTP 200 panel payload or mapped error response.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const routeParams = await params;
    const panelId = parsePanelId(routeParams.panelId);
    const panel = await getPanelForAccount(accountId, panelId);
    return NextResponse.json(panel, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status, headers: NO_STORE_HEADERS }
    );
  }
}

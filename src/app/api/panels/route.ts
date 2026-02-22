/**
 * Purpose: Handles panel collection API routes for create/list operations.
 * Inputs: Authenticated request with bearer token and optional JSON panel payload.
 * Outputs: JSON responses for created/listed panels or mapped HTTP errors.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../server/http/accountAuth";
import {
  createPanelForAccount,
  listPanelsForAccount,
  mapPanelErrorToHttp
} from "../../../server/services/panelService";

function mapRouteError(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Merges auth and panel error mappings into one route-level mapper.
   * Inputs: Unknown thrown error from route dependencies.
   * Outputs: HTTP status + safe message for response body.
   */
  const authMapped = mapAccountAuthErrorToHttp(error);
  if (authMapped.status !== 500) {
    return authMapped;
  }

  return mapPanelErrorToHttp(error);
}

export async function POST(request: Request) {
  /**
   * Purpose: Creates a panel scoped to the authenticated account owner.
   * Inputs: HTTP request with bearer token and panel payload JSON.
   * Outputs: HTTP 201 created panel payload or mapped error.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const payload = await request.json();
    const panel = await createPanelForAccount(accountId, payload);
    return NextResponse.json(panel, { status: 201 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function GET(request: Request) {
  /**
   * Purpose: Lists all panels owned by the authenticated account.
   * Inputs: HTTP request with bearer token.
   * Outputs: HTTP 200 panel list payload or mapped error.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const panels = await listPanelsForAccount(accountId);
    return NextResponse.json(panels, { status: 200 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

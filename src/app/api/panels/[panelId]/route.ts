/**
 * Purpose: Handles single-panel API read/update/delete operations with ownership enforcement.
 * Inputs: Authenticated request with bearer token, `panelId` route param, and optional JSON payload.
 * Outputs: JSON panel payloads or mapped HTTP errors.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../server/http/accountAuth";
import {
  deletePanelForAccount,
  getPanelForAccount,
  mapPanelErrorToHttp,
  updatePanelForAccount
} from "../../../../server/services/panelService";

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
    return NextResponse.json(panel, { status: 200 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ panelId: string }> }
) {
  /**
   * Purpose: Updates one account-owned panel.
   * Inputs: HTTP request with bearer token, route `panelId`, and panel update payload.
   * Outputs: HTTP 200 updated panel payload or mapped error response.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const routeParams = await params;
    const panelId = parsePanelId(routeParams.panelId);
    const payload = await request.json();
    const panel = await updatePanelForAccount(accountId, panelId, payload);
    return NextResponse.json(panel, { status: 200 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ panelId: string }> }
) {
  /**
   * Purpose: Deletes one account-owned panel.
   * Inputs: HTTP request with bearer token and route `panelId`.
   * Outputs: HTTP 200 deleted panel id confirmation or mapped error response.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const routeParams = await params;
    const panelId = parsePanelId(routeParams.panelId);
    const deletedPanel = await deletePanelForAccount(accountId, panelId);
    return NextResponse.json(deletedPanel, { status: 200 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

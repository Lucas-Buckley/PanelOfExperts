/**
 * Purpose: Handles conversation collection API routes for create/list operations.
 * Inputs: Authenticated request with bearer token and JSON conversation payload.
 * Outputs: JSON success/error responses for conversation create/list requests.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../server/http/accountAuth";
import {
  createConversationForAccount,
  listConversationsForPanelForAccount,
  mapConversationErrorToHttp
} from "../../../server/services/conversationService";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function mapRouteError(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Merges auth and conversation service errors for route responses.
   * Inputs: Unknown thrown route error.
   * Outputs: HTTP status/message metadata.
   */
  const authMapped = mapAccountAuthErrorToHttp(error);
  if (authMapped.status !== 500) {
    return authMapped;
  }

  return mapConversationErrorToHttp(error);
}

export async function POST(request: Request) {
  /**
   * Purpose: Creates a conversation under an account-owned panel.
   * Inputs: HTTP request with bearer token and create-conversation JSON payload.
   * Outputs: HTTP 201 created conversation payload or mapped error.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const payload = await request.json();
    const conversation = await createConversationForAccount(accountId, payload);
    return NextResponse.json(conversation, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status, headers: NO_STORE_HEADERS }
    );
  }
}

export async function GET(request: Request) {
  /**
   * Purpose: Lists conversations for one owned panel so UI can show ids for selection.
   * Inputs: HTTP request with bearer token and `panelId` query param.
   * Outputs: HTTP 200 ordered conversation list or mapped error response.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const url = new URL(request.url);
    const panelIdRaw = url.searchParams.get("panelId");
    const panelId = Number(panelIdRaw);

    if (!Number.isInteger(panelId) || panelId <= 0) {
      return NextResponse.json(
        { error: "Invalid panel id." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    const conversations = await listConversationsForPanelForAccount(accountId, { panelId });
    return NextResponse.json(conversations, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status, headers: NO_STORE_HEADERS }
    );
  }
}

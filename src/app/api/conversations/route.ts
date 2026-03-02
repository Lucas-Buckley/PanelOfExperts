/**
 * Purpose: Handles conversation collection API routes for create and list operations.
 * Inputs: Authenticated request with bearer token plus create payload or list query params.
 * Outputs: JSON success/error responses for conversation create/list actions.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../server/http/accountAuth";
import {
  createConversationForAccount,
  listConversationsForPanelForAccount,
  mapConversationErrorToHttp
} from "../../../server/services/conversationService";

function parsePanelIdFromQuery(requestUrl: string): number {
  /**
   * Purpose: Parses and validates `panelId` query string for conversation listing route.
   * Inputs: Absolute request URL string.
   * Outputs: Positive integer panel id or throws validation error.
   */
  const panelIdParam = new URL(requestUrl).searchParams.get("panelId");
  const panelId = Number(panelIdParam);
  if (!panelIdParam || !Number.isInteger(panelId) || panelId <= 0) {
    throw new Error("Invalid panel id.");
  }

  return panelId;
}

function mapRouteError(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Merges auth and conversation service errors for route responses.
   * Inputs: Unknown thrown route error.
   * Outputs: HTTP status/message metadata.
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
    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function GET(request: Request) {
  /**
   * Purpose: Lists conversations for one account-owned panel.
   * Inputs: HTTP request with bearer token and `panelId` query parameter.
   * Outputs: HTTP 200 conversation list payload or mapped error.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const panelId = parsePanelIdFromQuery(request.url);
    const conversations = await listConversationsForPanelForAccount(accountId, panelId);
    return NextResponse.json(conversations, { status: 200 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

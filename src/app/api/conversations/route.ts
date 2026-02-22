/**
 * Purpose: Handles conversation collection API routes for create operations.
 * Inputs: Authenticated request with bearer token and JSON conversation payload.
 * Outputs: JSON success/error responses for conversation creation.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../server/http/accountAuth";
import {
  createConversationForAccount,
  mapConversationErrorToHttp
} from "../../../server/services/conversationService";

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
    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

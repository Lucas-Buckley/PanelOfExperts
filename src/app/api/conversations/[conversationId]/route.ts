/**
 * Purpose: Handles single conversation API reads with ownership checks.
 * Inputs: Authenticated request with bearer token and `conversationId` route param.
 * Outputs: JSON conversation payload or mapped HTTP error response.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../server/http/accountAuth";
import {
  getConversationForAccount,
  mapConversationErrorToHttp
} from "../../../../server/services/conversationService";

function parseConversationId(rawConversationId: string): number {
  /**
   * Purpose: Parses and validates `conversationId` from route path params.
   * Inputs: Raw route param value as string.
   * Outputs: Positive integer conversation id or throws validation error.
   */
  const conversationId = Number(rawConversationId);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    throw new Error("Invalid conversation id.");
  }

  return conversationId;
}

function mapRouteError(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Maps conversation route errors to stable HTTP response metadata.
   * Inputs: Unknown thrown route error.
   * Outputs: HTTP status/message metadata for API response body.
   */
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

export async function GET(
  request: Request,
  { params }: { params: { conversationId: string } }
) {
  /**
   * Purpose: Returns one conversation for authenticated owner with stable ordering.
   * Inputs: HTTP request with bearer token + `conversationId` route param.
   * Outputs: HTTP 200 conversation payload or mapped error response.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const conversationId = parseConversationId(params.conversationId);
    const conversation = await getConversationForAccount(accountId, conversationId);
    return NextResponse.json(conversation, { status: 200 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

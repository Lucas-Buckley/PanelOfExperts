/**
 * Purpose: Handles authenticated conversation-title generation from a user's first prompt.
 * Inputs: Authenticated request with bearer token and prompt payload.
 * Outputs: JSON title response or mapped HTTP error payload.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../server/http/accountAuth";
import {
  generateConversationTitleFromPrompt,
  mapConversationTitleErrorToHttp
} from "../../../../server/services/conversationTitleService";

function mapRouteError(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Merges auth and title-service errors for route responses.
   * Inputs: Unknown thrown route error.
   * Outputs: HTTP status/message metadata.
   */
  const authMapped = mapAccountAuthErrorToHttp(error);
  if (authMapped.status !== 500) {
    return authMapped;
  }

  return mapConversationTitleErrorToHttp(error);
}

export async function POST(request: Request) {
  /**
   * Purpose: Generates a compact conversation title from the first user prompt.
   * Inputs: HTTP request with bearer auth and JSON `{ prompt: string }`.
   * Outputs: HTTP 200 title payload or mapped error response.
   */
  try {
    getAuthenticatedAccountId(request);
    const payload = await request.json();
    const title = await generateConversationTitleFromPrompt(payload);
    return NextResponse.json({ title }, { status: 200 });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}


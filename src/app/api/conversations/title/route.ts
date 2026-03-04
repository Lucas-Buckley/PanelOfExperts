/**
 * Purpose: Handles authenticated conversation-title generation from a user's first prompt.
 * Inputs: Authenticated request with bearer token and prompt payload.
 * Outputs: JSON title response or mapped HTTP error payload.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../server/http/accountAuth";
import {
  createIdempotencyRequestHash,
  executeWithIdempotency,
  mapIdempotencyErrorToHttp,
  readIdempotencyKeyFromRequest
} from "../../../../server/http/idempotency";
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

  const idempotencyMapped = mapIdempotencyErrorToHttp(error);
  if (idempotencyMapped.status !== 500) {
    return idempotencyMapped;
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
    const accountId = getAuthenticatedAccountId(request);
    const idempotencyKey = readIdempotencyKeyFromRequest(request);
    const payload = await request.json();
    const result = await executeWithIdempotency({
      accountId,
      endpoint: "/api/conversations/title",
      method: "POST",
      idempotencyKey,
      requestHash: createIdempotencyRequestHash(payload),
      execute: async () => {
        const title = await generateConversationTitleFromPrompt(payload);
        return {
          status: 200,
          body: { title }
        };
      }
    });
    return NextResponse.json(result.body, {
      status: result.status,
      headers:
        idempotencyKey === null
          ? undefined
          : {
              "X-Idempotency-Replayed": result.replayed ? "true" : "false"
            }
    });
  } catch (error) {
    const mapped = mapRouteError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

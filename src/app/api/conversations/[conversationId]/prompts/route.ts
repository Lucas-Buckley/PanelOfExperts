/**
 * Purpose: Handles prompt creation API for a conversation-owned request flow.
 * Inputs: Authenticated request with bearer token, `conversationId` route param, and prompt payload.
 * Outputs: Persisted prompt + response payload or mapped HTTP error.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../../../server/http/accountAuth";
import {
  createIdempotencyRequestHash,
  executeWithIdempotency,
  mapIdempotencyErrorToHttp,
  readIdempotencyKeyFromRequest
} from "../../../../../server/http/idempotency";
import { createPromptForConversation, mapPromptErrorToHttp } from "../../../../../server/services/promptService";

function parseConversationId(rawConversationId: string): number {
  /**
   * Purpose: Parses and validates `conversationId` from route parameters.
   * Inputs: Raw `conversationId` string from route context.
   * Outputs: Positive integer conversation id, or throws validation error.
   */
  const conversationId = Number(rawConversationId);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    throw new Error("Invalid conversation id.");
  }

  return conversationId;
}

function mapRouteError(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Converts auth/prompt/param errors into route-safe HTTP metadata.
   * Inputs: Unknown thrown route error.
   * Outputs: HTTP status + safe message for JSON error responses.
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

  const idempotencyMapped = mapIdempotencyErrorToHttp(error);
  if (idempotencyMapped.status !== 500) {
    return idempotencyMapped;
  }

  return mapPromptErrorToHttp(error);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  /**
   * Purpose: Creates a prompt and persisted expert responses for an owned conversation.
   * Inputs: HTTP request with bearer token + prompt body + route conversation id.
   * Outputs: HTTP 201 payload containing created prompt and responses.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const idempotencyKey = readIdempotencyKeyFromRequest(request);
    const routeParams = await params;
    const conversationId = parseConversationId(routeParams.conversationId);
    const payload = await request.json();
    const created = await executeWithIdempotency({
      accountId,
      endpoint: "/api/conversations/[conversationId]/prompts",
      method: "POST",
      idempotencyKey,
      requestHash: createIdempotencyRequestHash({
        conversationId,
        payload
      }),
      execute: async () => {
        const promptResult = await createPromptForConversation(accountId, conversationId, payload);
        return {
          status: 201,
          body: promptResult
        };
      }
    });
    return NextResponse.json(created.body, {
      status: created.status,
      headers:
        idempotencyKey === null
          ? undefined
          : {
              "X-Idempotency-Replayed": created.replayed ? "true" : "false"
            }
    });
  } catch (error) {
    console.error("Prompt API error:", error);
    const mapped = mapRouteError(error);
    const shouldExposeError =
      process.env.DEBUG_EXPOSE_ERROR_MESSAGES === "true" && error instanceof Error;
    const errorMessage = shouldExposeError ? error.message : mapped.message;
    return NextResponse.json({ error: errorMessage }, { status: mapped.status });
  }
}

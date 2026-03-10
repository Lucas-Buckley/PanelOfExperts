/**
 * Purpose: Handles forgot-password reset-link requests.
 * Inputs: JSON body with `email`.
 * Outputs: HTTP 202 accepted payload on success, or error response on failure.
 */
import { NextResponse } from "next/server";

import { mapAuthErrorToHttp, requestPasswordReset } from "../../../../server/services/authService";

export async function POST(request: Request) {
  /**
   * Purpose: Creates and delivers a password-reset link for an email address when the feature is available.
   * Inputs: `Request` containing JSON forgot-password payload.
   * Outputs: `NextResponse` with accepted result or mapped error.
   */
  try {
    const payload = await request.json();
    const origin = new URL(request.url).origin;
    const result = await requestPasswordReset(origin, payload);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const mapped = mapAuthErrorToHttp(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

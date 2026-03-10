/**
 * Purpose: Handles one-time password-reset confirmation requests.
 * Inputs: JSON body with `token`, `password`, and `confirmPassword`.
 * Outputs: HTTP 200 reset-success payload on success, or error response on failure.
 */
import { NextResponse } from "next/server";

import { mapAuthErrorToHttp, resetPassword } from "../../../../server/services/authService";

export async function POST(request: Request) {
  /**
   * Purpose: Validates a password-reset token and applies the new password.
   * Inputs: `Request` containing JSON reset-password payload.
   * Outputs: `NextResponse` with reset result or mapped error.
   */
  try {
    const payload = await request.json();
    const result = await resetPassword(payload);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = mapAuthErrorToHttp(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

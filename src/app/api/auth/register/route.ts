/**
 * Purpose: Handles account registration API requests.
 * Inputs: JSON body with `email` and `password`.
 * Outputs: HTTP 201 auth payload on success, or error response on failure.
 */
import { NextResponse } from "next/server";

import { mapAuthErrorToHttp, registerAccount } from "../../../../server/services/authService";

export async function POST(request: Request) {
  /**
   * Purpose: Registers a new account and returns bearer auth payload.
   * Inputs: `Request` containing JSON register payload.
   * Outputs: `NextResponse` with success or mapped error.
   */
  try {
    const payload = await request.json();
    const result = await registerAccount(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const mapped = mapAuthErrorToHttp(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

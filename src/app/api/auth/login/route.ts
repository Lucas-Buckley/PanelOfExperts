/**
 * Purpose: Handles account login API requests.
 * Inputs: JSON body with `email` and `password`.
 * Outputs: HTTP 200 auth payload on success, or error response on failure.
 */
import { NextResponse } from "next/server";

import { loginAccount, mapAuthErrorToHttp } from "../../../../server/services/authService";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  /**
   * Purpose: Authenticates account credentials and returns bearer auth payload.
   * Inputs: `Request` containing JSON login payload.
   * Outputs: `NextResponse` with success or mapped error.
   */
  try {
    const payload = await request.json();
    const result = await loginAccount(payload);
    return NextResponse.json(result, { status: 200, headers: NO_STORE_HEADERS });
  } catch (error) {
    const mapped = mapAuthErrorToHttp(error);
    return NextResponse.json(
      { error: mapped.message },
      { status: mapped.status, headers: NO_STORE_HEADERS }
    );
  }
}

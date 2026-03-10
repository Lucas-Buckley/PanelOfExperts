/**
 * Purpose: Handles authenticated account-deletion API requests.
 * Inputs: Bearer auth plus JSON body with `confirmEmail`.
 * Outputs: HTTP 200 deleted-account payload on success, or mapped error response on failure.
 */
import { NextResponse } from "next/server";

import { getAuthenticatedAccountId, mapAccountAuthErrorToHttp } from "../../../server/http/accountAuth";
import { deleteAccount, mapAuthErrorToHttp } from "../../../server/services/authService";

function mapDeleteAccountError(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Merges auth-token and auth-service errors for the delete-account route.
   * Inputs: Unknown thrown error.
   * Outputs: HTTP status and safe error message for clients.
   */
  const authMapped = mapAccountAuthErrorToHttp(error);
  if (authMapped.status !== 500) {
    return authMapped;
  }

  return mapAuthErrorToHttp(error);
}

export async function DELETE(request: Request) {
  /**
   * Purpose: Deletes the authenticated account after confirming the signed-in email.
   * Inputs: `Request` containing bearer auth and JSON `{ confirmEmail }`.
   * Outputs: `NextResponse` with deleted-account metadata or mapped error.
   */
  try {
    const accountId = getAuthenticatedAccountId(request);
    const payload = await request.json();
    const result = await deleteAccount(accountId, payload);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const mapped = mapDeleteAccountError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

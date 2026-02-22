/**
 * Purpose: Extracts and validates authenticated account identity from bearer tokens.
 * Inputs: Incoming HTTP `Request` with `Authorization` header.
 * Outputs: Authenticated account id, or mapped HTTP auth error metadata.
 */
import { verifyToken } from "../../lib/auth";

class AccountAuthError extends Error {
  status: 401;

  constructor(message: string) {
    super(message);
    this.status = 401;
  }
}

function extractBearerToken(authorizationHeader: string | null): string {
  /**
   * Purpose: Parses a bearer token from the authorization header value.
   * Inputs: Raw `Authorization` header string (or null).
   * Outputs: Bearer token string, or throws on missing/invalid format.
   */
  if (!authorizationHeader) {
    throw new AccountAuthError("Missing Authorization header.");
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    throw new AccountAuthError("Invalid Authorization header.");
  }

  return match[1].trim();
}

export function getAuthenticatedAccountId(request: Request): number {
  /**
   * Purpose: Resolves authenticated account id from bearer JWT subject claim.
   * Inputs: HTTP `Request` with bearer authorization header.
   * Outputs: Numeric account id extracted from verified token payload.
   */
  const token = extractBearerToken(request.headers.get("authorization"));

  let payload: { sub?: unknown };
  try {
    payload = verifyToken(token);
  } catch {
    throw new AccountAuthError("Invalid or expired access token.");
  }

  const rawSubject = payload.sub;
  const accountId = Number(rawSubject);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new AccountAuthError("Token subject is invalid.");
  }

  return accountId;
}

export function mapAccountAuthErrorToHttp(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Maps account-auth exceptions to safe HTTP error metadata.
   * Inputs: Unknown thrown error.
   * Outputs: HTTP status and safe response message.
   */
  if (error instanceof AccountAuthError) {
    return {
      status: error.status,
      message: error.message
    };
  }

  return {
    status: 500,
    message: "Internal server error."
  };
}

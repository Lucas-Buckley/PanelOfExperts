import { verifyToken } from "../../lib/auth";
class AccountAuthError extends Error {
    status: 401;
    constructor(message: string) {
        super(message);
        this.status = 401;
    }
}
function extractBearerToken(authorizationHeader: string | null): string {
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
    const token = extractBearerToken(request.headers.get("authorization"));
    let payload: {
        sub?: unknown;
    };
    try {
        payload = verifyToken(token);
    }
    catch {
        throw new AccountAuthError("Invalid or expired access token.");
    }
    const rawSubject = payload.sub;
    const accountId = Number(rawSubject);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new AccountAuthError("Token subject is invalid.");
    }
    return accountId;
}
export function mapAccountAuthErrorToHttp(error: unknown): {
    status: number;
    message: string;
} {
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

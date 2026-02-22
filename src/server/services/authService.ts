/**
 * Purpose: Implements auth domain logic for account registration and login.
 * Inputs: Unknown request payloads for register/login.
 * Outputs: Auth success payloads with account identity and bearer access token.
 */
import { z } from "zod";

import { hashPassword, normalizeEmail, signToken, verifyPassword } from "../../lib/auth";
import { AUTH_LIMITS, DB_FIELD_LIMITS } from "../contracts/dbFieldLimits";
import { prisma } from "../../lib/db";

const registerSchema = z.object({
  email: z.string().trim().email().max(DB_FIELD_LIMITS.account.email),
  password: z.string().min(AUTH_LIMITS.passwordMin).max(AUTH_LIMITS.passwordMax)
});

const loginSchema = z.object({
  email: z.string().trim().email().max(DB_FIELD_LIMITS.account.email),
  password: z.string().min(1).max(AUTH_LIMITS.passwordMax)
});

type RegisterInput = z.infer<typeof registerSchema>;
type LoginInput = z.infer<typeof loginSchema>;

type AccountIdentity = {
  id: number;
  email: string;
};

export type AuthSuccess = {
  account: AccountIdentity;
  accessToken: string;
  tokenType: "Bearer";
};

class AuthServiceError extends Error {
  code: "VALIDATION" | "CONFLICT" | "INVALID_CREDENTIALS";
  status: 400 | 409 | 401;

  constructor(
    code: "VALIDATION" | "CONFLICT" | "INVALID_CREDENTIALS",
    status: 400 | 409 | 401,
    message: string
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function parseRegisterInput(input: unknown): RegisterInput {
  /**
   * Purpose: Validates and parses account registration input.
   * Inputs: Unknown payload from register request body.
   * Outputs: Typed `RegisterInput`, or throws validation error.
   */
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthServiceError("VALIDATION", 400, "Invalid register payload.");
  }

  return parsed.data;
}

function parseLoginInput(input: unknown): LoginInput {
  /**
   * Purpose: Validates and parses account login input.
   * Inputs: Unknown payload from login request body.
   * Outputs: Typed `LoginInput`, or throws validation error.
   */
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthServiceError("VALIDATION", 400, "Invalid login payload.");
  }

  return parsed.data;
}

function buildAuthSuccess(account: AccountIdentity): AuthSuccess {
  /**
   * Purpose: Builds normalized auth response payload with bearer token.
   * Inputs: Account identity data (`id`, `email`).
   * Outputs: Auth success payload for API responses.
   */
  const accessToken = signToken({
    sub: String(account.id),
    email: account.email
  });

  return {
    account,
    accessToken,
    tokenType: "Bearer"
  };
}

export async function registerAccount(input: unknown): Promise<AuthSuccess> {
  /**
   * Purpose: Registers an account with unique normalized email and bcrypt hash.
   * Inputs: Unknown register request payload.
   * Outputs: Auth success payload for newly created account.
   */
  const parsed = parseRegisterInput(input);
  const email = normalizeEmail(parsed.email);

  const existing = await prisma.account.findUnique({
    where: { email },
    select: { id: true }
  });
  if (existing) {
    throw new AuthServiceError("CONFLICT", 409, "Account already exists.");
  }

  const passwordHash = await hashPassword(parsed.password);
  const account = await prisma.account.create({
    data: {
      email,
      passwordHash
    },
    select: {
      id: true,
      email: true
    }
  });

  return buildAuthSuccess(account);
}

export async function loginAccount(input: unknown): Promise<AuthSuccess> {
  /**
   * Purpose: Authenticates an account and issues a bearer access token.
   * Inputs: Unknown login request payload.
   * Outputs: Auth success payload for authenticated account.
   */
  const parsed = parseLoginInput(input);
  const email = normalizeEmail(parsed.email);

  const account = await prisma.account.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true
    }
  });

  if (!account) {
    throw new AuthServiceError("INVALID_CREDENTIALS", 401, "Invalid email or password.");
  }

  const validPassword = await verifyPassword(parsed.password, account.passwordHash);
  if (!validPassword) {
    throw new AuthServiceError("INVALID_CREDENTIALS", 401, "Invalid email or password.");
  }

  return buildAuthSuccess({
    id: account.id,
    email: account.email
  });
}

export function mapAuthErrorToHttp(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Maps domain/auth errors into stable HTTP response metadata.
   * Inputs: Unknown thrown error.
   * Outputs: HTTP status and safe error message for API clients.
   */
  if (error instanceof AuthServiceError) {
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

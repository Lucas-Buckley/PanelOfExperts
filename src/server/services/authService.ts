/**
 * Purpose: Implements auth/account domain logic for registration, login, account deletion,
 * password-reset requests, and password-reset confirmation.
 * Inputs: Unknown request payloads for register/login/delete-account/password-reset operations.
 * Outputs: Auth success payloads with account identity and bearer access token, deleted-account metadata,
 * and password-reset request/reset results.
 */
import { z } from "zod";

import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  signToken,
  verifyPassword
} from "../../lib/auth";
import { appConfig } from "../../config/appConfig";
import { AUTH_LIMITS, DB_FIELD_LIMITS } from "../contracts/dbFieldLimits";
import { prisma } from "../../lib/db";
import {
  isPasswordResetEmailDeliveryConfigured,
  sendPasswordResetEmail
} from "./passwordResetDeliveryService";

const registerSchema = z.object({
  email: z.string().trim().email().max(DB_FIELD_LIMITS.account.email),
  password: z.string().min(AUTH_LIMITS.passwordMin).max(AUTH_LIMITS.passwordMax)
});

const loginSchema = z.object({
  email: z.string().trim().email().max(DB_FIELD_LIMITS.account.email),
  password: z.string().min(1).max(AUTH_LIMITS.passwordMax)
});

const deleteAccountSchema = z.object({
  confirmEmail: z.string().trim().email().max(DB_FIELD_LIMITS.account.email),
  currentPassword: z.string().min(1).max(AUTH_LIMITS.passwordMax)
});

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(DB_FIELD_LIMITS.account.email)
});

const resetPasswordSchema = z
  .object({
    token: z.string().trim().length(AUTH_LIMITS.resetTokenLength),
    password: z.string().min(AUTH_LIMITS.passwordMin).max(AUTH_LIMITS.passwordMax),
    confirmPassword: z.string().min(AUTH_LIMITS.passwordMin).max(AUTH_LIMITS.passwordMax)
  })
  .superRefine((value, context) => {
    /**
     * Purpose: Ensures reset-password confirmation matches before any DB work occurs.
     * Inputs: Parsed password-reset payload candidate and Zod refinement context.
     * Outputs: No return value; records a validation issue when passwords differ.
     */
    if (value.password !== value.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirmPassword"],
        message: "Passwords do not match."
      });
    }
  });

type RegisterInput = z.infer<typeof registerSchema>;
type LoginInput = z.infer<typeof loginSchema>;
type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

type AccountIdentity = {
  id: number;
  email: string;
};

export type AuthSuccess = {
  account: AccountIdentity;
  accessToken: string;
  tokenType: "Bearer";
};

export type DeletedAccount = {
  id: number;
  email: string;
};

export type PasswordResetRequestResult = {
  accepted: true;
  developmentResetUrl?: string;
};

export type PasswordResetResult = {
  account: AccountIdentity;
};

class AuthServiceError extends Error {
  code:
    | "VALIDATION"
    | "CONFLICT"
    | "INVALID_CREDENTIALS"
    | "NOT_FOUND"
    | "UNAVAILABLE";
  status: 400 | 409 | 401 | 404 | 503;

  constructor(
    code:
      | "VALIDATION"
      | "CONFLICT"
      | "INVALID_CREDENTIALS"
      | "NOT_FOUND"
      | "UNAVAILABLE",
    status: 400 | 409 | 401 | 404 | 503,
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

function parseDeleteAccountInput(input: unknown): DeleteAccountInput {
  /**
   * Purpose: Validates and parses delete-account confirmation input.
   * Inputs: Unknown payload from delete-account request body.
   * Outputs: Typed `DeleteAccountInput`, or throws validation error.
   */
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthServiceError("VALIDATION", 400, "Invalid account deletion payload.");
  }

  return parsed.data;
}

function parsePasswordResetRequestInput(input: unknown): PasswordResetRequestInput {
  /**
   * Purpose: Validates and parses forgot-password request input.
   * Inputs: Unknown payload from forgot-password request body.
   * Outputs: Typed `PasswordResetRequestInput`, or throws validation error.
   */
  const parsed = passwordResetRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthServiceError("VALIDATION", 400, "Invalid password reset request payload.");
  }

  return parsed.data;
}

function parseResetPasswordInput(input: unknown): ResetPasswordInput {
  /**
   * Purpose: Validates and parses reset-password confirmation input.
   * Inputs: Unknown payload from reset-password request body.
   * Outputs: Typed `ResetPasswordInput`, or throws validation error.
   */
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    throw new AuthServiceError("VALIDATION", 400, "Invalid password reset payload.");
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

function buildPasswordResetUrl(origin: string, rawToken: string): string {
  /**
   * Purpose: Builds an absolute reset-password URL pointing back to the login screen.
   * Inputs: Request origin and raw reset token.
   * Outputs: Absolute URL string with `resetToken` query parameter.
   */
  const url = new URL("/", origin);
  url.searchParams.set("resetToken", rawToken);
  return url.toString();
}

function canUseDevelopmentResetFallback(): boolean {
  /**
   * Purpose: Determines whether reset links may be exposed directly for local development/testing.
   * Inputs: None.
   * Outputs: Boolean indicating whether the runtime is non-production.
   */
  return process.env.NODE_ENV !== "production";
}

function ensurePasswordResetDeliveryAvailable(): void {
  /**
   * Purpose: Rejects forgot-password requests when no secure reset-link delivery path exists.
   * Inputs: None.
   * Outputs: No return value; throws when production delivery is unavailable.
   */
  if (isPasswordResetEmailDeliveryConfigured() || canUseDevelopmentResetFallback()) {
    return;
  }

  throw new AuthServiceError(
    "UNAVAILABLE",
    503,
    "Password reset is not configured on this deployment."
  );
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

export async function deleteAccount(accountId: number, input: unknown): Promise<DeletedAccount> {
  /**
   * Purpose: Deletes the authenticated account after server-side confirmation of the signed-in email.
   * Inputs: Authenticated account id plus unknown delete-account confirmation payload.
   * Outputs: Deleted-account metadata for client cleanup messaging.
   */
  const parsed = parseDeleteAccountInput(input);
  const confirmEmail = normalizeEmail(parsed.confirmEmail);

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      email: true,
      passwordHash: true
    }
  });

  if (!account) {
    throw new AuthServiceError("NOT_FOUND", 404, "Account no longer exists.");
  }

  if (confirmEmail !== account.email) {
    throw new AuthServiceError(
      "VALIDATION",
      400,
      "Confirmation email does not match the signed-in account."
    );
  }

  const validPassword = await verifyPassword(parsed.currentPassword, account.passwordHash);
  if (!validPassword) {
    throw new AuthServiceError("INVALID_CREDENTIALS", 401, "Current password is incorrect.");
  }

  const deletedAccount = await prisma.account.delete({
    where: { id: accountId },
    select: {
      id: true,
      email: true
    }
  });

  return deletedAccount;
}

export async function requestPasswordReset(
  origin: string,
  input: unknown
): Promise<PasswordResetRequestResult> {
  /**
   * Purpose: Accepts a forgot-password request, creates a one-time reset token, and delivers it securely.
   * Inputs: Request origin and unknown forgot-password request payload.
   * Outputs: Accepted result with an optional dev-only reset URL for local testing.
   */
  ensurePasswordResetDeliveryAvailable();

  const parsed = parsePasswordResetRequestInput(input);
  const email = normalizeEmail(parsed.email);

  const account = await prisma.account.findUnique({
    where: { email },
    select: {
      id: true,
      email: true
    }
  });

  if (!account) {
    return {
      accepted: true
    };
  }

  const rawToken = generateOpaqueToken();
  const tokenHash = hashOpaqueToken(rawToken);
  const expiresAt = new Date(Date.now() + appConfig.passwordResetTokenTtlMinutes * 60_000);

  await prisma.passwordResetToken.deleteMany({
    where: {
      accountId: account.id
    }
  });

  await prisma.passwordResetToken.create({
    data: {
      accountId: account.id,
      tokenHash,
      expiresAt
    }
  });

  const resetUrl = buildPasswordResetUrl(origin, rawToken);
  if (isPasswordResetEmailDeliveryConfigured()) {
    try {
      await sendPasswordResetEmail({
        toEmail: account.email,
        resetUrl,
        expiresInMinutes: appConfig.passwordResetTokenTtlMinutes
      });
    } catch {
      throw new AuthServiceError(
        "UNAVAILABLE",
        503,
        "Password reset email delivery failed. Try again later."
      );
    }

    return {
      accepted: true
    };
  }

  return {
    accepted: true,
    developmentResetUrl: resetUrl
  };
}

export async function resetPassword(input: unknown): Promise<PasswordResetResult> {
  /**
   * Purpose: Resets an account password from a valid one-time reset token and invalidates old tokens.
   * Inputs: Unknown reset-password payload.
   * Outputs: Account identity for the account whose password was reset.
   */
  const parsed = parseResetPasswordInput(input);
  const tokenHash = hashOpaqueToken(parsed.token);
  const now = new Date();

  const resetTokenRecord = await prisma.passwordResetToken.findUnique({
    where: {
      tokenHash
    },
    select: {
      id: true,
      accountId: true,
      expiresAt: true,
      usedAt: true,
      account: {
        select: {
          id: true,
          email: true
        }
      }
    }
  });

  if (
    !resetTokenRecord ||
    resetTokenRecord.usedAt !== null ||
    resetTokenRecord.expiresAt <= now
  ) {
    throw new AuthServiceError("VALIDATION", 400, "Password reset token is invalid or expired.");
  }

  const passwordHash = await hashPassword(parsed.password);

  await prisma.$transaction(async (transaction) => {
    /**
     * Purpose: Applies the password update and invalidates all outstanding reset tokens atomically.
     * Inputs: Prisma transaction client scoped to the current DB transaction.
     * Outputs: No return value; commits account + token changes together.
     */
    await transaction.account.update({
      where: {
        id: resetTokenRecord.accountId
      },
      data: {
        passwordHash
      }
    });

    await transaction.passwordResetToken.update({
      where: {
        id: resetTokenRecord.id
      },
      data: {
        usedAt: now
      }
    });

    await transaction.passwordResetToken.deleteMany({
      where: {
        accountId: resetTokenRecord.accountId,
        id: {
          not: resetTokenRecord.id
        }
      }
    });
  });

  return {
    account: {
      id: resetTokenRecord.account.id,
      email: resetTokenRecord.account.email
    }
  };
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

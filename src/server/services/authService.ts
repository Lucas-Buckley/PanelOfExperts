import { z } from "zod";
import { generateOpaqueToken, hashOpaqueToken, hashPassword, normalizeEmail, signToken, verifyPassword } from "../../lib/auth";
import { appConfig } from "../../config/appConfig";
import { AUTH_LIMITS, DB_FIELD_LIMITS } from "../contracts/dbFieldLimits";
import { prisma } from "../../lib/db";
import { isPasswordResetEmailDeliveryConfigured, sendPasswordResetEmail } from "./passwordResetDeliveryService";
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
    code: "VALIDATION" | "CONFLICT" | "INVALID_CREDENTIALS" | "NOT_FOUND" | "UNAVAILABLE";
    status: 400 | 409 | 401 | 404 | 503;
    constructor(code: "VALIDATION" | "CONFLICT" | "INVALID_CREDENTIALS" | "NOT_FOUND" | "UNAVAILABLE", status: 400 | 409 | 401 | 404 | 503, message: string) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
function parseRegisterInput(input: unknown): RegisterInput {
    const parsed = registerSchema.safeParse(input);
    if (!parsed.success) {
        throw new AuthServiceError("VALIDATION", 400, "Invalid register payload.");
    }
    return parsed.data;
}
function parseLoginInput(input: unknown): LoginInput {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
        throw new AuthServiceError("VALIDATION", 400, "Invalid login payload.");
    }
    return parsed.data;
}
function parseDeleteAccountInput(input: unknown): DeleteAccountInput {
    const parsed = deleteAccountSchema.safeParse(input);
    if (!parsed.success) {
        throw new AuthServiceError("VALIDATION", 400, "Account deletion requires a valid confirmation email and current password.");
    }
    return parsed.data;
}
function parsePasswordResetRequestInput(input: unknown): PasswordResetRequestInput {
    const parsed = passwordResetRequestSchema.safeParse(input);
    if (!parsed.success) {
        throw new AuthServiceError("VALIDATION", 400, "Invalid password reset request payload.");
    }
    return parsed.data;
}
function parseResetPasswordInput(input: unknown): ResetPasswordInput {
    const parsed = resetPasswordSchema.safeParse(input);
    if (!parsed.success) {
        throw new AuthServiceError("VALIDATION", 400, "Invalid password reset payload.");
    }
    return parsed.data;
}
function buildAuthSuccess(account: AccountIdentity): AuthSuccess {
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
    const url = new URL("/", origin);
    url.searchParams.set("resetToken", rawToken);
    return url.toString();
}
function canUseDevelopmentResetFallback(): boolean {
    return process.env.NODE_ENV !== "production";
}
function ensurePasswordResetDeliveryAvailable(): void {
    if (isPasswordResetEmailDeliveryConfigured() || canUseDevelopmentResetFallback()) {
        return;
    }
    throw new AuthServiceError("UNAVAILABLE", 503, "Password reset is not configured on this deployment.");
}
export async function registerAccount(input: unknown): Promise<AuthSuccess> {
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
        throw new AuthServiceError("VALIDATION", 400, "Confirmation email does not match the signed-in account.");
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
export async function requestPasswordReset(origin: string, input: unknown): Promise<PasswordResetRequestResult> {
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
    const expiresAt = new Date(Date.now() + appConfig.passwordResetTokenTtlMinutes * 60000);
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
        }
        catch {
            throw new AuthServiceError("UNAVAILABLE", 503, "Password reset email delivery failed. Try again later.");
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
    if (!resetTokenRecord ||
        resetTokenRecord.usedAt !== null ||
        resetTokenRecord.expiresAt <= now) {
        throw new AuthServiceError("VALIDATION", 400, "Password reset token is invalid or expired.");
    }
    const passwordHash = await hashPassword(parsed.password);
    await prisma.$transaction(async (transaction) => {
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
export function mapAuthErrorToHttp(error: unknown): {
    status: number;
    message: string;
} {
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

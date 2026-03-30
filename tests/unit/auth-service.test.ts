import { beforeEach, describe, expect, it, vi } from "vitest";
const prismaMock = vi.hoisted(() => ({
    account: {
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
        update: vi.fn()
    },
    passwordResetToken: {
        deleteMany: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn()
    },
    $transaction: vi.fn()
}));
const authMock = vi.hoisted(() => ({
    signToken: vi.fn(() => "mock-access-token"),
    generateOpaqueToken: vi.fn(() => "a".repeat(64))
}));
const deliveryMock = vi.hoisted(() => ({
    isPasswordResetEmailDeliveryConfigured: vi.fn(() => false),
    sendPasswordResetEmail: vi.fn()
}));
vi.mock("../../src/lib/db", () => ({
    prisma: prismaMock
}));
vi.mock("../../src/server/services/passwordResetDeliveryService", () => ({
    isPasswordResetEmailDeliveryConfigured: deliveryMock.isPasswordResetEmailDeliveryConfigured,
    sendPasswordResetEmail: deliveryMock.sendPasswordResetEmail
}));
vi.mock("../../src/lib/auth", async () => {
    const actual = await vi.importActual<typeof import("../../src/lib/auth")>("../../src/lib/auth");
    return {
        ...actual,
        signToken: authMock.signToken,
        generateOpaqueToken: authMock.generateOpaqueToken
    };
});
import { hashOpaqueToken, hashPassword } from "../../src/lib/auth";
import { deleteAccount, loginAccount, mapAuthErrorToHttp, registerAccount, requestPasswordReset, resetPassword } from "../../src/server/services/authService";
beforeEach(() => {
    prismaMock.account.findUnique.mockReset();
    prismaMock.account.create.mockReset();
    prismaMock.account.delete.mockReset();
    prismaMock.account.update.mockReset();
    prismaMock.passwordResetToken.deleteMany.mockReset();
    prismaMock.passwordResetToken.create.mockReset();
    prismaMock.passwordResetToken.findUnique.mockReset();
    prismaMock.passwordResetToken.update.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(async (callback: (transaction: typeof prismaMock) => unknown) => callback({
        account: prismaMock.account,
        passwordResetToken: prismaMock.passwordResetToken
    } as typeof prismaMock));
    authMock.signToken.mockClear();
    authMock.generateOpaqueToken.mockClear();
    deliveryMock.isPasswordResetEmailDeliveryConfigured.mockReset();
    deliveryMock.isPasswordResetEmailDeliveryConfigured.mockReturnValue(false);
    deliveryMock.sendPasswordResetEmail.mockReset();
});
describe("auth service", () => {
    it("rejects invalid register payloads", async () => {
        await expect(registerAccount({
            email: "not-an-email",
            password: "short"
        })).rejects.toMatchObject({
            status: 400
        });
    });
    it("rejects register payload when email exceeds schema length", async () => {
        const oversizedEmail = `${"a".repeat(250)}@x.com`;
        await expect(registerAccount({
            email: oversizedEmail,
            password: "VeryStrongPassword123"
        })).rejects.toMatchObject({
            status: 400
        });
        expect(prismaMock.account.findUnique).not.toHaveBeenCalled();
    });
    it("stores hashed passwords, never plaintext", async () => {
        prismaMock.account.findUnique.mockResolvedValue(null);
        prismaMock.account.create.mockImplementation(async (args: {
            data: {
                email: string;
            };
        }) => ({
            id: 7,
            email: args.data.email
        }));
        const result = await registerAccount({
            email: "User@Example.com",
            password: "VeryStrongPassword123"
        });
        expect(prismaMock.account.create).toHaveBeenCalledTimes(1);
        const createArgs = prismaMock.account.create.mock.calls[0][0] as {
            data: {
                email: string;
                passwordHash: string;
            };
        };
        expect(createArgs.data.email).toBe("user@example.com");
        expect(createArgs.data.passwordHash).not.toBe("VeryStrongPassword123");
        expect(createArgs.data.passwordHash.startsWith("$2")).toBe(true);
        expect(result.accessToken).toBe("mock-access-token");
    });
    it("rejects login when password is incorrect", async () => {
        const storedHash = await hashPassword("CorrectPassword123");
        prismaMock.account.findUnique.mockResolvedValue({
            id: 7,
            email: "user@example.com",
            passwordHash: storedHash
        });
        await expect(loginAccount({
            email: "user@example.com",
            password: "WrongPassword123"
        })).rejects.toMatchObject({
            status: 401
        });
    });
    it("normalizes email and returns bearer payload for valid login", async () => {
        const storedHash = await hashPassword("CorrectPassword123");
        prismaMock.account.findUnique.mockResolvedValue({
            id: 9,
            email: "user@example.com",
            passwordHash: storedHash
        });
        const result = await loginAccount({
            email: " User@Example.com ",
            password: "CorrectPassword123"
        });
        expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
            where: { email: "user@example.com" },
            select: {
                id: true,
                email: true,
                passwordHash: true
            }
        });
        expect(result).toEqual({
            account: { id: 9, email: "user@example.com" },
            accessToken: "mock-access-token",
            tokenType: "Bearer"
        });
    });
    it("creates a development reset URL when email delivery is not configured outside production", async () => {
        prismaMock.account.findUnique.mockResolvedValue({
            id: 9,
            email: "user@example.com"
        });
        prismaMock.passwordResetToken.create.mockResolvedValue({
            id: 1
        });
        const result = await requestPasswordReset("https://panel.test", {
            email: " User@Example.com "
        });
        expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({
            where: {
                accountId: 9
            }
        });
        expect(prismaMock.passwordResetToken.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                accountId: 9,
                tokenHash: hashOpaqueToken("a".repeat(64))
            })
        });
        expect(result).toEqual({
            accepted: true,
            developmentResetUrl: "https://panel.test/?resetToken=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        });
        expect(deliveryMock.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
    it("does not leak missing accounts during password reset requests", async () => {
        prismaMock.account.findUnique.mockResolvedValue(null);
        const result = await requestPasswordReset("https://panel.test", {
            email: "missing@example.com"
        });
        expect(result).toEqual({
            accepted: true
        });
        expect(prismaMock.passwordResetToken.create).not.toHaveBeenCalled();
    });
    it("uses email delivery when password reset email settings are configured", async () => {
        deliveryMock.isPasswordResetEmailDeliveryConfigured.mockReturnValue(true);
        prismaMock.account.findUnique.mockResolvedValue({
            id: 9,
            email: "user@example.com"
        });
        prismaMock.passwordResetToken.create.mockResolvedValue({
            id: 1
        });
        const result = await requestPasswordReset("https://panel.test", {
            email: "user@example.com"
        });
        expect(result).toEqual({
            accepted: true
        });
        expect(deliveryMock.sendPasswordResetEmail).toHaveBeenCalledWith({
            toEmail: "user@example.com",
            resetUrl: "https://panel.test/?resetToken=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            expiresInMinutes: 30
        });
    });
    it("rejects password reset requests in production when secure delivery is not configured", async () => {
        vi.stubEnv("NODE_ENV", "production");
        try {
            await expect(requestPasswordReset("https://panel.test", {
                email: "user@example.com"
            })).rejects.toMatchObject({
                status: 503
            });
        }
        finally {
            vi.unstubAllEnvs();
        }
    });
    it("resets password for a valid token and invalidates other tokens", async () => {
        prismaMock.passwordResetToken.findUnique.mockResolvedValue({
            id: 17,
            accountId: 9,
            expiresAt: new Date(Date.now() + 60000),
            usedAt: null,
            account: {
                id: 9,
                email: "user@example.com"
            }
        });
        const result = await resetPassword({
            token: "a".repeat(64),
            password: "EvenStrongerPassword123",
            confirmPassword: "EvenStrongerPassword123"
        });
        expect(prismaMock.passwordResetToken.findUnique).toHaveBeenCalledWith({
            where: {
                tokenHash: hashOpaqueToken("a".repeat(64))
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
        expect(prismaMock.account.update).toHaveBeenCalledTimes(1);
        const updateArgs = prismaMock.account.update.mock.calls[0][0] as {
            data: {
                passwordHash: string;
            };
        };
        expect(updateArgs.data.passwordHash).not.toBe("EvenStrongerPassword123");
        expect(updateArgs.data.passwordHash.startsWith("$2")).toBe(true);
        expect(prismaMock.passwordResetToken.update).toHaveBeenCalledWith({
            where: {
                id: 17
            },
            data: {
                usedAt: expect.any(Date)
            }
        });
        expect(prismaMock.passwordResetToken.deleteMany).toHaveBeenCalledWith({
            where: {
                accountId: 9,
                id: {
                    not: 17
                }
            }
        });
        expect(result).toEqual({
            account: {
                id: 9,
                email: "user@example.com"
            }
        });
    });
    it("rejects invalid or expired reset tokens", async () => {
        prismaMock.passwordResetToken.findUnique.mockResolvedValue(null);
        await expect(resetPassword({
            token: "a".repeat(64),
            password: "EvenStrongerPassword123",
            confirmPassword: "EvenStrongerPassword123"
        })).rejects.toMatchObject({
            status: 400
        });
        expect(prismaMock.account.update).not.toHaveBeenCalled();
    });
    it("deletes account when confirmation email matches the signed-in account", async () => {
        const storedHash = await hashPassword("CorrectPassword123");
        prismaMock.account.findUnique.mockResolvedValue({
            id: 9,
            email: "user@example.com",
            passwordHash: storedHash
        });
        prismaMock.account.delete.mockResolvedValue({
            id: 9,
            email: "user@example.com"
        });
        const result = await deleteAccount(9, {
            confirmEmail: " User@Example.com ",
            currentPassword: "CorrectPassword123"
        });
        expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
            where: { id: 9 },
            select: {
                id: true,
                email: true,
                passwordHash: true
            }
        });
        expect(prismaMock.account.delete).toHaveBeenCalledWith({
            where: { id: 9 },
            select: {
                id: true,
                email: true
            }
        });
        expect(result).toEqual({
            id: 9,
            email: "user@example.com"
        });
    });
    it("rejects account deletion when confirmation email does not match", async () => {
        const storedHash = await hashPassword("CorrectPassword123");
        prismaMock.account.findUnique.mockResolvedValue({
            id: 9,
            email: "user@example.com",
            passwordHash: storedHash
        });
        await expect(deleteAccount(9, {
            confirmEmail: "other@example.com",
            currentPassword: "CorrectPassword123"
        })).rejects.toMatchObject({
            status: 400
        });
        expect(prismaMock.account.delete).not.toHaveBeenCalled();
    });
    it("rejects account deletion when current password is incorrect", async () => {
        const storedHash = await hashPassword("CorrectPassword123");
        prismaMock.account.findUnique.mockResolvedValue({
            id: 9,
            email: "user@example.com",
            passwordHash: storedHash
        });
        await expect(deleteAccount(9, {
            confirmEmail: "user@example.com",
            currentPassword: "WrongPassword123"
        })).rejects.toMatchObject({
            status: 401
        });
        expect(prismaMock.account.delete).not.toHaveBeenCalled();
    });
    it("rejects account deletion when the account no longer exists", async () => {
        prismaMock.account.findUnique.mockResolvedValue(null);
        await expect(deleteAccount(9, {
            confirmEmail: "user@example.com",
            currentPassword: "CorrectPassword123"
        })).rejects.toMatchObject({
            status: 404
        });
        expect(prismaMock.account.delete).not.toHaveBeenCalled();
    });
    it("maps unknown errors to 500", () => {
        const mapped = mapAuthErrorToHttp(new Error("boom"));
        expect(mapped).toEqual({
            status: 500,
            message: "Internal server error."
        });
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  account: {
    findUnique: vi.fn(),
    create: vi.fn()
  }
}));

const authMock = vi.hoisted(() => ({
  signToken: vi.fn(() => "mock-access-token")
}));

vi.mock("../../src/lib/db", () => ({
  prisma: prismaMock
}));

vi.mock("../../src/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/auth")>("../../src/lib/auth");

  return {
    ...actual,
    signToken: authMock.signToken
  };
});

import { hashPassword } from "../../src/lib/auth";
import { loginAccount, mapAuthErrorToHttp, registerAccount } from "../../src/server/services/authService";

beforeEach(() => {
  prismaMock.account.findUnique.mockReset();
  prismaMock.account.create.mockReset();
  authMock.signToken.mockClear();
});

describe("auth service", () => {
  it("rejects invalid register payloads", async () => {
    await expect(
      registerAccount({
        email: "not-an-email",
        password: "short"
      })
    ).rejects.toMatchObject({
      status: 400
    });
  });

  it("rejects register payload when email exceeds schema length", async () => {
    const oversizedEmail = `${"a".repeat(250)}@x.com`;

    await expect(
      registerAccount({
        email: oversizedEmail,
        password: "VeryStrongPassword123"
      })
    ).rejects.toMatchObject({
      status: 400
    });
    expect(prismaMock.account.findUnique).not.toHaveBeenCalled();
  });

  it("stores hashed passwords, never plaintext", async () => {
    prismaMock.account.findUnique.mockResolvedValue(null);
    prismaMock.account.create.mockImplementation(async (args: { data: { email: string } }) => ({
      id: 7,
      email: args.data.email
    }));

    const result = await registerAccount({
      email: "User@Example.com",
      password: "VeryStrongPassword123"
    });

    expect(prismaMock.account.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.account.create.mock.calls[0][0] as {
      data: { email: string; passwordHash: string };
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

    await expect(
      loginAccount({
        email: "user@example.com",
        password: "WrongPassword123"
      })
    ).rejects.toMatchObject({
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

  it("maps unknown errors to 500", () => {
    const mapped = mapAuthErrorToHttp(new Error("boom"));
    expect(mapped).toEqual({
      status: 500,
      message: "Internal server error."
    });
  });
});

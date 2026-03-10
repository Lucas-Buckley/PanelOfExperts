import { describe, expect, it } from "vitest";

import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  normalizeEmail,
  verifyPassword
} from "../../src/lib/auth";

describe("auth helpers", () => {
  it("normalizes email to trimmed lowercase", () => {
    expect(normalizeEmail("  TeSt@Example.COM ")).toBe("test@example.com");
  });

  it("hashes and verifies password", async () => {
    const hash = await hashPassword("super-secret");

    expect(hash).not.toBe("super-secret");
    await expect(verifyPassword("super-secret", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-pass", hash)).resolves.toBe(false);
  });

  it("generates and hashes opaque tokens for reset flows", () => {
    const token = generateOpaqueToken();
    const hashed = hashOpaqueToken(token);

    expect(token).toHaveLength(64);
    expect(hashed).toHaveLength(64);
    expect(hashed).not.toBe(token);
  });
});

import { describe, expect, it } from "vitest";

import { hashPassword, normalizeEmail, verifyPassword } from "../../src/lib/auth";

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
});

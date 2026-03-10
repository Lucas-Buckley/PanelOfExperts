import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const schemaPath = path.resolve(process.cwd(), "prisma/schema.prisma");
const schema = fs.readFileSync(schemaPath, "utf8");

describe("prisma schema", () => {
  it("defines all core models", () => {
    for (const model of [
      "Account",
      "Panel",
      "Expert",
      "Conversation",
      "Prompt",
      "Response",
      "LlmUsageDaily",
      "IdempotencyRequest",
      "PasswordResetToken"
    ]) {
      expect(schema).toContain(`model ${model} {`);
    }
  });

  it("uses PostgreSQL datasource", () => {
    expect(schema).toContain('provider = "postgresql"');
  });

  it("stores password with long hash capacity", () => {
    expect(schema).toMatch(
      /passwordHash\s+String\s+@map\("password"\)\s+@db\.VarChar\(255\)/
    );
  });

  it("contains expected relation fields", () => {
    for (const relationField of [
      '@map("account_id")',
      '@map("panel_id")',
      '@map("conversation_id")',
      '@map("prompt_id")',
      '@map("expert_id")'
    ]) {
      expect(schema).toContain(relationField);
    }
  });

  it("maps tables to ERD table names", () => {
    for (const table of [
      "account",
      "panel",
      "expert",
      "conversation",
      "prompt",
      "response",
      "llm_usage_daily",
      "idempotency_request",
      "password_reset_token"
    ]) {
      expect(schema).toContain(`@@map("${table}")`);
    }
  });

  it("uses 255-length varchars for key short text fields", () => {
    for (const field of [
      "@db.VarChar(255)"
    ]) {
      expect(schema).toContain(field);
    }
    expect(schema.match(/@db\.VarChar\(255\)/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it("adds timestamp fields for prompt/response ordering", () => {
    expect(schema).toContain('createdAt      DateTime     @default(now()) @map("created_at")');
    expect(schema).toContain('createdAt DateTime @default(now()) @map("created_at")');
    expect(schema).toContain('@@index([createdAt])');
  });

  it("uses explicit sequence fields for deterministic ordering", () => {
    expect(schema).toContain("position       Int");
    expect(schema).toContain("sequence       Int");
    expect(schema).toContain("sequence  Int");
    expect(schema).toContain("@@unique([panelId, position])");
    expect(schema).toContain("@@unique([conversationId, sequence])");
    expect(schema).toContain("@@unique([promptId, sequence])");
  });

  it("stores indexed last-prompted timestamps for efficient recency ordering", () => {
    expect(schema).toContain('lastPromptedAt DateTime?      @map("last_prompted_at")');
    expect(schema).toContain('lastPromptedAt DateTime? @map("last_prompted_at")');
    const indexCount = schema.match(/@@index\(\[lastPromptedAt\]\)/g)?.length ?? 0;
    expect(indexCount).toBeGreaterThanOrEqual(2);
  });

  it("stores llm usage totals for prompt-level accounting and daily caps", () => {
    expect(schema).toContain('llmInputTokens Int          @default(0) @map("llm_input_tokens")');
    expect(schema).toContain('llmOutputTokens Int         @default(0) @map("llm_output_tokens")');
    expect(schema).toContain('llmTotalTokens Int          @default(0) @map("llm_total_tokens")');
    expect(schema).toContain('usageDate  DateTime @map("usage_date") @db.Date');
    expect(schema).toContain('usedTokens Int      @default(0) @map("used_tokens")');
    expect(schema).toContain("@@id([usageDate, model])");
  });

  it("stores hashed password reset tokens with expiry and cascade ownership", () => {
    expect(schema).toContain('tokenHash String   @map("token_hash") @db.VarChar(64)');
    expect(schema).toContain('expiresAt DateTime @map("expires_at")');
    expect(schema).toContain('usedAt    DateTime? @map("used_at")');
    expect(schema).toContain('passwordResetTokens PasswordResetToken[]');
    expect(schema).toContain('@@map("password_reset_token")');
  });
});

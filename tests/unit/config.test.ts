import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function importFreshConfigModule() {
  /**
   * Purpose: Reloads config module with current test environment values.
   * Inputs: None.
   * Outputs: Freshly imported `appConfig` module.
   */
  vi.resetModules();
  return import("../../src/config/appConfig");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("app config", () => {
  it("falls back to file-config default mode when env mode is invalid", async () => {
    process.env.LLM_MODE = "invalid-mode";
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";

    const mod = await importFreshConfigModule();
    expect(mod.appConfig.llmMode).toBe("simulated");
  });

  it("enforces pinned model", async () => {
    process.env.OPENAI_MODEL = "gpt-4.1-mini";

    await expect(importFreshConfigModule()).rejects.toThrow("Model must be pinned");
  });

  it("uses boolean env override for llm enabled", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_ENABLED = "false";

    const mod = await importFreshConfigModule();
    expect(mod.appConfig.llmEnabled).toBe(false);
  });

  it("loads orchestration config and allows env overrides", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_RUNNER_RETRY_ATTEMPTS = "2";
    process.env.LLM_RUNNER_RETRY_BACKOFF_MS = "50";
    process.env.LLM_HISTORY_PROMPT_FETCH_LIMIT = "40";
    process.env.LLM_HISTORY_CHAR_BUDGET = "15000";

    const mod = await importFreshConfigModule();
    expect(mod.appConfig.llmRunnerRetryAttempts).toBe(2);
    expect(mod.appConfig.llmRunnerRetryBackoffMs).toBe(50);
    expect(mod.appConfig.llmHistoryPromptFetchLimit).toBe(40);
    expect(mod.appConfig.llmHistoryCharBudget).toBe(15000);
  });
});

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

  it("loads safety caps and allows env overrides", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MAX_EXPERTS_PER_PANEL = "3";
    process.env.LLM_MAX_USER_PROMPT_CHARS = "2500";
    process.env.LLM_MAX_REQUEST_PROMPT_CHARS = "9000";
    process.env.LLM_MAX_LIVE_OUTPUT_TOKENS = "250";

    const mod = await importFreshConfigModule();
    expect(mod.appConfig.llmMaxExpertsPerPanel).toBe(3);
    expect(mod.appConfig.llmMaxUserPromptChars).toBe(2500);
    expect(mod.appConfig.llmMaxRequestPromptChars).toBe(9000);
    expect(mod.appConfig.llmMaxLiveOutputTokens).toBe(250);
  });

  it("rejects config when request prompt cap is lower than user prompt cap", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MAX_USER_PROMPT_CHARS = "5000";
    process.env.LLM_MAX_REQUEST_PROMPT_CHARS = "4000";

    await expect(importFreshConfigModule()).rejects.toThrow(
      "LLM_MAX_REQUEST_PROMPT_CHARS must be greater than or equal to LLM_MAX_USER_PROMPT_CHARS"
    );
  });
});

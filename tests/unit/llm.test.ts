import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function importFreshLlmModule() {
  vi.resetModules();
  return import("../../src/lib/llm");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("llm provider", () => {
  it("simulated mode returns api-like response shape", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MODE = "simulated";
    process.env.LLM_ENABLED = "true";
    process.env.LLM_SIM_FAILURE_RATE = "0";
    process.env.LLM_SIM_MIN_LATENCY_MS = "1";
    process.env.LLM_SIM_MAX_LATENCY_MS = "1";

    const { generateResponse } = await importFreshLlmModule();
    const result = await generateResponse({ prompt: "hello" });

    expect(result.content).toContain("[SIMULATED:gpt-5-nano-2025-08-07]");
    expect(result.request_id.startsWith("sim_")).toBe(true);
    expect(result.usage.input_tokens).toBeGreaterThan(0);
    expect(result.usage.output_tokens).toBeGreaterThan(0);
    expect(result.usage.total_tokens).toBe(
      result.usage.input_tokens + result.usage.output_tokens
    );
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("rejects model overrides that violate pinning", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MODE = "simulated";
    process.env.LLM_ENABLED = "true";

    const { generateResponse } = await importFreshLlmModule();

    await expect(
      generateResponse({ prompt: "hello", model: "gpt-4.1-mini" })
    ).rejects.toThrow("Model must be pinned");
  });

  it("fails fast when llm is disabled", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MODE = "simulated";
    process.env.LLM_ENABLED = "false";

    const { generateResponse } = await importFreshLlmModule();

    await expect(generateResponse({ prompt: "hello" })).rejects.toThrow(
      "LLM is disabled"
    );
  });
});

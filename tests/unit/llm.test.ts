import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

async function importFreshLlmModule() {
  /**
   * Purpose: Reloads LLM module after env mutations in each test case.
   * Inputs: None.
   * Outputs: Freshly imported LLM module exports.
   */
  vi.resetModules();
  return import("../../src/lib/llm");
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.doUnmock("openai");
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

  it("fails when request prompt exceeds configured max chars", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MODE = "simulated";
    process.env.LLM_ENABLED = "true";
    process.env.LLM_MAX_REQUEST_PROMPT_CHARS = "500";
    process.env.LLM_MAX_USER_PROMPT_CHARS = "500";

    const { generateResponse } = await importFreshLlmModule();
    const oversizedPrompt = "x".repeat(501);

    await expect(generateResponse({ prompt: oversizedPrompt })).rejects.toThrow(
      "LLM prompt exceeds max request size"
    );
  });

  it("extracts live text from response output message parts when output_text is empty", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MODE = "simulated";
    process.env.LLM_ENABLED = "true";

    const { extractLiveResponseContent } = await importFreshLlmModule();

    const extracted = extractLiveResponseContent({
      output_text: "",
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "First line." },
            { type: "output_text", text: "Second line." }
          ]
        }
      ]
    });

    expect(extracted).toBe("First line.\n\nSecond line.");
  });

  it("returns empty string when no live text is available", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MODE = "simulated";
    process.env.LLM_ENABLED = "true";

    const { extractLiveResponseContent } = await importFreshLlmModule();

    const extracted = extractLiveResponseContent({
      output_text: "   ",
      output: [{ type: "function_call", content: [] }]
    });

    expect(extracted).toBe("");
  });

  it("retries live generation once when no text is returned due to max_output_tokens", async () => {
    process.env.OPENAI_MODEL = "gpt-5-nano-2025-08-07";
    process.env.LLM_MODE = "live";
    process.env.LLM_ENABLED = "true";
    process.env.OPENAI_API_KEY = "test-key";

    const createMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: "resp_first",
        output_text: "",
        incomplete_details: { reason: "max_output_tokens" },
        usage: {
          input_tokens: 40,
          output_tokens: 300,
          total_tokens: 340
        }
      })
      .mockResolvedValueOnce({
        id: "resp_second",
        output_text: "Recovered response text.",
        usage: {
          input_tokens: 30,
          output_tokens: 60,
          total_tokens: 90
        }
      });

    vi.doMock("openai", () => ({
      default: class OpenAI {
        responses = {
          create: createMock
        };
      }
    }));

    const { generateResponse } = await importFreshLlmModule();
    const result = await generateResponse({ prompt: "Explain the trolley problem." });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0]?.[0]).toMatchObject({
      reasoning: { effort: "minimal" },
      text: { verbosity: "low" }
    });
    expect(createMock.mock.calls[1]?.[0].input).toContain(
      "Output length requirement for this retry:"
    );
    expect(result.request_id).toBe("resp_second");
    expect(result.content).toBe("Recovered response text.");
    expect(result.usage).toEqual({
      input_tokens: 70,
      output_tokens: 360,
      total_tokens: 430
    });
  });
});

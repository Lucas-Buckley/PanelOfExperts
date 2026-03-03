/**
 * Purpose: Verifies panel-runner prompt composition and deterministic expert-loop behavior.
 * Inputs: Mocked expert/prompt history fixtures and mocked LLM responses.
 * Outputs: Assertions proving first-turn/follow-up composition, execution order, and mode-invariant behavior.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

type GenerateResponseMock = (input: { prompt: string; model?: string }) => Promise<{
  request_id: string;
  content: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  latency_ms: number;
}>;

async function importPanelRunnerWithMock(
  mode: "simulated" | "live",
  generateResponseMock: GenerateResponseMock
) {
  /**
   * Purpose: Imports a fresh panel-runner module with controlled LLM mode and mocked provider calls.
   * Inputs: Target LLM mode and mocked generateResponse implementation.
   * Outputs: Fresh panel-runner module exports bound to mocked LLM function.
   */
  vi.resetModules();
  process.env = {
    ...originalEnv,
    OPENAI_MODEL: "gpt-5-nano-2025-08-07",
    LLM_ENABLED: "true",
    LLM_MODE: mode,
    LLM_RUNNER_RETRY_ATTEMPTS: "1",
    LLM_RUNNER_RETRY_BACKOFF_MS: "0"
  };

  vi.doMock("../../src/lib/llm", () => ({
    generateResponse: generateResponseMock
  }));

  return import("../../src/server/services/panelRunner");
}

async function importPanelRunnerWithRealLlm(mode: "simulated" | "live") {
  /**
   * Purpose: Imports panel-runner with real LLM facade while mocking OpenAI client for live mode safety.
   * Inputs: Target LLM mode.
   * Outputs: Fresh panel-runner module and spy for mocked OpenAI responses.create calls.
   */
  const responsesCreateMock = vi.fn(async () => ({
    id: "resp_live_mock",
    output_text: "live-mocked-response",
    usage: {
      input_tokens: 12,
      output_tokens: 18,
      total_tokens: 30
    }
  }));

  vi.resetModules();
  vi.doUnmock("../../src/lib/llm");
  process.env = {
    ...originalEnv,
    OPENAI_MODEL: "gpt-5-nano-2025-08-07",
    LLM_ENABLED: "true",
    LLM_MODE: mode,
    OPENAI_API_KEY: "test-key",
    LLM_SIM_FAILURE_RATE: "0",
    LLM_SIM_MIN_LATENCY_MS: "1",
    LLM_SIM_MAX_LATENCY_MS: "1",
    LLM_RUNNER_RETRY_ATTEMPTS: "1",
    LLM_RUNNER_RETRY_BACKOFF_MS: "0"
  };

  vi.doMock("openai", () => ({
    default: class OpenAI {
      responses = {
        create: responsesCreateMock
      };
    }
  }));

  const panelRunnerModule = await import("../../src/server/services/panelRunner");
  return { panelRunnerModule, responsesCreateMock };
}

function createMockLlmResponse(content: string) {
  /**
   * Purpose: Builds a stable API-like mock LLM response for tests.
   * Inputs: Response content text.
   * Outputs: Response object matching expected generateResponse shape.
   */
  return {
    request_id: "req_test",
    content,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30
    },
    latency_ms: 1
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.doUnmock("../../src/lib/llm");
  vi.doUnmock("openai");
  vi.resetModules();
});

describe("panel runner", () => {
  it("first-turn first expert prompt excludes prior context section", async () => {
    const seenPrompts: string[] = [];
    const { runPanel } = await importPanelRunnerWithMock("simulated", async ({ prompt }) => {
      seenPrompts.push(prompt);
      return createMockLlmResponse("first reply");
    });

    await runPanel({
      conversationId: 9,
      panelId: 3,
      panelName: "Launch Council",
      panelInstructions: "Stay concise.",
      promptContent: "How should we launch this?",
      history: [],
      experts: [
        {
          id: 1,
          name: "Strategist",
          specialization: "Go-to-market",
          soul: "Analytical and practical",
          position: 1
        }
      ]
    });

    expect(seenPrompts).toHaveLength(1);
    expect(seenPrompts[0]).toContain("Panel name: Launch Council");
    expect(seenPrompts[0]).toContain("Soul behavior rules:");
    expect(seenPrompts[0]).toContain("Keep specialization as your primary scope and depth boundary.");
    expect(seenPrompts[0]).toContain("Treat the Soul as your style and decision lens.");
    expect(seenPrompts[0]).toContain("Do not let Soul override your specialization scope.");
    expect(seenPrompts[0]).toContain("Other experts on this panel and their specializations:");
    expect(seenPrompts[0]).toContain("No other experts in this panel.");
    expect(seenPrompts[0]).not.toContain("Conversation context from recent history:");
    expect(seenPrompts[0]).not.toContain("Prior expert outputs from this same turn:");
    expect(seenPrompts[0]).toContain("Length target:");
    expect(seenPrompts[0]).toContain("Aim for about 210 tokens or less.");
  });

  it("follow-up prompts include prior conversation context", async () => {
    const seenPrompts: string[] = [];
    const { runPanel } = await importPanelRunnerWithMock("simulated", async ({ prompt }) => {
      seenPrompts.push(prompt);
      return createMockLlmResponse("follow-up reply");
    });

    await runPanel({
      conversationId: 9,
      panelId: 3,
      panelName: "Launch Council",
      panelInstructions: "Stay concise.",
      promptContent: "What should we do next week?",
      history: [
        {
          sequence: 1,
          content: "How should we launch this?",
          responses: [
            {
              expertId: 1,
              expertName: "Strategist",
              sequence: 1,
              content: "Start with a narrow ICP."
            }
          ]
        }
      ],
      experts: [
        {
          id: 1,
          name: "Strategist",
          specialization: "Go-to-market",
          soul: "Analytical and practical",
          position: 1
        }
      ]
    });

    expect(seenPrompts).toHaveLength(1);
    expect(seenPrompts[0]).toContain("Conversation context from recent history:");
    expect(seenPrompts[0]).toContain("How should we launch this?");
    expect(seenPrompts[0]).toContain("Start with a narrow ICP.");
    expect(seenPrompts[0]).toContain("Avoid repeating prior experts verbatim; add a complementary angle from your specialization.");
    expect(seenPrompts[0]).toContain("Length target:");
    expect(seenPrompts[0]).toContain("Use at most 5 bullet points when bullet points help.");
  });

  it("later experts receive prior same-turn outputs", async () => {
    const seenPrompts: string[] = [];
    let callCount = 0;
    const { runPanel } = await importPanelRunnerWithMock("simulated", async ({ prompt }) => {
      seenPrompts.push(prompt);
      callCount += 1;
      return createMockLlmResponse(
        callCount === 1
          ? "First expert answer"
          : "Response to Planner: I agree, and add an execution plan."
      );
    });

    await runPanel({
      conversationId: 9,
      panelId: 3,
      panelName: "Launch Council",
      panelInstructions: "Stay concise.",
      promptContent: "Give me options.",
      history: [],
      experts: [
        {
          id: 10,
          name: "Planner",
          specialization: "Roadmapping",
          soul: "Structured",
          position: 1
        },
        {
          id: 11,
          name: "Operator",
          specialization: "Execution",
          soul: "Action-oriented",
          position: 2
        }
      ]
    });

    expect(seenPrompts).toHaveLength(2);
    expect(seenPrompts[0]).toContain("- Operator: Execution");
    expect(seenPrompts[1]).toContain("- Planner: Roadmapping");
    expect(seenPrompts[1]).toContain("Prior expert outputs from this same turn:");
    expect(seenPrompts[1]).toContain("Planner: First expert answer");
    expect(seenPrompts[1]).toContain("Inter-expert response requirements (required):");
    expect(seenPrompts[1]).not.toContain("[1] Planner");
  });

  it("executes experts in deterministic position/id order", async () => {
    const seenExpertNames: string[] = [];
    const { runPanel } = await importPanelRunnerWithMock("simulated", async ({ prompt }) => {
      const match = prompt.match(/Expert name: (.+)/);
      const expertName = match?.[1] ?? "unknown";
      seenExpertNames.push(expertName);

      if (expertName === "A") {
        return createMockLlmResponse("reply-from-A");
      }
      if (expertName === "C") {
        return createMockLlmResponse("Response to A: reply-from-C");
      }
      return createMockLlmResponse("Response to C: reply-from-B");
    });

    const result = await runPanel({
      conversationId: 9,
      panelId: 3,
      panelName: "Launch Council",
      panelInstructions: "Stay concise.",
      promptContent: "What should happen first?",
      history: [],
      experts: [
        {
          id: 11,
          name: "B",
          specialization: "S2",
          soul: "B soul",
          position: 2
        },
        {
          id: 5,
          name: "A",
          specialization: "S1",
          soul: "A soul",
          position: 1
        },
        {
          id: 3,
          name: "C",
          specialization: "S3",
          soul: "C soul",
          position: 2
        }
      ]
    });

    expect(seenExpertNames).toEqual(["A", "C", "B"]);
    expect(result.responses.map((response) => response.expertId)).toEqual([5, 3, 11]);
    expect(result.responses.map((response) => response.sequence)).toEqual([1, 2, 3]);
    expect(result.usage).toEqual({
      input_tokens: 30,
      output_tokens: 60,
      total_tokens: 90
    });
  });

  it("retries downstream expert once when no prior-expert reference is present", async () => {
    const seenPrompts: string[] = [];
    let callCount = 0;
    const { runPanel } = await importPanelRunnerWithMock("simulated", async ({ prompt }) => {
      seenPrompts.push(prompt);
      callCount += 1;
      if (callCount === 1) {
        return createMockLlmResponse("First expert answer.");
      }
      if (callCount === 2) {
        return createMockLlmResponse("Second expert answer without reference.");
      }
      return createMockLlmResponse("Response to Planner: corrective follow-up.");
    });

    const result = await runPanel({
      conversationId: 9,
      panelId: 3,
      panelName: "Launch Council",
      panelInstructions: "Stay concise.",
      promptContent: "Give me options.",
      history: [],
      experts: [
        {
          id: 10,
          name: "Planner",
          specialization: "Roadmapping",
          soul: "Structured",
          position: 1
        },
        {
          id: 11,
          name: "Operator",
          specialization: "Execution",
          soul: "Action-oriented",
          position: 2
        }
      ]
    });

    expect(callCount).toBe(3);
    expect(seenPrompts[2]).toContain("Correction required:");
    expect(seenPrompts[2]).toContain(
      "Your previous attempt did not satisfy the inter-expert reference rules."
    );
    expect(result.responses[1].content).toContain("Planner");
    expect(result.responses[1].content).not.toContain("[1]");
  });

  it("retries when expert uses numbered reference and stores name-only reference", async () => {
    const seenPrompts: string[] = [];
    let callCount = 0;
    const { runPanel } = await importPanelRunnerWithMock("simulated", async ({ prompt }) => {
      seenPrompts.push(prompt);
      callCount += 1;
      if (callCount === 1) {
        return createMockLlmResponse("Planner first answer.");
      }
      if (callCount === 2) {
        return createMockLlmResponse("Response to [1] Planner: second expert with numbered reference.");
      }
      return createMockLlmResponse("Response to Planner: second expert corrected reference.");
    });

    const result = await runPanel({
      conversationId: 9,
      panelId: 3,
      panelName: "Launch Council",
      panelInstructions: "Stay concise.",
      promptContent: "Give me options.",
      history: [],
      experts: [
        {
          id: 10,
          name: "Planner",
          specialization: "Roadmapping",
          soul: "Structured",
          position: 1
        },
        {
          id: 11,
          name: "Operator",
          specialization: "Execution",
          soul: "Action-oriented",
          position: 2
        }
      ]
    });

    expect(callCount).toBe(3);
    expect(seenPrompts[2]).toContain("Use expert names only; do not use numeric labels like [1].");
    expect(result.responses[1].content).toContain("Planner");
    expect(result.responses[1].content).not.toContain("[1]");
  });

  it("passes the same runner checks in both simulated and live modes with mocked llm", async () => {
    for (const mode of ["simulated", "live"] as const) {
      const seenPrompts: string[] = [];
      const { runPanel } = await importPanelRunnerWithMock(mode, async ({ prompt }) => {
        seenPrompts.push(prompt);
        return createMockLlmResponse(`${mode}-reply`);
      });

      const result = await runPanel({
        conversationId: 9,
        panelId: 3,
        panelName: "Launch Council",
        panelInstructions: "Stay concise.",
        promptContent: "Test mode behavior.",
        history: [
          {
            sequence: 1,
            content: "Earlier prompt",
            responses: [
              {
                expertId: 1,
                expertName: "Strategist",
                sequence: 1,
                content: "Earlier answer"
              }
            ]
          }
        ],
        experts: [
          {
            id: 1,
            name: "Strategist",
            specialization: "Planning",
            soul: "Analytical",
            position: 1
          }
        ]
      });

      expect(result.mode).toBe("executed");
      expect(result.responses).toHaveLength(1);
      expect(result.responses[0].content).toBe(`${mode}-reply`);
      expect(seenPrompts[0]).toContain("Conversation context from recent history:");
    }
  });

  it("runs in simulated and live modes with live API client mocked", async () => {
    for (const mode of ["simulated", "live"] as const) {
      const { panelRunnerModule, responsesCreateMock } = await importPanelRunnerWithRealLlm(mode);
      const result = await panelRunnerModule.runPanel({
        conversationId: 9,
        panelId: 3,
        panelName: "Launch Council",
        panelInstructions: "Stay concise.",
        promptContent: "Mode smoke-check prompt.",
        history: [],
        experts: [
          {
            id: 1,
            name: "Strategist",
            specialization: "Planning",
            soul: "Analytical",
            position: 1
          }
        ]
      });

      expect(result.responses).toHaveLength(1);
      if (mode === "simulated") {
        expect(result.responses[0].content).toContain("[SIMULATED:gpt-5-nano-2025-08-07]");
        expect(responsesCreateMock).toHaveBeenCalledTimes(0);
      } else {
        expect(result.responses[0].content).toBe("live-mocked-response");
        expect(responsesCreateMock).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("retries once on transient expert failure before succeeding", async () => {
    let attempts = 0;
    const { runPanel } = await importPanelRunnerWithMock("simulated", async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Temporary upstream timeout");
      }

      return createMockLlmResponse("recovered");
    });

    const result = await runPanel({
      conversationId: 9,
      panelId: 3,
      panelName: "Launch Council",
      panelInstructions: "Stay concise.",
      promptContent: "Retry behavior check.",
      history: [],
      experts: [
        {
          id: 1,
          name: "Strategist",
          specialization: "Planning",
          soul: "Analytical",
          position: 1
        }
      ]
    });

    expect(attempts).toBe(2);
    expect(result.responses[0].content).toBe("recovered");
  });

  it("fails fast on non-retryable configuration errors", async () => {
    let attempts = 0;
    const { runPanel } = await importPanelRunnerWithMock("simulated", async () => {
      attempts += 1;
      throw new Error("LLM is disabled by LLM_ENABLED=false.");
    });

    await expect(
      runPanel({
        conversationId: 9,
        panelId: 3,
        panelName: "Launch Council",
        panelInstructions: "Stay concise.",
        promptContent: "Non-retryable check.",
        history: [],
        experts: [
          {
            id: 1,
            name: "Strategist",
            specialization: "Planning",
            soul: "Analytical",
            position: 1
          }
        ]
      })
    ).rejects.toThrow("LLM is disabled");

    expect(attempts).toBe(1);
  });
});

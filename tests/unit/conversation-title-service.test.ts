import { beforeEach, describe, expect, it, vi } from "vitest";

const generateResponseMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/llm", () => ({
  generateResponse: generateResponseMock
}));

import {
  generateConversationTitleFromPrompt,
  mapConversationTitleErrorToHttp
} from "../../src/server/services/conversationTitleService";

beforeEach(() => {
  generateResponseMock.mockReset();
});

describe("conversation title service", () => {
  it("returns sanitized LLM title for valid input", async () => {
    generateResponseMock.mockResolvedValue({
      request_id: "req_1",
      content: '  "Practical Trolley Problem Ethics"  ',
      usage: {
        input_tokens: 10,
        output_tokens: 8,
        total_tokens: 18
      },
      latency_ms: 5
    });

    const title = await generateConversationTitleFromPrompt({
      prompt: "Solve the trolley problem."
    });

    expect(title).toBe("Practical Trolley Problem Ethics");
    expect(generateResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("User first prompt:\nSolve the trolley problem.")
      })
    );
  });

  it("caps generated title length to five words", async () => {
    generateResponseMock.mockResolvedValue({
      request_id: "req_2",
      content: "A Very Long Generated Title Here Today",
      usage: {
        input_tokens: 10,
        output_tokens: 8,
        total_tokens: 18
      },
      latency_ms: 5
    });

    const title = await generateConversationTitleFromPrompt({
      prompt: "Discuss project launch planning."
    });

    expect(title).toBe("A Very Long Generated Title");
  });

  it("falls back to prompt-derived title when output is not usable", async () => {
    generateResponseMock.mockResolvedValue({
      request_id: "req_3",
      content: "[SIMULATED:gpt-5-nano-2025-08-07] Response for prompt length 123.",
      usage: {
        input_tokens: 10,
        output_tokens: 8,
        total_tokens: 18
      },
      latency_ms: 5
    });

    const title = await generateConversationTitleFromPrompt({
      prompt: "Should we colonize Mars now?"
    });

    expect(title).toBe("Should we colonize Mars now");
  });

  it("rejects invalid payload", async () => {
    await expect(generateConversationTitleFromPrompt({ prompt: "" })).rejects.toMatchObject({
      status: 400
    });
  });

  it("maps unknown errors to generic http metadata", () => {
    const mapped = mapConversationTitleErrorToHttp(new Error("boom"));
    expect(mapped).toEqual({
      status: 500,
      message: "Unexpected title generation failure."
    });
  });
});


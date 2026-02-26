/**
 * Purpose: Unified LLM facade supporting simulated and live providers.
 * Inputs: `GenerateInput` prompt/model override and runtime config.
 * Outputs: API-shaped `LlmResponse` with content, usage, request id, and latency.
 */
import OpenAI from "openai";
import { appConfig, ensurePinnedModel } from "../config/appConfig";

export type LlmMode = "simulated" | "live";

export type LlmUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type LlmResponse = {
  request_id: string;
  content: string;
  usage: LlmUsage;
  latency_ms: number;
};

export type GenerateInput = {
  prompt: string;
  model?: string;
};

type LiveResponseLike = {
  id?: unknown;
  output_text?: unknown;
  output?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
  } | null;
  incomplete_details?: {
    reason?: unknown;
  } | null;
};

function randomInt(min: number, max: number): number {
  /**
   * Purpose: Produces an integer within an inclusive range.
   * Inputs: Minimum and maximum integer bounds.
   * Outputs: Random integer in `[min, max]`.
   */
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getMode(): LlmMode {
  /**
   * Purpose: Resolves and validates active LLM mode from config.
   * Inputs: None.
   * Outputs: `simulated` or `live` mode.
   */
  const mode = appConfig.llmMode;
  if (mode !== "simulated" && mode !== "live") {
    throw new Error("LLM_MODE must be simulated or live.");
  }
  return mode;
}

function extractTextFromOutputPart(part: unknown): string {
  /**
   * Purpose: Extracts text from one response content part when it is output text.
   * Inputs: Unknown response output part value.
   * Outputs: Trimmed text fragment or empty string when part is non-text/invalid.
   */
  if (typeof part !== "object" || part === null) {
    return "";
  }

  const typed = part as { type?: unknown; text?: unknown };
  if (typed.type !== "output_text" || typeof typed.text !== "string") {
    return "";
  }

  return typed.text.trim();
}

function extractTextFromOutputItem(item: unknown): string {
  /**
   * Purpose: Extracts concatenated text from one response output item when message-shaped.
   * Inputs: Unknown response output item value.
   * Outputs: Joined text fragments or empty string when item has no text content.
   */
  if (typeof item !== "object" || item === null) {
    return "";
  }

  const typed = item as { type?: unknown; content?: unknown };
  if (typed.type !== "message" || !Array.isArray(typed.content)) {
    return "";
  }

  const fragments = typed.content
    .map((part) => extractTextFromOutputPart(part))
    .filter((fragment) => fragment.length > 0);

  return fragments.join("\n\n").trim();
}

export function extractLiveResponseContent(response: LiveResponseLike): string {
  /**
   * Purpose: Extracts stable text content from live Responses API payloads.
   * Inputs: Live response-like object returned by OpenAI SDK.
   * Outputs: Non-empty text when available, otherwise empty string.
   */
  if (typeof response.output_text === "string") {
    const directOutputText = response.output_text.trim();
    if (directOutputText.length > 0) {
      return directOutputText;
    }
  }

  if (!Array.isArray(response.output)) {
    return "";
  }

  const messageTexts = response.output
    .map((item) => extractTextFromOutputItem(item))
    .filter((text) => text.length > 0);

  return messageTexts.join("\n\n").trim();
}

function extractLiveIncompleteReason(response: LiveResponseLike): string | null {
  /**
   * Purpose: Reads provider incomplete reason when live response ends before output text is produced.
   * Inputs: Live response-like object returned by OpenAI SDK.
   * Outputs: Incomplete reason string (for example `max_output_tokens`) or `null`.
   */
  if (typeof response !== "object" || response === null) {
    return null;
  }

  if (
    !response.incomplete_details ||
    typeof response.incomplete_details !== "object" ||
    typeof response.incomplete_details.reason !== "string"
  ) {
    return null;
  }

  const reason = response.incomplete_details.reason.trim();
  return reason.length > 0 ? reason : null;
}

function buildTokenCapRetryPrompt(prompt: string): string {
  /**
   * Purpose: Adds explicit brevity constraints for retrying live calls that hit output-token limits.
   * Inputs: Original composed prompt.
   * Outputs: Retry prompt with strict response-length guidance appended.
   */
  return [
    prompt.trimEnd(),
    "",
    "Output length requirement for this retry:",
    "- Return only the final answer.",
    "- Keep the answer under 120 words.",
    "- Use at most 5 bullet points when bullet points help.",
    "- Do not include extra preamble."
  ].join("\n");
}

function readLiveUsage(response: LiveResponseLike): LlmUsage {
  /**
   * Purpose: Normalizes live response usage into numeric token counters.
   * Inputs: Live response-like object with optional usage fields.
   * Outputs: Token usage object with non-negative integer values.
   */
  const usage = response.usage;
  const inputTokens =
    typeof usage?.input_tokens === "number" && Number.isFinite(usage.input_tokens)
      ? Math.max(0, Math.floor(usage.input_tokens))
      : 0;
  const outputTokens =
    typeof usage?.output_tokens === "number" && Number.isFinite(usage.output_tokens)
      ? Math.max(0, Math.floor(usage.output_tokens))
      : 0;
  const totalTokens =
    typeof usage?.total_tokens === "number" && Number.isFinite(usage.total_tokens)
      ? Math.max(0, Math.floor(usage.total_tokens))
      : inputTokens + outputTokens;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens
  };
}

function mergeUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
  /**
   * Purpose: Sums token usage from two provider calls into one aggregate usage object.
   * Inputs: Left and right usage objects.
   * Outputs: Combined token usage totals.
   */
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    total_tokens: left.total_tokens + right.total_tokens
  };
}

function buildLiveFallbackContent(model: string, response: LiveResponseLike): string {
  /**
   * Purpose: Builds a non-empty fallback message when live provider returns no text.
   * Inputs: Active model name and raw live response payload.
   * Outputs: Stable human-readable fallback content string.
   */
  if (typeof response === "object" && response !== null) {
    const typed = response as {
      error?: { message?: unknown } | null;
      incomplete_details?: { reason?: unknown } | null;
    };

    if (
      typed.error &&
      typeof typed.error === "object" &&
      typeof typed.error.message === "string" &&
      typed.error.message.trim().length > 0
    ) {
      return `[LIVE:${model}] Provider returned no text output. Error: ${typed.error.message.trim()}`;
    }

    if (
      typed.incomplete_details &&
      typeof typed.incomplete_details === "object" &&
      typeof typed.incomplete_details.reason === "string" &&
      typed.incomplete_details.reason.trim().length > 0
    ) {
      return `[LIVE:${model}] Provider returned no text output. Incomplete reason: ${typed.incomplete_details.reason.trim()}`;
    }
  }

  return `[LIVE:${model}] Provider returned no text output.`;
}

export async function generateResponse(input: GenerateInput): Promise<LlmResponse> {
  /**
   * Purpose: Generates an LLM response through simulated or live provider path.
   * Inputs: Prompt payload and optional model override.
   * Outputs: API-shaped response containing content, usage, request id, and latency.
   */
  if (!appConfig.llmEnabled) {
    throw new Error("LLM is disabled by LLM_ENABLED=false.");
  }
  if (input.prompt.length > appConfig.llmMaxRequestPromptChars) {
    throw new Error(
      `LLM prompt exceeds max request size of ${appConfig.llmMaxRequestPromptChars} characters.`
    );
  }

  const mode = getMode();
  const model = ensurePinnedModel(input.model);
  const start = Date.now();

  if (mode === "simulated") {
    const latency = randomInt(appConfig.llmSimMinLatencyMs, appConfig.llmSimMaxLatencyMs);
    await new Promise((resolve) => setTimeout(resolve, latency));

    if (Math.random() < appConfig.llmSimFailureRate) {
      throw new Error("Simulated provider failure.");
    }

    const promptTokens = Math.max(1, Math.ceil(input.prompt.length / 4));
    const outputTokens = randomInt(40, 180);

    return {
      request_id: `sim_${Math.random().toString(36).slice(2, 12)}`,
      content: `[SIMULATED:${model}] Response for prompt length ${input.prompt.length}.`,
      usage: {
        input_tokens: promptTokens,
        output_tokens: outputTokens,
        total_tokens: promptTokens + outputTokens
      },
      latency_ms: Date.now() - start
    };
  }

  const apiKey = appConfig.openAiApiKey;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when LLM_MODE=live.");
  }

  const client = new OpenAI({ apiKey });
  const liveRequestBase = {
    model,
    max_output_tokens: appConfig.llmMaxLiveOutputTokens,
    reasoning: { effort: "minimal" as const },
    text: { verbosity: "low" as const }
  };
  const firstResponse = await client.responses.create({
    ...liveRequestBase,
    input: input.prompt
  });

  let finalResponse = firstResponse;
  let extractedContent = extractLiveResponseContent(finalResponse);
  const shouldRetryForTokenCap =
    extractedContent.length === 0 &&
    extractLiveIncompleteReason(finalResponse) === "max_output_tokens";

  if (shouldRetryForTokenCap) {
    finalResponse = await client.responses.create({
      ...liveRequestBase,
      input: buildTokenCapRetryPrompt(input.prompt)
    });
    extractedContent = extractLiveResponseContent(finalResponse);
  }

  const content =
    extractedContent.length > 0
      ? extractedContent
      : buildLiveFallbackContent(model, finalResponse);

  const usage = shouldRetryForTokenCap
    ? mergeUsage(readLiveUsage(firstResponse), readLiveUsage(finalResponse))
    : readLiveUsage(finalResponse);

  return {
    request_id:
      typeof finalResponse.id === "string" && finalResponse.id.length > 0
        ? finalResponse.id
        : "resp_live_unknown",
    content,
    usage,
    latency_ms: Date.now() - start
  };
}

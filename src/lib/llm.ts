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

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getMode(): LlmMode {
  const mode = appConfig.llmMode;
  if (mode !== "simulated" && mode !== "live") {
    throw new Error("LLM_MODE must be simulated or live.");
  }
  return mode;
}

export async function generateResponse(input: GenerateInput): Promise<LlmResponse> {
  if (!appConfig.llmEnabled) {
    throw new Error("LLM is disabled by LLM_ENABLED=false.");
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
  const response = await client.responses.create({
    model,
    input: input.prompt
  });

  const usage = response.usage;

  return {
    request_id: response.id,
    content: response.output_text ?? "",
    usage: {
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0
    },
    latency_ms: Date.now() - start
  };
}

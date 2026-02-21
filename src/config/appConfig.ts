/**
 * Purpose: Loads and validates runtime configuration from `config/app-config.json`
 * and environment overrides.
 * Inputs: Process environment variables + JSON config file on disk.
 * Outputs: Typed `appConfig` values and `ensurePinnedModel()` validation helper.
 */
import fs from "node:fs";
import path from "node:path";

const REQUIRED_PINNED_MODEL = "gpt-5-nano-2025-08-07";

type LlmMode = "simulated" | "live";

type FileConfig = {
  llm: {
    pinnedModel: string;
    defaultMode: LlmMode;
    defaultEnabled: boolean;
    simulated: {
      failureRate: number;
      minLatencyMs: number;
      maxLatencyMs: number;
    };
  };
  auth: {
    accessTokenTtl: string;
  };
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }

  return fallback;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseLlmMode(value: string | undefined, fallback: LlmMode): LlmMode {
  if (value === "live" || value === "simulated") {
    return value;
  }

  return fallback;
}

function loadFileConfig(): FileConfig {
  const filePath = path.resolve(process.cwd(), "config/app-config.json");

  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing config file: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as FileConfig;

  if (parsed.llm.pinnedModel !== REQUIRED_PINNED_MODEL) {
    throw new Error(`llm.pinnedModel must be ${REQUIRED_PINNED_MODEL}.`);
  }

  if (
    parsed.llm.defaultMode !== "simulated" &&
    parsed.llm.defaultMode !== "live"
  ) {
    throw new Error("llm.defaultMode must be simulated or live.");
  }

  return parsed;
}

const fileConfig = loadFileConfig();

function resolveModelFromEnv(modelOverride: string | undefined): string {
  const selected = modelOverride ?? process.env.OPENAI_MODEL ?? fileConfig.llm.pinnedModel;

  if (selected !== fileConfig.llm.pinnedModel) {
    throw new Error(`Model must be pinned to ${fileConfig.llm.pinnedModel}.`);
  }

  return selected;
}

export const appConfig = {
  pinnedModel: fileConfig.llm.pinnedModel,
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "",
  authAccessTokenTtl: fileConfig.auth.accessTokenTtl,
  llmEnabled: parseBoolean(process.env.LLM_ENABLED, fileConfig.llm.defaultEnabled),
  llmMode: parseLlmMode(process.env.LLM_MODE, fileConfig.llm.defaultMode),
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",
  openAiModel: resolveModelFromEnv(undefined),
  llmSimFailureRate: parseNumber(
    process.env.LLM_SIM_FAILURE_RATE,
    fileConfig.llm.simulated.failureRate
  ),
  llmSimMinLatencyMs: parseNumber(
    process.env.LLM_SIM_MIN_LATENCY_MS,
    fileConfig.llm.simulated.minLatencyMs
  ),
  llmSimMaxLatencyMs: parseNumber(
    process.env.LLM_SIM_MAX_LATENCY_MS,
    fileConfig.llm.simulated.maxLatencyMs
  )
} as const;

export function ensurePinnedModel(modelOverride?: string): string {
  return resolveModelFromEnv(modelOverride);
}

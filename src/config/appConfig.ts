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
    orchestration?: {
      historyPromptFetchLimit?: number;
      historyCharBudget?: number;
      retryAttemptsPerExpert?: number;
      retryBackoffMs?: number;
    };
    safety?: {
      maxExpertsPerPanel?: number;
      maxUserPromptChars?: number;
      maxLiveOutputTokens?: number;
      maxDailyTokens?: number;
    };
  };
  auth: {
    accessTokenTtl: string;
    passwordResetTokenTtlMinutes?: number;
  };
  api?: {
    idempotencyReplayTtlHours?: number;
    idempotencyInProgressTtlSeconds?: number;
  };
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  /**
   * Purpose: Parses a boolean-like string with fallback behavior.
   * Inputs: Raw env string and fallback boolean.
   * Outputs: Parsed boolean (`true`/`false`) or fallback when invalid/missing.
   */
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
  /**
   * Purpose: Parses numeric env-like input with fallback behavior.
   * Inputs: Raw env string and fallback number.
   * Outputs: Parsed finite number or fallback when invalid/missing.
   */
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseLlmMode(value: string | undefined, fallback: LlmMode): LlmMode {
  /**
   * Purpose: Restricts mode parsing to supported LLM modes.
   * Inputs: Raw mode string and fallback mode.
   * Outputs: `live`/`simulated` or fallback when unsupported.
   */
  if (value === "live" || value === "simulated") {
    return value;
  }

  return fallback;
}

function loadFileConfig(): FileConfig {
  /**
   * Purpose: Reads and validates developer JSON config from disk.
   * Inputs: None (reads `config/app-config.json` from current working directory).
   * Outputs: Validated `FileConfig` object or throws on invalid/missing config.
   */
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
const defaultOrchestrationConfig = {
  historyPromptFetchLimit: 30,
  historyCharBudget: 12000,
  retryAttemptsPerExpert: 1,
  retryBackoffMs: 200
};

const defaultSafetyConfig = {
  maxExpertsPerPanel: 8,
  maxUserPromptChars: 4000,
  maxLiveOutputTokens: 300,
  maxDailyTokens: 2500000
};

const defaultApiConfig = {
  idempotencyReplayTtlHours: 24,
  idempotencyInProgressTtlSeconds: 600
};

function resolveModelFromEnv(modelOverride: string | undefined): string {
  /**
   * Purpose: Resolves active model selection while enforcing pinning rule.
   * Inputs: Optional model override.
   * Outputs: Pinned model string or throws if selection violates pinning.
   */
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
  passwordResetTokenTtlMinutes: Math.max(
    5,
    Math.floor(parseNumber(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES, fileConfig.auth.passwordResetTokenTtlMinutes ?? 30))
  ),
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  passwordResetFromEmail: process.env.PASSWORD_RESET_FROM_EMAIL ?? "",
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
  ),
  llmHistoryPromptFetchLimit: Math.max(
    1,
    Math.floor(
      parseNumber(
        process.env.LLM_HISTORY_PROMPT_FETCH_LIMIT,
        fileConfig.llm.orchestration?.historyPromptFetchLimit ??
          defaultOrchestrationConfig.historyPromptFetchLimit
      )
    )
  ),
  llmHistoryCharBudget: Math.max(
    500,
    Math.floor(
      parseNumber(
        process.env.LLM_HISTORY_CHAR_BUDGET,
        fileConfig.llm.orchestration?.historyCharBudget ??
          defaultOrchestrationConfig.historyCharBudget
      )
    )
  ),
  llmRunnerRetryAttempts: Math.max(
    0,
    Math.floor(
      parseNumber(
        process.env.LLM_RUNNER_RETRY_ATTEMPTS,
        fileConfig.llm.orchestration?.retryAttemptsPerExpert ??
          defaultOrchestrationConfig.retryAttemptsPerExpert
      )
    )
  ),
  llmRunnerRetryBackoffMs: Math.max(
    0,
    Math.floor(
      parseNumber(
        process.env.LLM_RUNNER_RETRY_BACKOFF_MS,
        fileConfig.llm.orchestration?.retryBackoffMs ??
          defaultOrchestrationConfig.retryBackoffMs
      )
    )
  ),
  llmMaxExpertsPerPanel: Math.max(
    1,
    Math.floor(
      parseNumber(
        process.env.LLM_MAX_EXPERTS_PER_PANEL,
        fileConfig.llm.safety?.maxExpertsPerPanel ??
          defaultSafetyConfig.maxExpertsPerPanel
      )
    )
  ),
  llmMaxUserPromptChars: Math.max(
    100,
    Math.floor(
      parseNumber(
        process.env.LLM_MAX_USER_PROMPT_CHARS,
        fileConfig.llm.safety?.maxUserPromptChars ??
          defaultSafetyConfig.maxUserPromptChars
      )
    )
  ),
  llmMaxLiveOutputTokens: Math.max(
    1,
    Math.floor(
      parseNumber(
        process.env.LLM_MAX_LIVE_OUTPUT_TOKENS,
        fileConfig.llm.safety?.maxLiveOutputTokens ??
          defaultSafetyConfig.maxLiveOutputTokens
      )
    )
  ),
  llmMaxDailyTokens: Math.max(
    1,
    Math.floor(
      parseNumber(
        process.env.LLM_MAX_DAILY_TOKENS,
        fileConfig.llm.safety?.maxDailyTokens ??
          defaultSafetyConfig.maxDailyTokens
      )
    )
  ),
  apiIdempotencyReplayTtlHours: Math.max(
    1,
    Math.floor(
      parseNumber(
        process.env.API_IDEMPOTENCY_REPLAY_TTL_HOURS,
        fileConfig.api?.idempotencyReplayTtlHours ??
          defaultApiConfig.idempotencyReplayTtlHours
      )
    )
  ),
  apiIdempotencyInProgressTtlSeconds: Math.max(
    5,
    Math.floor(
      parseNumber(
        process.env.API_IDEMPOTENCY_IN_PROGRESS_TTL_SECONDS,
        fileConfig.api?.idempotencyInProgressTtlSeconds ??
          defaultApiConfig.idempotencyInProgressTtlSeconds
      )
    )
  )
} as const;

export function ensurePinnedModel(modelOverride?: string): string {
  /**
   * Purpose: Public helper to verify model selection respects pinned-model policy.
   * Inputs: Optional model override string.
   * Outputs: Valid pinned model string or throws on mismatch.
   */
  return resolveModelFromEnv(modelOverride);
}

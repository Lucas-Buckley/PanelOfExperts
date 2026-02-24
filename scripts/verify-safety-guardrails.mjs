#!/usr/bin/env node
/**
 * Purpose: Verifies deployment safety guardrails before release operations.
 * Inputs: `config/app-config.json` and optional runtime env overrides.
 * Outputs: Zero exit code on pass; non-zero with explicit error list on failure.
 */
import fs from "node:fs";
import path from "node:path";

const REQUIRED_PINNED_MODEL = "gpt-5-nano-2025-08-07";

const MAX_ALLOWED = {
  maxExpertsPerPanel: 6,
  maxUserPromptChars: 8000,
  maxRequestPromptChars: 24000,
  maxLiveOutputTokens: 600,
  historyCharBudget: 20000,
  retryAttemptsPerExpert: 3
};

function readJson(filePath) {
  /**
   * Purpose: Reads and parses JSON file content from disk.
   * Inputs: Absolute file path.
   * Outputs: Parsed JSON object value.
   */
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toNumber(value, fallback) {
  /**
   * Purpose: Converts unknown input to finite number with fallback.
   * Inputs: Unknown numeric-like value and fallback.
   * Outputs: Finite number, or fallback when invalid.
   */
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function assertCondition(condition, message, errors) {
  /**
   * Purpose: Collects validation failures into a shared error array.
   * Inputs: Boolean condition, failure message, and mutable errors list.
   * Outputs: None; appends message when condition is false.
   */
  if (!condition) {
    errors.push(message);
  }
}

function validateConfigShape(config, errors) {
  /**
   * Purpose: Enforces static guardrail bounds from central JSON config.
   * Inputs: Parsed config object and mutable errors list.
   * Outputs: None; appends violations to errors list.
   */
  const safety = config?.llm?.safety ?? {};
  const orchestration = config?.llm?.orchestration ?? {};

  assertCondition(
    config?.llm?.pinnedModel === REQUIRED_PINNED_MODEL,
    `Pinned model must remain ${REQUIRED_PINNED_MODEL}.`,
    errors
  );

  assertCondition(
    config?.llm?.defaultMode === "simulated" || config?.llm?.defaultMode === "live",
    "llm.defaultMode must be simulated or live.",
    errors
  );

  const maxExpertsPerPanel = toNumber(safety.maxExpertsPerPanel, NaN);
  const maxUserPromptChars = toNumber(safety.maxUserPromptChars, NaN);
  const maxRequestPromptChars = toNumber(safety.maxRequestPromptChars, NaN);
  const maxLiveOutputTokens = toNumber(safety.maxLiveOutputTokens, NaN);
  const historyCharBudget = toNumber(orchestration.historyCharBudget, NaN);
  const retryAttemptsPerExpert = toNumber(orchestration.retryAttemptsPerExpert, NaN);

  assertCondition(
    Number.isInteger(maxExpertsPerPanel) && maxExpertsPerPanel >= 1,
    "llm.safety.maxExpertsPerPanel must be an integer >= 1.",
    errors
  );
  assertCondition(
    Number.isInteger(maxExpertsPerPanel) &&
      maxExpertsPerPanel <= MAX_ALLOWED.maxExpertsPerPanel,
    `llm.safety.maxExpertsPerPanel must be <= ${MAX_ALLOWED.maxExpertsPerPanel}.`,
    errors
  );

  assertCondition(
    Number.isInteger(maxUserPromptChars) && maxUserPromptChars >= 100,
    "llm.safety.maxUserPromptChars must be an integer >= 100.",
    errors
  );
  assertCondition(
    Number.isInteger(maxUserPromptChars) &&
      maxUserPromptChars <= MAX_ALLOWED.maxUserPromptChars,
    `llm.safety.maxUserPromptChars must be <= ${MAX_ALLOWED.maxUserPromptChars}.`,
    errors
  );

  assertCondition(
    Number.isInteger(maxRequestPromptChars) && maxRequestPromptChars >= 500,
    "llm.safety.maxRequestPromptChars must be an integer >= 500.",
    errors
  );
  assertCondition(
    Number.isInteger(maxRequestPromptChars) &&
      maxRequestPromptChars <= MAX_ALLOWED.maxRequestPromptChars,
    `llm.safety.maxRequestPromptChars must be <= ${MAX_ALLOWED.maxRequestPromptChars}.`,
    errors
  );
  assertCondition(
    maxRequestPromptChars >= maxUserPromptChars,
    "llm.safety.maxRequestPromptChars must be >= llm.safety.maxUserPromptChars.",
    errors
  );

  assertCondition(
    Number.isInteger(maxLiveOutputTokens) && maxLiveOutputTokens >= 1,
    "llm.safety.maxLiveOutputTokens must be an integer >= 1.",
    errors
  );
  assertCondition(
    Number.isInteger(maxLiveOutputTokens) &&
      maxLiveOutputTokens <= MAX_ALLOWED.maxLiveOutputTokens,
    `llm.safety.maxLiveOutputTokens must be <= ${MAX_ALLOWED.maxLiveOutputTokens}.`,
    errors
  );

  assertCondition(
    Number.isInteger(historyCharBudget) && historyCharBudget >= 500,
    "llm.orchestration.historyCharBudget must be an integer >= 500.",
    errors
  );
  assertCondition(
    Number.isInteger(historyCharBudget) &&
      historyCharBudget <= MAX_ALLOWED.historyCharBudget,
    `llm.orchestration.historyCharBudget must be <= ${MAX_ALLOWED.historyCharBudget}.`,
    errors
  );

  assertCondition(
    Number.isInteger(retryAttemptsPerExpert) && retryAttemptsPerExpert >= 0,
    "llm.orchestration.retryAttemptsPerExpert must be an integer >= 0.",
    errors
  );
  assertCondition(
    Number.isInteger(retryAttemptsPerExpert) &&
      retryAttemptsPerExpert <= MAX_ALLOWED.retryAttemptsPerExpert,
    `llm.orchestration.retryAttemptsPerExpert must be <= ${MAX_ALLOWED.retryAttemptsPerExpert}.`,
    errors
  );
}

function validateEnvironment(errors) {
  /**
   * Purpose: Enforces runtime safety invariants from current process environment.
   * Inputs: Mutable errors list.
   * Outputs: None; appends violations to errors list.
   */
  const mode = process.env.LLM_MODE;
  const enabledRaw = process.env.LLM_ENABLED;
  const openAiModel = process.env.OPENAI_MODEL;
  const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
  const debugExpose = process.env.DEBUG_EXPOSE_ERROR_MESSAGES;
  const isProductionTarget =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

  if (mode) {
    assertCondition(
      mode === "simulated" || mode === "live",
      "LLM_MODE must be simulated or live when provided.",
      errors
    );
  }

  if (openAiModel) {
    assertCondition(
      openAiModel === REQUIRED_PINNED_MODEL,
      `OPENAI_MODEL must remain ${REQUIRED_PINNED_MODEL}.`,
      errors
    );
  }

  const enabled =
    enabledRaw === undefined ? undefined : enabledRaw.trim().toLowerCase() === "true";
  const requiresApiKey = mode === "live" && enabled !== false;
  if (requiresApiKey) {
    assertCondition(
      openAiApiKey.trim().length > 0,
      "OPENAI_API_KEY must be non-empty when LLM_MODE=live and LLM_ENABLED is not false.",
      errors
    );
  }

  if (isProductionTarget) {
    assertCondition(
      debugExpose !== "true",
      "DEBUG_EXPOSE_ERROR_MESSAGES must not be true in production targets.",
      errors
    );
  }
}

function main() {
  /**
   * Purpose: Runs safety guardrail validation and exits with explicit status.
   * Inputs: None.
   * Outputs: Console summary and process exit code.
   */
  const errors = [];
  const configPath = path.resolve(process.cwd(), "config/app-config.json");

  if (!fs.existsSync(configPath)) {
    console.error(`Safety verify failed: missing config file at ${configPath}`);
    process.exit(1);
  }

  const config = readJson(configPath);
  validateConfigShape(config, errors);
  validateEnvironment(errors);

  if (errors.length > 0) {
    console.error("Safety verify failed:");
    for (const message of errors) {
      console.error(`- ${message}`);
    }
    process.exit(1);
  }

  console.log("Safety verify passed.");
}

main();

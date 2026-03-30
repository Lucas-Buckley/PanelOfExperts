#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const REQUIRED_PINNED_MODEL = "gpt-5-nano-2025-08-07";
const MAX_ALLOWED = {
    maxExpertsPerPanel: 8,
    maxUserPromptChars: 8000,
    maxLiveOutputTokens: 600,
    maxDailyTokens: 2500000,
    historyCharBudget: 20000,
    retryAttemptsPerExpert: 3
};
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function toNumber(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return parsed;
}
function assertCondition(condition, message, errors) {
    if (!condition) {
        errors.push(message);
    }
}
function validateConfigShape(config, errors) {
    const safety = config?.llm?.safety ?? {};
    const orchestration = config?.llm?.orchestration ?? {};
    assertCondition(config?.llm?.pinnedModel === REQUIRED_PINNED_MODEL, `Pinned model must remain ${REQUIRED_PINNED_MODEL}.`, errors);
    assertCondition(config?.llm?.defaultMode === "simulated" || config?.llm?.defaultMode === "live", "llm.defaultMode must be simulated or live.", errors);
    const maxExpertsPerPanel = toNumber(safety.maxExpertsPerPanel, NaN);
    const maxUserPromptChars = toNumber(safety.maxUserPromptChars, NaN);
    const maxLiveOutputTokens = toNumber(safety.maxLiveOutputTokens, NaN);
    const maxDailyTokens = toNumber(safety.maxDailyTokens, NaN);
    const historyCharBudget = toNumber(orchestration.historyCharBudget, NaN);
    const retryAttemptsPerExpert = toNumber(orchestration.retryAttemptsPerExpert, NaN);
    assertCondition(Number.isInteger(maxExpertsPerPanel) && maxExpertsPerPanel >= 1, "llm.safety.maxExpertsPerPanel must be an integer >= 1.", errors);
    assertCondition(Number.isInteger(maxExpertsPerPanel) &&
        maxExpertsPerPanel <= MAX_ALLOWED.maxExpertsPerPanel, `llm.safety.maxExpertsPerPanel must be <= ${MAX_ALLOWED.maxExpertsPerPanel}.`, errors);
    assertCondition(Number.isInteger(maxUserPromptChars) && maxUserPromptChars >= 100, "llm.safety.maxUserPromptChars must be an integer >= 100.", errors);
    assertCondition(Number.isInteger(maxUserPromptChars) &&
        maxUserPromptChars <= MAX_ALLOWED.maxUserPromptChars, `llm.safety.maxUserPromptChars must be <= ${MAX_ALLOWED.maxUserPromptChars}.`, errors);
    assertCondition(Number.isInteger(maxLiveOutputTokens) && maxLiveOutputTokens >= 1, "llm.safety.maxLiveOutputTokens must be an integer >= 1.", errors);
    assertCondition(Number.isInteger(maxLiveOutputTokens) &&
        maxLiveOutputTokens <= MAX_ALLOWED.maxLiveOutputTokens, `llm.safety.maxLiveOutputTokens must be <= ${MAX_ALLOWED.maxLiveOutputTokens}.`, errors);
    assertCondition(Number.isInteger(maxDailyTokens) && maxDailyTokens >= 1, "llm.safety.maxDailyTokens must be an integer >= 1.", errors);
    assertCondition(Number.isInteger(maxDailyTokens) &&
        maxDailyTokens <= MAX_ALLOWED.maxDailyTokens, `llm.safety.maxDailyTokens must be <= ${MAX_ALLOWED.maxDailyTokens}.`, errors);
    assertCondition(Number.isInteger(historyCharBudget) && historyCharBudget >= 500, "llm.orchestration.historyCharBudget must be an integer >= 500.", errors);
    assertCondition(Number.isInteger(historyCharBudget) &&
        historyCharBudget <= MAX_ALLOWED.historyCharBudget, `llm.orchestration.historyCharBudget must be <= ${MAX_ALLOWED.historyCharBudget}.`, errors);
    assertCondition(Number.isInteger(retryAttemptsPerExpert) && retryAttemptsPerExpert >= 0, "llm.orchestration.retryAttemptsPerExpert must be an integer >= 0.", errors);
    assertCondition(Number.isInteger(retryAttemptsPerExpert) &&
        retryAttemptsPerExpert <= MAX_ALLOWED.retryAttemptsPerExpert, `llm.orchestration.retryAttemptsPerExpert must be <= ${MAX_ALLOWED.retryAttemptsPerExpert}.`, errors);
}
function validateEnvironment(errors) {
    const mode = process.env.LLM_MODE;
    const enabledRaw = process.env.LLM_ENABLED;
    const openAiModel = process.env.OPENAI_MODEL;
    const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
    const debugExpose = process.env.DEBUG_EXPOSE_ERROR_MESSAGES;
    const isProductionTarget = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
    if (mode) {
        assertCondition(mode === "simulated" || mode === "live", "LLM_MODE must be simulated or live when provided.", errors);
    }
    if (openAiModel) {
        assertCondition(openAiModel === REQUIRED_PINNED_MODEL, `OPENAI_MODEL must remain ${REQUIRED_PINNED_MODEL}.`, errors);
    }
    const enabled = enabledRaw === undefined ? undefined : enabledRaw.trim().toLowerCase() === "true";
    const requiresApiKey = mode === "live" && enabled !== false;
    if (requiresApiKey) {
        assertCondition(openAiApiKey.trim().length > 0, "OPENAI_API_KEY must be non-empty when LLM_MODE=live and LLM_ENABLED is not false.", errors);
    }
    if (isProductionTarget) {
        assertCondition(debugExpose !== "true", "DEBUG_EXPOSE_ERROR_MESSAGES must not be true in production targets.", errors);
    }
}
function main() {
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

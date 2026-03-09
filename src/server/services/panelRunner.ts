/**
 * Purpose: Runs sequential panel-expert orchestration with first-turn/follow-up prompt composition.
 * Inputs: Conversation/panel identifiers + panel name, prompt content, panel instructions, prior conversation context, and expert definitions.
 * Outputs: Deterministic per-expert LLM responses mapped by expert id and execution order.
 */
import { generateResponse, type LlmUsage } from "../../lib/llm";
import { appConfig } from "../../config/appConfig";

export type PanelRunnerExpertInput = {
  id: number;
  name: string;
  specialization: string;
  soul: string;
  position: number;
};

export type PanelRunnerHistoryResponseInput = {
  expertId: number;
  expertName: string;
  sequence: number;
  content: string;
};

export type PanelRunnerHistoryPromptInput = {
  sequence: number;
  content: string;
  responses: PanelRunnerHistoryResponseInput[];
};

export type PanelRunnerInput = {
  conversationId: number;
  panelId: number;
  panelName: string;
  panelInstructions: string | null;
  promptContent: string;
  history: PanelRunnerHistoryPromptInput[];
  experts: PanelRunnerExpertInput[];
};

export type PanelRunnerResponse = {
  expertId: number;
  expertName: string;
  sequence: number;
  content: string;
};

export type PanelRunnerResult = {
  mode: "executed";
  responses: PanelRunnerResponse[];
  usage: LlmUsage;
};

const INTER_EXPERT_RETRY_LIMIT = 1;

function createZeroUsage(): LlmUsage {
  /**
   * Purpose: Provides a reusable zero-value usage object for aggregation.
   * Inputs: None.
   * Outputs: Usage object initialized with all token counters at zero.
   */
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0
  };
}

function addUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
  /**
   * Purpose: Sums two usage objects into one aggregate usage value.
   * Inputs: Left and right token usage counters.
   * Outputs: Combined usage totals.
   */
  return {
    input_tokens: left.input_tokens + right.input_tokens,
    output_tokens: left.output_tokens + right.output_tokens,
    total_tokens: left.total_tokens + right.total_tokens
  };
}

function estimateMaxTokensPerExpertCall(): number {
  /**
   * Purpose: Computes a conservative per-expert token ceiling for preflight daily-cap checks.
   * Inputs: None.
   * Outputs: Upper-bound token estimate for one expert call.
   */
  const conservativePromptCharBudget =
    appConfig.llmHistoryCharBudget + appConfig.llmMaxUserPromptChars + 4000;
  const conservativeInputTokenCeiling = Math.ceil(conservativePromptCharBudget / 2);
  return conservativeInputTokenCeiling + appConfig.llmMaxLiveOutputTokens;
}

function buildTokenLengthGuidanceLines(): string[] {
  /**
   * Purpose: Produces prompt guidance lines that target token-based brevity.
   * Inputs: None.
   * Outputs: Ordered guidance lines for prompt composition.
   */
  const targetTokens = Math.max(40, Math.floor(appConfig.llmMaxLiveOutputTokens * 0.7));
  return [
    "Length target:",
    `- Aim for about ${targetTokens} tokens or less.`,
    "- Keep it concise to reduce truncation risk.",
    "- Prefer short natural prose, not headings or bullet lists.",
    "- Use a list only when the user explicitly asks for one."
  ];
}

export function estimatePanelMaxTokens(expertCount: number): number {
  /**
   * Purpose: Estimates worst-case token usage for one panel run across all experts.
   * Inputs: Number of experts that will be invoked for the panel.
   * Outputs: Conservative total token estimate used for daily-cap prechecks.
   */
  const safeExpertCount = Math.max(0, Math.floor(expertCount));
  return safeExpertCount * estimateMaxTokensPerExpertCall();
}

function buildSoulSection(
  expert: PanelRunnerExpertInput,
  panelName: string,
  panelInstructions: string | null
): string {
  /**
   * Purpose: Builds the expert soul section shared by all panel prompts.
   * Inputs: Expert profile, panel name, and optional panel-level instructions.
   * Outputs: Soul text block containing base instructions, specialization, and soul.
   */
  const baseInstructions =
    panelInstructions?.trim() ??
    "You are part of a multi-expert panel. Give specific, practical reasoning in your answer.";

  return [
    "Panel base instructions:",
    baseInstructions,
    "",
    `Panel name: ${panelName}`,
    "",
    `Expert name: ${expert.name}`,
    `Specialization: ${expert.specialization}`,
    `Soul: ${expert.soul}`,
    "",
    "Soul behavior rules:",
    "- Keep specialization as your primary scope and depth boundary.",
    "- Treat the Soul as your style and decision lens.",
    "- Do not let Soul override your specialization scope.",
    "- Stay in this soul for the full response.",
    "- Do not answer as another expert."
  ].join("\n");
}

function formatPeerSpecializations(
  experts: PanelRunnerExpertInput[],
  currentExpertId: number
): string {
  /**
   * Purpose: Lists other experts and their specializations for coordination context.
   * Inputs: Ordered expert list for the panel and the current expert id.
   * Outputs: Deterministic peer-specialization section text.
   */
  const peers = experts.filter((expert) => expert.id !== currentExpertId);
  if (peers.length === 0) {
    return "No other experts in this panel.";
  }

  return peers
    .map(
      (peer) =>
        `- ${peer.name}: ${peer.specialization}`
    )
    .join("\n");
}

function formatConversationContext(history: PanelRunnerHistoryPromptInput[]): string {
  /**
   * Purpose: Converts recent prompt/response history into deterministic context text.
   * Inputs: Ordered prior conversation history prompts and their responses.
   * Outputs: Context text block for follow-up prompt composition.
   */
  if (history.length === 0) {
    return "No prior prompts in this conversation yet.";
  }

  return history
    .map((historyPrompt) => {
      const responsesText =
        historyPrompt.responses.length > 0
          ? historyPrompt.responses
              .map(
                (historyResponse) =>
                  `  - ${historyResponse.expertName}: ${historyResponse.content}`
              )
              .join("\n")
          : "  - (No expert responses recorded.)";

      return [
        `Prompt #${historyPrompt.sequence}: ${historyPrompt.content}`,
        "Responses:",
        responsesText
      ].join("\n");
    })
    .join("\n\n");
}

function formatCurrentTurnOutputs(outputs: PanelRunnerResponse[]): string {
  /**
   * Purpose: Formats already-generated same-turn outputs for downstream experts.
   * Inputs: Prior responses from earlier experts in the current execution loop.
   * Outputs: Deterministic text section listing previous experts and their outputs.
   */
  if (outputs.length === 0) {
    return "No prior expert outputs yet for this prompt.";
  }

  return outputs
    .map(
      (response) =>
        `- ${response.expertName}: ${response.content}`
    )
    .join("\n");
}

function buildInterExpertResponseContract(
  priorCurrentTurnOutputs: PanelRunnerResponse[]
): string {
  /**
   * Purpose: Builds natural-language response requirements that still force inter-expert engagement.
   * Inputs: Prior expert outputs generated in this same turn.
   * Outputs: Required output contract text for downstream experts.
   */
  const requiredReferences = priorCurrentTurnOutputs
    .map((response) => `- ${response.expertName}`)
    .join("\n");

  return [
    "Inter-expert interaction requirements (required):",
    "- Write naturally as one coherent response.",
    "- Prefer plain prose over bullets or outline formatting unless the user explicitly asked for a list.",
    "- Do not use canned section headings or labels such as 'Response to prior expert', 'My distinct angle', or 'Caveat or disagreement'.",
    `- Explicitly reference at least one prior expert by name from this list:\n${requiredReferences}`,
    "- Use expert names only; do not use numeric labels like [1].",
    "- Engage at least one specific point from a prior expert by agreeing, refining, or challenging it.",
    "- Add at least one non-redundant point from your specialization.",
    "- If you have a caveat, disagreement, or scope boundary, weave it in naturally instead of labeling it as a section."
  ].join("\n");
}

function hasRequiredInterExpertReference(
  content: string,
  priorCurrentTurnOutputs: PanelRunnerResponse[]
): boolean {
  /**
   * Purpose: Checks whether downstream expert output explicitly references at least one prior expert.
   * Inputs: Generated output content and prior same-turn expert outputs.
   * Outputs: `true` when explicit reference exists, otherwise `false`.
   */
  const normalizedContent = content.toLowerCase();

  return priorCurrentTurnOutputs.some((response) => {
    const normalizedExpertName = response.expertName.toLowerCase();
    return normalizedContent.includes(normalizedExpertName);
  });
}

function hasNumberedExpertReference(
  content: string,
  priorCurrentTurnOutputs: PanelRunnerResponse[]
): boolean {
  /**
   * Purpose: Detects disallowed numeric expert references like `[1] Expert Name`.
   * Inputs: Generated output content and prior same-turn expert outputs.
   * Outputs: `true` when numbered-name references are present, otherwise `false`.
   */
  return priorCurrentTurnOutputs.some((response) => {
    const escapedName = response.expertName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const numberedPattern = new RegExp(`\\[\\d+\\]\\s*${escapedName}`, "i");
    return numberedPattern.test(content);
  });
}

function stripNumberedExpertReferences(
  content: string,
  priorCurrentTurnOutputs: PanelRunnerResponse[]
): string {
  /**
   * Purpose: Removes numeric labels from expert references while preserving referenced expert names.
   * Inputs: Generated output content and prior same-turn expert outputs.
   * Outputs: Content with numbered expert labels stripped.
   */
  return priorCurrentTurnOutputs.reduce((current, response) => {
    const escapedName = response.expertName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const numberedPattern = new RegExp(`\\[(\\d+)\\]\\s*(${escapedName})`, "gi");
    return current.replace(numberedPattern, "$2");
  }, content);
}

function shouldEnforceInterExpertReference(args: {
  expertIndex: number;
  priorCurrentTurnOutputs: PanelRunnerResponse[];
}): boolean {
  /**
   * Purpose: Determines whether current expert response must reference prior same-turn experts.
   * Inputs: Current expert index and existing same-turn outputs.
   * Outputs: `true` only for downstream experts with prior outputs available.
   */
  return args.expertIndex > 0 && args.priorCurrentTurnOutputs.length > 0;
}

function buildInterExpertCorrectionPrompt(args: {
  basePrompt: string;
  priorCurrentTurnOutputs: PanelRunnerResponse[];
  previousAttemptContent: string;
}): string {
  /**
   * Purpose: Builds one corrective prompt when downstream expert output misses required references.
   * Inputs: Original composed prompt, prior same-turn outputs, and previous attempt content.
   * Outputs: Corrective retry prompt that preserves context and adds strict remediation instructions.
   */
  return [
    args.basePrompt,
    "",
    "Correction required:",
    "Your previous attempt did not satisfy the inter-expert reference rules.",
    "Regenerate the answer and satisfy all inter-expert requirements exactly.",
    buildInterExpertResponseContract(args.priorCurrentTurnOutputs),
    "",
    "Previous attempt (for reference only, do not copy verbatim):",
    args.previousAttemptContent
  ].join("\n\n");
}

function composePromptForExpert(args: {
  expert: PanelRunnerExpertInput;
  orderedExperts: PanelRunnerExpertInput[];
  panelName: string;
  promptContent: string;
  panelInstructions: string | null;
  history: PanelRunnerHistoryPromptInput[];
  priorCurrentTurnOutputs: PanelRunnerResponse[];
  isFirstExpertInTurn: boolean;
}): string {
  /**
   * Purpose: Composes one expert-specific LLM prompt based on first-turn vs follow-up rules.
   * Inputs: Expert profile, current prompt, panel instructions, prior conversation history, current-turn outputs, and first-expert flag.
   * Outputs: Fully composed LLM prompt text for the current expert.
   */
  const soul = buildSoulSection(
    args.expert,
    args.panelName,
    args.panelInstructions
  );
  const peers = formatPeerSpecializations(args.orderedExperts, args.expert.id);
  const isFirstConversationTurn = args.history.length === 0;
  const isMinimalFirstCase = isFirstConversationTurn && args.isFirstExpertInTurn;

  if (isMinimalFirstCase) {
    return [
      soul,
      "Other experts on this panel and their specializations:",
      peers,
      "",
      "Current user prompt:",
      args.promptContent,
      "",
      "Respond as this expert with concise, concrete reasoning.",
      "Write naturally and avoid labeled sections, headings, or list formatting unless the user asks for it.",
      "Focus on a distinctive angle from your specialization.",
      ...buildTokenLengthGuidanceLines()
    ].join("\n\n");
  }

  return [
    soul,
    "Other experts on this panel and their specializations:",
    peers,
    "",
    "Conversation context from recent history:",
    formatConversationContext(args.history),
    "",
    "Responding prompt for this turn:",
    args.promptContent,
    "",
    "Prior expert outputs from this same turn:",
    formatCurrentTurnOutputs(args.priorCurrentTurnOutputs),
    "",
    "Respond as this expert while considering both context and prior expert outputs.",
    "Write naturally and avoid labeled sections, headings, or list formatting unless the user asks for it.",
    "Avoid repeating prior experts verbatim; add a complementary angle from your specialization.",
    buildInterExpertResponseContract(args.priorCurrentTurnOutputs),
    ...buildTokenLengthGuidanceLines()
  ].join("\n\n");
}

function isRetryableLlmError(error: unknown): boolean {
  /**
   * Purpose: Classifies LLM errors into retryable vs non-retryable buckets.
   * Inputs: Unknown thrown error value from provider call.
   * Outputs: `true` when retry should be attempted, otherwise `false`.
   */
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const nonRetryableMessageSignals = [
      "model must be pinned",
      "llm is disabled",
      "openai_api_key is required",
      "llm_mode must be simulated or live"
    ];

    if (nonRetryableMessageSignals.some((signal) => message.includes(signal))) {
      return false;
    }
  }

  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
      return false;
    }
  }

  return true;
}

async function sleep(ms: number): Promise<void> {
  /**
   * Purpose: Pauses async execution for a bounded retry backoff delay.
   * Inputs: Milliseconds to sleep.
   * Outputs: Promise that resolves after delay.
   */
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateWithRetry(prompt: string): Promise<Awaited<ReturnType<typeof generateResponse>>> {
  /**
   * Purpose: Calls LLM provider with bounded retries for transient failures.
   * Inputs: Fully composed LLM prompt string.
   * Outputs: Successful provider response or final thrown error after retry exhaustion.
   */
  const maxRetries = appConfig.llmRunnerRetryAttempts;
  const retryBackoffMs = appConfig.llmRunnerRetryBackoffMs;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await generateResponse({ prompt });
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxRetries && isRetryableLlmError(error);
      if (!canRetry) {
        throw error;
      }

      const backoff = retryBackoffMs * (attempt + 1);
      if (backoff > 0) {
        await sleep(backoff);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("LLM generation failed.");
}

export async function runPanel(input: PanelRunnerInput): Promise<PanelRunnerResult> {
  /**
   * Purpose: Executes experts sequentially and returns deterministic ordered responses.
   * Inputs: Panel-runner input with current prompt, history, and experts.
   * Outputs: Ordered expert responses generated by LLM provider facade.
   */
  if (input.experts.length > appConfig.llmMaxExpertsPerPanel) {
    throw new Error(
      `Expert count exceeds max per panel (${appConfig.llmMaxExpertsPerPanel}).`
    );
  }

  const orderedExperts = [...input.experts].sort(
    (left, right) => left.position - right.position || left.id - right.id
  );
  const responses: PanelRunnerResponse[] = [];
  let usage = createZeroUsage();

  for (const [index, expert] of orderedExperts.entries()) {
    const composedPrompt = composePromptForExpert({
      expert,
      orderedExperts,
      panelName: input.panelName,
      promptContent: input.promptContent,
      panelInstructions: input.panelInstructions,
      history: input.history,
      priorCurrentTurnOutputs: responses,
      isFirstExpertInTurn: index === 0
    });
    let llmResponse = await generateWithRetry(composedPrompt);
    usage = addUsage(usage, llmResponse.usage);

    if (
      shouldEnforceInterExpertReference({
        expertIndex: index,
        priorCurrentTurnOutputs: responses
      }) &&
      (!hasRequiredInterExpertReference(llmResponse.content, responses) ||
        hasNumberedExpertReference(llmResponse.content, responses))
    ) {
      for (
        let retryAttempt = 0;
        retryAttempt < INTER_EXPERT_RETRY_LIMIT &&
        (!hasRequiredInterExpertReference(llmResponse.content, responses) ||
          hasNumberedExpertReference(llmResponse.content, responses));
        retryAttempt += 1
      ) {
        const correctionPrompt = buildInterExpertCorrectionPrompt({
          basePrompt: composedPrompt,
          priorCurrentTurnOutputs: responses,
          previousAttemptContent: llmResponse.content
        });
        llmResponse = await generateWithRetry(correctionPrompt);
        usage = addUsage(usage, llmResponse.usage);
      }
    }

    responses.push({
      expertId: expert.id,
      expertName: expert.name,
      sequence: index + 1,
      content: stripNumberedExpertReferences(llmResponse.content, responses)
    });
  }

  return {
    mode: "executed",
    responses,
    usage
  };
}

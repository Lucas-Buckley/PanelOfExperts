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
    return {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0
    };
}
function addUsage(left: LlmUsage, right: LlmUsage): LlmUsage {
    return {
        input_tokens: left.input_tokens + right.input_tokens,
        output_tokens: left.output_tokens + right.output_tokens,
        total_tokens: left.total_tokens + right.total_tokens
    };
}
function estimateMaxTokensPerExpertCall(): number {
    const conservativePromptCharBudget = appConfig.llmHistoryCharBudget + appConfig.llmMaxUserPromptChars + 4000;
    const conservativeInputTokenCeiling = Math.ceil(conservativePromptCharBudget / 2);
    return conservativeInputTokenCeiling + appConfig.llmMaxLiveOutputTokens;
}
function buildTokenLengthGuidanceLines(): string[] {
    const targetTokens = Math.max(40, Math.floor(appConfig.llmMaxLiveOutputTokens * 0.7));
    return [
        "Length target:",
        `- Aim for about ${targetTokens} tokens or less.`,
        "- Keep it concise to reduce truncation risk.",
        "- Prefer short natural prose, not headings or bullet lists.",
        "- Default to 2-4 short paragraphs instead of one large block.",
        "- Use a list only when the user explicitly asks for one."
    ];
}
export function estimatePanelMaxTokens(expertCount: number): number {
    const safeExpertCount = Math.max(0, Math.floor(expertCount));
    return safeExpertCount * estimateMaxTokensPerExpertCall();
}
function buildSoulSection(expert: PanelRunnerExpertInput, panelName: string, panelInstructions: string | null): string {
    const baseInstructions = panelInstructions?.trim() ??
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
function formatPeerSpecializations(experts: PanelRunnerExpertInput[], currentExpertId: number): string {
    const peers = experts.filter((expert) => expert.id !== currentExpertId);
    if (peers.length === 0) {
        return "No other experts in this panel.";
    }
    return peers
        .map((peer) => `- ${peer.name}: ${peer.specialization}`)
        .join("\n");
}
function formatConversationContext(history: PanelRunnerHistoryPromptInput[]): string {
    if (history.length === 0) {
        return "No prior prompts in this conversation yet.";
    }
    return history
        .map((historyPrompt) => {
        const responsesText = historyPrompt.responses.length > 0
            ? historyPrompt.responses
                .map((historyResponse) => `  - ${historyResponse.expertName}: ${historyResponse.content}`)
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
    if (outputs.length === 0) {
        return "No prior expert outputs yet for this prompt.";
    }
    return outputs
        .map((response) => `- ${response.expertName}: ${response.content}`)
        .join("\n");
}
function buildInterExpertResponseContract(priorCurrentTurnOutputs: PanelRunnerResponse[]): string {
    const requiredReferences = priorCurrentTurnOutputs
        .map((response) => `- ${response.expertName}`)
        .join("\n");
    return [
        "Inter-expert interaction requirements (required):",
        "- Write naturally as one coherent response.",
        "- Prefer plain prose over bullets or outline formatting unless the user explicitly asked for a list.",
        "- Default to 2-4 short paragraphs; avoid one oversized paragraph unless the user asked for that style.",
        "- Do not use canned section headings or labels such as 'Response to prior expert', 'My distinct angle', or 'Caveat or disagreement'.",
        `- Explicitly reference at least one prior expert by name from this list:\n${requiredReferences}`,
        "- Use expert names only; do not use numeric labels like [1].",
        "- Engage at least one specific point from a prior expert by agreeing, refining, or challenging it.",
        "- Add at least one non-redundant point from your specialization.",
        "- If you have a caveat, disagreement, or scope boundary, weave it in naturally instead of labeling it as a section."
    ].join("\n");
}
function hasTemplatedResponseStructure(content: string): boolean {
    const disallowedPatterns = [
        /^[A-Z][A-Za-z0-9 '"()/-]{1,48}:\s/m,
        /\bmy distinct angle\b/i,
        /\b(?:a|one) practical caveat\b/i,
        /\bfrom my specialization\b/i,
        /\bfrom (?:a|an|the) [a-z][a-z -]{0,40} lens\b/i,
        /\bfrom (?:a|an|the) [a-z][a-z -]{0,40} stance\b/i,
        /\bfrom (?:a|an|the) [a-z][a-z -]{0,40} standpoint\b/i,
        /\bfrom (?:a|an|the) [a-z][a-z -]{0,40} perspective\b/i
    ];
    return disallowedPatterns.some((pattern) => pattern.test(content));
}
function hasRequiredInterExpertReference(content: string, priorCurrentTurnOutputs: PanelRunnerResponse[]): boolean {
    const normalizedContent = content.toLowerCase();
    return priorCurrentTurnOutputs.some((response) => {
        const normalizedExpertName = response.expertName.toLowerCase();
        return normalizedContent.includes(normalizedExpertName);
    });
}
function hasNumberedExpertReference(content: string, priorCurrentTurnOutputs: PanelRunnerResponse[]): boolean {
    return priorCurrentTurnOutputs.some((response) => {
        const escapedName = response.expertName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const numberedPattern = new RegExp(`\\[\\d+\\]\\s*${escapedName}`, "i");
        return numberedPattern.test(content);
    });
}
function stripNumberedExpertReferences(content: string, priorCurrentTurnOutputs: PanelRunnerResponse[]): string {
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
    return args.expertIndex > 0 && args.priorCurrentTurnOutputs.length > 0;
}
function needsResponseCorrection(args: {
    content: string;
    expertIndex: number;
    priorCurrentTurnOutputs: PanelRunnerResponse[];
}): boolean {
    const hasReferenceIssue = shouldEnforceInterExpertReference({
        expertIndex: args.expertIndex,
        priorCurrentTurnOutputs: args.priorCurrentTurnOutputs
    }) &&
        (!hasRequiredInterExpertReference(args.content, args.priorCurrentTurnOutputs) ||
            hasNumberedExpertReference(args.content, args.priorCurrentTurnOutputs));
    return hasReferenceIssue || hasTemplatedResponseStructure(args.content);
}
function buildInterExpertCorrectionPrompt(args: {
    basePrompt: string;
    priorCurrentTurnOutputs: PanelRunnerResponse[];
    previousAttemptContent: string;
    expertIndex: number;
}): string {
    const referenceRulesApply = shouldEnforceInterExpertReference({
        expertIndex: args.expertIndex,
        priorCurrentTurnOutputs: args.priorCurrentTurnOutputs
    });
    return [
        args.basePrompt,
        "",
        "Correction required:",
        "Your previous attempt sounded too templated or did not satisfy the response rules.",
        "Regenerate the answer so it sounds natural and conversational.",
        "Do not use headings, label-like transitions, or meta phrases such as 'from a ... lens', 'from my specialization', or 'a practical caveat'.",
        "Do not use one oversized paragraph; default to a few short paragraphs unless the user asked otherwise.",
        ...(referenceRulesApply
            ? [
                "Also satisfy all inter-expert requirements exactly:",
                buildInterExpertResponseContract(args.priorCurrentTurnOutputs)
            ]
            : []),
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
    const soul = buildSoulSection(args.expert, args.panelName, args.panelInstructions);
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
            "Default to 2-4 short paragraphs unless the user asks for a different format.",
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
        "Default to 2-4 short paragraphs unless the user asks for a different format.",
        "Avoid repeating prior experts verbatim; add a complementary angle from your specialization.",
        buildInterExpertResponseContract(args.priorCurrentTurnOutputs),
        ...buildTokenLengthGuidanceLines()
    ].join("\n\n");
}
function isRetryableLlmError(error: unknown): boolean {
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
        const status = (error as {
            status?: unknown;
        }).status;
        if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
            return false;
        }
    }
    return true;
}
async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function generateWithRetry(prompt: string): Promise<Awaited<ReturnType<typeof generateResponse>>> {
    const maxRetries = appConfig.llmRunnerRetryAttempts;
    const retryBackoffMs = appConfig.llmRunnerRetryBackoffMs;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
            return await generateResponse({ prompt });
        }
        catch (error) {
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
    if (input.experts.length > appConfig.llmMaxExpertsPerPanel) {
        throw new Error(`Expert count exceeds max per panel (${appConfig.llmMaxExpertsPerPanel}).`);
    }
    const orderedExperts = [...input.experts].sort((left, right) => left.position - right.position || left.id - right.id);
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
        if (needsResponseCorrection({
            content: llmResponse.content,
            expertIndex: index,
            priorCurrentTurnOutputs: responses
        })) {
            for (let retryAttempt = 0; retryAttempt < INTER_EXPERT_RETRY_LIMIT &&
                needsResponseCorrection({
                    content: llmResponse.content,
                    expertIndex: index,
                    priorCurrentTurnOutputs: responses
                }); retryAttempt += 1) {
                const correctionPrompt = buildInterExpertCorrectionPrompt({
                    basePrompt: composedPrompt,
                    priorCurrentTurnOutputs: responses,
                    previousAttemptContent: llmResponse.content,
                    expertIndex: index
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

import { z } from "zod";
import { appConfig } from "../../config/appConfig";
import { generateResponse } from "../../lib/llm";
import { DB_FIELD_LIMITS } from "../contracts/dbFieldLimits";
const TITLE_MIN_WORDS = 2;
const TITLE_MAX_WORDS = 5;
const createConversationTitleSchema = z.object({
    prompt: z.string().trim().min(1).max(appConfig.llmMaxUserPromptChars)
});
type CreateConversationTitleInput = z.infer<typeof createConversationTitleSchema>;
class ConversationTitleServiceError extends Error {
    code: "VALIDATION";
    status: 400;
    constructor(message: string) {
        super(message);
        this.code = "VALIDATION";
        this.status = 400;
    }
}
function parseCreateConversationTitleInput(input: unknown): CreateConversationTitleInput {
    const parsed = createConversationTitleSchema.safeParse(input);
    if (!parsed.success) {
        throw new ConversationTitleServiceError("Invalid title-generation payload.");
    }
    return parsed.data;
}
function cleanRawTitleCandidate(raw: string): string {
    const firstNonEmptyLine = raw
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
    return firstNonEmptyLine
        .replace(/^title\s*:\s*/i, "")
        .replace(/^[-*]\s+/, "")
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function extractWords(value: string): string[] {
    return value
        .replace(/[^\p{L}\p{N}\s'’_-]+/gu, " ")
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length > 0);
}
function buildFallbackTitleFromPrompt(prompt: string): string {
    const promptWords = extractWords(prompt);
    if (promptWords.length === 0) {
        return "New Conversation";
    }
    const boundedWords = promptWords.slice(0, TITLE_MAX_WORDS);
    if (boundedWords.length < TITLE_MIN_WORDS) {
        boundedWords.push("Conversation");
    }
    return boundedWords.join(" ").slice(0, DB_FIELD_LIMITS.conversation.name).trim();
}
function sanitizeConversationTitle(rawOutput: string, prompt: string): string {
    const candidate = cleanRawTitleCandidate(rawOutput);
    const candidateWords = extractWords(candidate);
    if (candidate.length === 0 ||
        candidate.startsWith("[SIMULATED:") ||
        candidateWords.length < TITLE_MIN_WORDS) {
        return buildFallbackTitleFromPrompt(prompt);
    }
    const boundedWords = candidateWords.slice(0, TITLE_MAX_WORDS);
    if (boundedWords.length < TITLE_MIN_WORDS) {
        return buildFallbackTitleFromPrompt(prompt);
    }
    return boundedWords.join(" ").slice(0, DB_FIELD_LIMITS.conversation.name).trim();
}
function composeTitlePrompt(firstPrompt: string): string {
    return [
        "Generate a concise conversation title from the user's first prompt.",
        "Rules:",
        "- Return only the title text.",
        "- Use 2 to 5 words.",
        "- No quotes, no markdown, and no trailing punctuation.",
        "",
        "User first prompt:",
        firstPrompt
    ].join("\n");
}
export async function generateConversationTitleFromPrompt(input: unknown): Promise<string> {
    const parsed = parseCreateConversationTitleInput(input);
    const llmResult = await generateResponse({
        prompt: composeTitlePrompt(parsed.prompt)
    });
    return sanitizeConversationTitle(llmResult.content, parsed.prompt);
}
export function mapConversationTitleErrorToHttp(error: unknown): {
    status: number;
    message: string;
} {
    if (error instanceof ConversationTitleServiceError) {
        return {
            status: error.status,
            message: error.message
        };
    }
    return {
        status: 500,
        message: "Unexpected title generation failure."
    };
}

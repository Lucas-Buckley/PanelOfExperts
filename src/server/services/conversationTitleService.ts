/**
 * Purpose: Generates concise conversation titles from a user's first prompt via LLM with strict post-validation.
 * Inputs: Raw title-generation payload from API route handlers.
 * Outputs: Stable 2-5 word conversation title string with DB-safe length.
 */
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
  /**
   * Purpose: Validates and parses title-generation payload.
   * Inputs: Unknown API request payload.
   * Outputs: Typed payload with one normalized prompt string.
   */
  const parsed = createConversationTitleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConversationTitleServiceError("Invalid title-generation payload.");
  }

  return parsed.data;
}

function cleanRawTitleCandidate(raw: string): string {
  /**
   * Purpose: Normalizes one raw LLM title candidate into a single-line plain text candidate.
   * Inputs: Raw LLM output text.
   * Outputs: Cleaned candidate string without wrappers/prefixes.
   */
  const firstNonEmptyLine =
    raw
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
  /**
   * Purpose: Splits text into normalized words and removes empty tokens.
   * Inputs: Raw text value.
   * Outputs: Array of token-like words.
   */
  return value
    .replace(/[^\p{L}\p{N}\s'’_-]+/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

function buildFallbackTitleFromPrompt(prompt: string): string {
  /**
   * Purpose: Produces deterministic fallback title from prompt when LLM output is invalid/unavailable.
   * Inputs: User's first prompt text.
   * Outputs: 2-5 word DB-safe fallback title.
   */
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
  /**
   * Purpose: Enforces title constraints (2-5 words) and returns fallback when provider output is unsuitable.
   * Inputs: Raw provider output and original user prompt.
   * Outputs: Sanitized 2-5 word title string.
   */
  const candidate = cleanRawTitleCandidate(rawOutput);
  const candidateWords = extractWords(candidate);

  if (
    candidate.length === 0 ||
    candidate.startsWith("[SIMULATED:") ||
    candidateWords.length < TITLE_MIN_WORDS
  ) {
    return buildFallbackTitleFromPrompt(prompt);
  }

  const boundedWords = candidateWords.slice(0, TITLE_MAX_WORDS);
  if (boundedWords.length < TITLE_MIN_WORDS) {
    return buildFallbackTitleFromPrompt(prompt);
  }

  return boundedWords.join(" ").slice(0, DB_FIELD_LIMITS.conversation.name).trim();
}

function composeTitlePrompt(firstPrompt: string): string {
  /**
   * Purpose: Builds concise instruction prompt for title generation.
   * Inputs: User's first prompt text.
   * Outputs: LLM-ready instruction prompt.
   */
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
  /**
   * Purpose: Calls LLM title generation and returns a strictly bounded final conversation title.
   * Inputs: Unknown payload expected to include `prompt`.
   * Outputs: Sanitized title string that is safe for conversation creation.
   */
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
  /**
   * Purpose: Maps title-service validation errors to HTTP-safe status/message metadata.
   * Inputs: Unknown thrown error.
   * Outputs: Stable HTTP status/message pair.
   */
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


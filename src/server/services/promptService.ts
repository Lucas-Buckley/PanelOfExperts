/**
 * Purpose: Implements prompt creation flow with ownership checks, panel-runner call, and response persistence.
 * Inputs: Authenticated account id, conversation id, and prompt payload.
 * Outputs: Persisted prompt + ordered responses for API return.
 */
import { z } from "zod";

import { prisma } from "../../lib/db";
import { markPromptActivity } from "../repositories/activityOrdering";
import { runPanel } from "./panelRunner";

const createPromptSchema = z.object({
  content: z.string().trim().min(1)
});

type CreatePromptInput = z.infer<typeof createPromptSchema>;

export type PromptResponseView = {
  id: number;
  promptId: number;
  expertId: number;
  sequence: number;
  content: string;
  createdAt: Date;
};

export type PromptView = {
  id: number;
  conversationId: number;
  sequence: number;
  content: string;
  createdAt: Date;
};

export type PromptWithResponsesView = {
  prompt: PromptView;
  responses: PromptResponseView[];
};

class PromptServiceError extends Error {
  code: "VALIDATION" | "NOT_FOUND";
  status: 400 | 404;

  constructor(code: "VALIDATION" | "NOT_FOUND", status: 400 | 404, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function parseCreatePromptInput(input: unknown): CreatePromptInput {
  /**
   * Purpose: Validates and parses prompt creation payload.
   * Inputs: Unknown HTTP request body.
   * Outputs: Typed `CreatePromptInput`, or throws validation error.
   */
  const parsed = createPromptSchema.safeParse(input);
  if (!parsed.success) {
    throw new PromptServiceError("VALIDATION", 400, "Invalid prompt payload.");
  }

  return parsed.data;
}

export async function createPromptForConversation(
  accountId: number,
  conversationId: number,
  input: unknown
): Promise<PromptWithResponsesView> {
  /**
   * Purpose: Creates a prompt for an owned conversation, runs panel responses, and persists results.
   * Inputs: Authenticated account id, route conversation id, and prompt payload.
   * Outputs: Created prompt plus ordered persisted responses.
   */
  const parsed = parseCreatePromptInput(input);

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: {
        id: conversationId,
        panel: {
          accountId
        }
      },
      select: {
        id: true,
        panelId: true
      }
    });

    if (!conversation) {
      throw new PromptServiceError("NOT_FOUND", 404, "Conversation not found.");
    }

    const previousPrompt = await tx.prompt.findFirst({
      where: { conversationId },
      orderBy: [{ sequence: "desc" }, { id: "desc" }],
      select: { sequence: true }
    });

    const nextPromptSequence = (previousPrompt?.sequence ?? 0) + 1;
    const prompt = await tx.prompt.create({
      data: {
        conversationId,
        sequence: nextPromptSequence,
        content: parsed.content
      },
      select: {
        id: true,
        conversationId: true,
        sequence: true,
        content: true,
        createdAt: true
      }
    });

    const experts = await tx.expert.findMany({
      where: { panelId: conversation.panelId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        specialization: true,
        soul: true,
        position: true
      }
    });

    const panelResult = runPanel({
      conversationId,
      panelId: conversation.panelId,
      promptContent: prompt.content,
      experts
    });

    const validExpertIds = new Set(experts.map((expert) => expert.id));
    const responses: PromptResponseView[] = [];
    for (const runnerResponse of panelResult.responses) {
      if (!validExpertIds.has(runnerResponse.expertId)) {
        continue;
      }

      const createdResponse = await tx.response.create({
        data: {
          promptId: prompt.id,
          expertId: runnerResponse.expertId,
          sequence: runnerResponse.sequence,
          content: runnerResponse.content
        },
        select: {
          id: true,
          promptId: true,
          expertId: true,
          sequence: true,
          content: true,
          createdAt: true
        }
      });
      responses.push(createdResponse);
    }

    await markPromptActivity({
      conversationId,
      promptedAt: prompt.createdAt,
      tx
    });

    return {
      prompt,
      responses
    };
  });
}

export function mapPromptErrorToHttp(error: unknown): { status: number; message: string } {
  /**
   * Purpose: Maps prompt-domain errors into stable HTTP response metadata.
   * Inputs: Unknown thrown error from prompt domain flow.
   * Outputs: HTTP status + safe error message pair for route responses.
   */
  if (error instanceof PromptServiceError) {
    return {
      status: error.status,
      message: error.message
    };
  }

  return {
    status: 500,
    message: "Internal server error."
  };
}

/**
 * Purpose: Implements conversation domain logic for create/list/read APIs with ownership enforcement.
 * Inputs: Authenticated account id plus conversation payload/identifier values.
 * Outputs: Conversation DTOs or mapped domain error metadata for HTTP responses.
 */
import { z } from "zod";

import { prisma } from "../../lib/db";
import { DB_FIELD_LIMITS } from "../contracts/dbFieldLimits";

const createConversationSchema = z.object({
  panelId: z.number().int().positive(),
  name: z.string().trim().min(1).max(DB_FIELD_LIMITS.conversation.name)
});

type CreateConversationInput = z.infer<typeof createConversationSchema>;

export type ConversationResponseView = {
  id: number;
  promptId: number;
  expertId: number;
  sequence: number;
  content: string;
  createdAt: Date;
};

export type ConversationPromptView = {
  id: number;
  conversationId: number;
  sequence: number;
  content: string;
  createdAt: Date;
  responses: ConversationResponseView[];
};

export type ConversationView = {
  id: number;
  panelId: number;
  name: string;
  lastPromptedAt: Date | null;
  prompts: ConversationPromptView[];
};

export type ConversationListItemView = {
  id: number;
  panelId: number;
  name: string;
  lastPromptedAt: Date | null;
};

class ConversationServiceError extends Error {
  code: "VALIDATION" | "NOT_FOUND";
  status: 400 | 404;

  constructor(code: "VALIDATION" | "NOT_FOUND", status: 400 | 404, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function parseCreateConversationInput(input: unknown): CreateConversationInput {
  /**
   * Purpose: Validates and parses conversation creation payload.
   * Inputs: Unknown HTTP request body.
   * Outputs: Typed `CreateConversationInput`, or throws validation error.
   */
  const parsed = createConversationSchema.safeParse(input);
  if (!parsed.success) {
    throw new ConversationServiceError("VALIDATION", 400, "Invalid conversation payload.");
  }

  return parsed.data;
}

export async function createConversationForAccount(
  accountId: number,
  input: unknown
): Promise<ConversationView> {
  /**
   * Purpose: Creates a conversation only when the target panel is owned by account.
   * Inputs: Authenticated account id and conversation payload.
   * Outputs: Created conversation DTO with empty ordered prompt list.
   */
  const parsed = parseCreateConversationInput(input);

  const ownedPanel = await prisma.panel.findFirst({
    where: {
      id: parsed.panelId,
      accountId
    },
    select: { id: true }
  });

  if (!ownedPanel) {
    throw new ConversationServiceError("NOT_FOUND", 404, "Panel not found.");
  }

  return prisma.conversation.create({
    data: {
      panelId: parsed.panelId,
      name: parsed.name
    },
    select: {
      id: true,
      panelId: true,
      name: true,
      lastPromptedAt: true,
      prompts: {
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        select: {
          id: true,
          conversationId: true,
          sequence: true,
          content: true,
          createdAt: true,
          responses: {
            orderBy: [{ sequence: "asc" }, { id: "asc" }],
            select: {
              id: true,
              promptId: true,
              expertId: true,
              sequence: true,
              content: true,
              createdAt: true
            }
          }
        }
      }
    }
  });
}

export async function listConversationsForPanelForAccount(
  accountId: number,
  panelId: number
): Promise<ConversationListItemView[]> {
  /**
   * Purpose: Lists conversations for one account-owned panel with recency-first ordering.
   * Inputs: Authenticated account id and panel id.
   * Outputs: Lightweight conversation list for panel navigation.
   */
  const ownedPanel = await prisma.panel.findFirst({
    where: {
      id: panelId,
      accountId
    },
    select: { id: true }
  });

  if (!ownedPanel) {
    throw new ConversationServiceError("NOT_FOUND", 404, "Panel not found.");
  }

  return prisma.conversation.findMany({
    where: { panelId },
    orderBy: [{ lastPromptedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      panelId: true,
      name: true,
      lastPromptedAt: true
    }
  });
}

export async function getConversationForAccount(
  accountId: number,
  conversationId: number
): Promise<ConversationView> {
  /**
   * Purpose: Loads one conversation only when it belongs to account-owned panel tree.
   * Inputs: Authenticated account id and requested conversation id.
   * Outputs: Conversation DTO with prompts/responses in stable sequence order.
   */
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      panel: {
        accountId
      }
    },
    select: {
      id: true,
      panelId: true,
      name: true,
      lastPromptedAt: true,
      prompts: {
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        select: {
          id: true,
          conversationId: true,
          sequence: true,
          content: true,
          createdAt: true,
          responses: {
            orderBy: [{ sequence: "asc" }, { id: "asc" }],
            select: {
              id: true,
              promptId: true,
              expertId: true,
              sequence: true,
              content: true,
              createdAt: true
            }
          }
        }
      }
    }
  });

  if (!conversation) {
    throw new ConversationServiceError("NOT_FOUND", 404, "Conversation not found.");
  }

  return conversation;
}

export function mapConversationErrorToHttp(error: unknown): {
  status: number;
  message: string;
} {
  /**
   * Purpose: Converts conversation-domain errors into stable HTTP response metadata.
   * Inputs: Unknown thrown error value.
   * Outputs: Safe HTTP status/message pair for API responses.
   */
  if (error instanceof ConversationServiceError) {
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

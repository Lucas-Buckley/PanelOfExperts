/**
 * Purpose: Encapsulates panel/conversation recency ordering updates and queries.
 * Inputs: Conversation/panel/account identifiers and optional transaction/timestamp.
 * Outputs: Updated recency fields or ordered query result lists.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function markPromptActivity(args: {
  conversationId: number;
  promptedAt?: Date;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  /**
   * Purpose: Updates recency markers for a prompted conversation and its parent panel.
   * Inputs: Conversation id, optional prompt timestamp, and optional transaction client.
   * Outputs: No return value; writes recency updates to database.
   */
  const db: DbClient = args.tx ?? prisma;
  const promptedAt = args.promptedAt ?? new Date();

  const conversation = await db.conversation.update({
    where: { id: args.conversationId },
    data: { lastPromptedAt: promptedAt },
    select: { panelId: true }
  });

  await db.panel.update({
    where: { id: conversation.panelId },
    data: { lastPromptedAt: promptedAt }
  });
}

export async function listConversationsByRecentPrompt(panelId: number) {
  /**
   * Purpose: Lists a panel's conversations ordered by latest prompt activity.
   * Inputs: Panel id.
   * Outputs: Conversation list sorted by `lastPromptedAt DESC, id DESC`.
   */
  return prisma.conversation.findMany({
    where: { panelId },
    orderBy: [{ lastPromptedAt: "desc" }, { id: "desc" }]
  });
}

export async function listPanelsByRecentPrompt(accountId: number) {
  /**
   * Purpose: Lists an account's panels ordered by latest prompt activity.
   * Inputs: Account id.
   * Outputs: Panel list sorted by `lastPromptedAt DESC, id DESC`.
   */
  return prisma.panel.findMany({
    where: { accountId },
    orderBy: [{ lastPromptedAt: "desc" }, { id: "desc" }]
  });
}

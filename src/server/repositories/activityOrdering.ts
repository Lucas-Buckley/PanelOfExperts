import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function markPromptActivity(args: {
  conversationId: number;
  promptedAt?: Date;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
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
  return prisma.conversation.findMany({
    where: { panelId },
    orderBy: [{ lastPromptedAt: "desc" }, { id: "desc" }]
  });
}

export async function listPanelsByRecentPrompt(accountId: number) {
  return prisma.panel.findMany({
    where: { accountId },
    orderBy: [{ lastPromptedAt: "desc" }, { id: "desc" }]
  });
}

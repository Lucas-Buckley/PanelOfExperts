/**
 * Purpose: Implements prompt creation flow with ownership checks, panel-runner call, and response persistence.
 * Inputs: Authenticated account id, conversation id, and prompt payload.
 * Outputs: Persisted prompt + ordered responses for API return.
 */
import { z } from "zod";

import { appConfig } from "../../config/appConfig";
import { prisma } from "../../lib/db";
import { markPromptActivity } from "../repositories/activityOrdering";
import {
  estimatePanelMaxTokens,
  runPanel,
  type PanelRunnerHistoryPromptInput
} from "./panelRunner";

const createPromptSchema = z.object({
  content: z.string().trim().min(1).max(appConfig.llmMaxUserPromptChars)
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
  code: "VALIDATION" | "NOT_FOUND" | "RATE_LIMIT";
  status: 400 | 404 | 429;

  constructor(
    code: "VALIDATION" | "NOT_FOUND" | "RATE_LIMIT",
    status: 400 | 404 | 429,
    message: string
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type LlmDailyUsageReservation = {
  usageDate: Date;
  model: string;
  reservedTokens: number;
};

function toUtcDateOnly(date: Date): Date {
  /**
   * Purpose: Normalizes a timestamp to UTC day precision for daily usage ledger keys.
   * Inputs: Any timestamp date.
   * Outputs: New Date pinned to UTC midnight for the same calendar day.
   */
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

function normalizeTokenCount(value: number): number {
  /**
   * Purpose: Converts token counts to safe non-negative integers for persistence.
   * Inputs: Raw numeric token count value.
   * Outputs: Non-negative integer token count.
   */
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

async function reserveDailyTokens(estimatedTokens: number): Promise<LlmDailyUsageReservation> {
  /**
   * Purpose: Atomically reserves estimated daily tokens before invoking live/simulated panel calls.
   * Inputs: Conservative estimated token cost for the upcoming panel execution.
   * Outputs: Reservation metadata used for later reconcile/release actions.
   */
  const normalizedEstimate = normalizeTokenCount(estimatedTokens);
  const usageDate = toUtcDateOnly(new Date());
  const model = appConfig.openAiModel;

  if (normalizedEstimate === 0) {
    return {
      usageDate,
      model,
      reservedTokens: 0
    };
  }

  await prisma.llmUsageDaily.upsert({
    where: {
      usageDate_model: {
        usageDate,
        model
      }
    },
    create: {
      usageDate,
      model,
      usedTokens: 0
    },
    update: {}
  });

  const maxUsedBeforeReservation = appConfig.llmMaxDailyTokens - normalizedEstimate;
  if (maxUsedBeforeReservation < 0) {
    throw new PromptServiceError(
      "RATE_LIMIT",
      429,
      `Estimated request size exceeds daily cap of ${appConfig.llmMaxDailyTokens.toLocaleString()} tokens.`
    );
  }

  const reservationResult = await prisma.llmUsageDaily.updateMany({
    where: {
      usageDate,
      model,
      usedTokens: {
        lte: maxUsedBeforeReservation
      }
    },
    data: {
      usedTokens: {
        increment: normalizedEstimate
      }
    }
  });

  if (reservationResult.count !== 1) {
    throw new PromptServiceError(
      "RATE_LIMIT",
      429,
      `Daily token cap reached (${appConfig.llmMaxDailyTokens.toLocaleString()} tokens/day).`
    );
  }

  return {
    usageDate,
    model,
    reservedTokens: normalizedEstimate
  };
}

async function releaseReservedDailyTokens(reservation: LlmDailyUsageReservation): Promise<void> {
  /**
   * Purpose: Releases reserved daily tokens when panel execution fails before real usage is known.
   * Inputs: Daily token reservation metadata.
   * Outputs: None.
   */
  if (reservation.reservedTokens === 0) {
    return;
  }

  await prisma.llmUsageDaily.updateMany({
    where: {
      usageDate: reservation.usageDate,
      model: reservation.model,
      usedTokens: {
        gte: reservation.reservedTokens
      }
    },
    data: {
      usedTokens: {
        decrement: reservation.reservedTokens
      }
    }
  });
}

async function reconcileReservedDailyTokens(
  reservation: LlmDailyUsageReservation,
  actualTokens: number
): Promise<void> {
  /**
   * Purpose: Reconciles reserved token usage against actual provider token usage totals.
   * Inputs: Reservation metadata and actual total tokens consumed by the panel run.
   * Outputs: None.
   */
  const normalizedActual = normalizeTokenCount(actualTokens);
  if (normalizedActual === reservation.reservedTokens) {
    return;
  }

  if (normalizedActual < reservation.reservedTokens) {
    const refund = reservation.reservedTokens - normalizedActual;
    await prisma.llmUsageDaily.updateMany({
      where: {
        usageDate: reservation.usageDate,
        model: reservation.model,
        usedTokens: {
          gte: refund
        }
      },
      data: {
        usedTokens: {
          decrement: refund
        }
      }
    });
    return;
  }

  const additionalTokens = normalizedActual - reservation.reservedTokens;
  await prisma.llmUsageDaily.updateMany({
    where: {
      usageDate: reservation.usageDate,
      model: reservation.model
    },
    data: {
      usedTokens: {
        increment: additionalTokens
      }
    }
  });
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

function mapPromptHistoryForRunner(
  rows: Array<{
    sequence: number;
    content: string;
    responses: Array<{
      expertId: number;
      sequence: number;
      content: string;
      expert: {
        name: string;
      };
    }>;
  }>
): PanelRunnerHistoryPromptInput[] {
  /**
   * Purpose: Maps persisted prompt/response history into panel-runner context shape.
   * Inputs: Prompt rows with nested ordered responses and expert names.
   * Outputs: Chronological history records for prompt composition.
   */
  const chronologicalRows = [...rows].sort(
    (left, right) => left.sequence - right.sequence
  );

  return chronologicalRows.map((historyPrompt) => ({
    sequence: historyPrompt.sequence,
    content: historyPrompt.content,
    responses: historyPrompt.responses.map((historyResponse) => ({
      expertId: historyResponse.expertId,
      expertName: historyResponse.expert.name,
      sequence: historyResponse.sequence,
      content: historyResponse.content
    }))
  }));
}

function estimateHistoryPromptSize(prompt: PanelRunnerHistoryPromptInput): number {
  /**
   * Purpose: Estimates prompt-history cost using lightweight character-size proxy.
   * Inputs: One mapped prompt history record.
   * Outputs: Approximate character footprint for budgeting context window selection.
   */
  const responseSize = prompt.responses.reduce(
    (total, response) =>
      total +
      response.content.length +
      response.expertName.length +
      response.sequence.toString().length,
    0
  );

  return prompt.content.length + prompt.sequence.toString().length + responseSize;
}

function applyHistoryBudget(
  history: PanelRunnerHistoryPromptInput[],
  charBudget: number
): PanelRunnerHistoryPromptInput[] {
  /**
   * Purpose: Selects recent conversation history within a character budget and optional first-turn anchor.
   * Inputs: Chronological history and max character budget.
   * Outputs: Budget-constrained chronological history subset for prompt composition.
   */
  if (history.length === 0) {
    return [];
  }

  let used = 0;
  const selectedRecentReverse: PanelRunnerHistoryPromptInput[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    const size = estimateHistoryPromptSize(item);
    if (selectedRecentReverse.length > 0 && used + size > charBudget) {
      break;
    }

    selectedRecentReverse.push(item);
    used += size;
  }

  const selectedRecent = selectedRecentReverse.reverse();
  const firstPrompt = history[0];
  const includesFirstPrompt = selectedRecent.some(
    (item) => item.sequence === firstPrompt.sequence
  );
  if (includesFirstPrompt) {
    return selectedRecent;
  }

  const firstPromptSize = estimateHistoryPromptSize(firstPrompt);
  if (used + firstPromptSize <= charBudget) {
    return [firstPrompt, ...selectedRecent];
  }

  return selectedRecent;
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
      panel: {
        select: {
          name: true,
          instructions: true
        }
      }
    }
  });

  if (!conversation) {
    throw new PromptServiceError("NOT_FOUND", 404, "Conversation not found.");
  }

  const experts = await prisma.expert.findMany({
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

  const historyRows = await prisma.prompt.findMany({
    where: {
      conversationId
    },
    orderBy: [{ sequence: "desc" }, { id: "desc" }],
    take: appConfig.llmHistoryPromptFetchLimit,
    select: {
      sequence: true,
      content: true,
      responses: {
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        select: {
          expertId: true,
          sequence: true,
          content: true,
          expert: {
            select: {
              name: true
            }
          }
        }
      }
    }
  });
  const mappedHistory = mapPromptHistoryForRunner(historyRows);
  const history = applyHistoryBudget(mappedHistory, appConfig.llmHistoryCharBudget);
  const estimatedPanelTokens = estimatePanelMaxTokens(experts.length);
  const reservation = await reserveDailyTokens(estimatedPanelTokens);

  let panelResult: Awaited<ReturnType<typeof runPanel>>;
  try {
    panelResult = await runPanel({
      conversationId,
      panelId: conversation.panelId,
      panelName: conversation.panel.name,
      panelInstructions: conversation.panel.instructions,
      promptContent: parsed.content,
      history,
      experts
    });
  } catch (error) {
    try {
      await releaseReservedDailyTokens(reservation);
    } catch (releaseError) {
      console.error("Failed to release reserved daily tokens after panel error:", releaseError);
    }
    throw error;
  }

  await reconcileReservedDailyTokens(reservation, panelResult.usage.total_tokens);

  const validExpertIds = new Set(experts.map((expert) => expert.id));

  return prisma.$transaction(async (tx) => {
    const ownedConversation = await tx.conversation.findFirst({
      where: {
        id: conversationId,
        panel: {
          accountId
        }
      },
      select: {
        id: true
      }
    });
    if (!ownedConversation) {
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
        content: parsed.content,
        llmInputTokens: panelResult.usage.input_tokens,
        llmOutputTokens: panelResult.usage.output_tokens,
        llmTotalTokens: panelResult.usage.total_tokens
      },
      select: {
        id: true,
        conversationId: true,
        sequence: true,
        content: true,
        createdAt: true
      }
    });

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

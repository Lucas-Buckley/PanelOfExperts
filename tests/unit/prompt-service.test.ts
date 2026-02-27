import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  conversation: { findFirst: vi.fn() },
  prompt: { findMany: vi.fn() },
  expert: { findMany: vi.fn() },
  llmUsageDaily: { upsert: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn()
}));

const markPromptActivityMock = vi.hoisted(() => ({
  markPromptActivity: vi.fn()
}));

const panelRunnerMock = vi.hoisted(() => ({
  runPanel: vi.fn(),
  estimatePanelMaxTokens: vi.fn()
}));

vi.mock("../../src/lib/db", () => ({
  prisma: prismaMock
}));

vi.mock("../../src/server/repositories/activityOrdering", () => ({
  markPromptActivity: markPromptActivityMock.markPromptActivity
}));

vi.mock("../../src/server/services/panelRunner", () => ({
  runPanel: panelRunnerMock.runPanel,
  estimatePanelMaxTokens: panelRunnerMock.estimatePanelMaxTokens
}));

import { createPromptForConversation } from "../../src/server/services/promptService";

type TxClient = {
  conversation: { findFirst: ReturnType<typeof vi.fn> };
  prompt: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  expert: { findMany: ReturnType<typeof vi.fn> };
  response: { create: ReturnType<typeof vi.fn> };
  panel: { update: ReturnType<typeof vi.fn> };
};

function createTxClient(): TxClient {
  /**
   * Purpose: Creates an isolated transaction-client mock for prompt service tests.
   * Inputs: None.
   * Outputs: Mock transaction client with Prisma model methods.
   */
  return {
    conversation: { findFirst: vi.fn() },
    prompt: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    expert: { findMany: vi.fn() },
    response: { create: vi.fn() },
    panel: { update: vi.fn() }
  };
}

beforeEach(() => {
  prismaMock.conversation.findFirst.mockReset();
  prismaMock.prompt.findMany.mockReset();
  prismaMock.expert.findMany.mockReset();
  prismaMock.llmUsageDaily.upsert.mockReset();
  prismaMock.llmUsageDaily.updateMany.mockReset();
  prismaMock.$transaction.mockReset();
  markPromptActivityMock.markPromptActivity.mockReset();
  panelRunnerMock.runPanel.mockReset();
  panelRunnerMock.estimatePanelMaxTokens.mockReset();
  prismaMock.llmUsageDaily.upsert.mockResolvedValue({
    usageDate: new Date("2026-02-26T00:00:00.000Z"),
    model: "gpt-5-nano-2025-08-07",
    usedTokens: 0
  });
  prismaMock.llmUsageDaily.updateMany.mockResolvedValue({ count: 1 });
  panelRunnerMock.estimatePanelMaxTokens.mockReturnValue(1000);
});

describe("prompt service", () => {
  it("rejects invalid conversation ownership", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await expect(
      createPromptForConversation(7, 88, {
        content: "hello"
      })
    ).rejects.toMatchObject({
      status: 404
    });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(panelRunnerMock.runPanel).not.toHaveBeenCalled();
  });

  it("creates prompt before responses and links response foreign keys correctly", async () => {
    const tx = createTxClient();
    const callOrder: string[] = [];

    prismaMock.conversation.findFirst.mockResolvedValue({
      id: 88,
      panelId: 42,
      panel: {
        name: "Launch Council",
        instructions: "Use practical, testable advice."
      }
    });
    prismaMock.prompt.findMany.mockResolvedValue([]);
    prismaMock.expert.findMany.mockResolvedValue([
      { id: 2, name: "A", specialization: "X", soul: "Y", position: 1 },
      { id: 5, name: "B", specialization: "X", soul: "Y", position: 2 }
    ]);

    tx.conversation.findFirst.mockResolvedValue({ id: 88 });
    tx.prompt.findFirst.mockResolvedValue({
      sequence: 4
    });
    tx.prompt.create.mockImplementation(async (args: { data: { sequence: number } }) => {
      callOrder.push("prompt.create");
      return {
        id: 501,
        conversationId: 88,
        sequence: args.data.sequence,
        content: "hello team",
        createdAt: new Date("2026-02-22T00:00:00.000Z")
      };
    });
    tx.response.create.mockImplementation(async (args: { data: { expertId: number; promptId: number } }) => {
      callOrder.push(`response.create.${args.data.expertId}`);
      return {
        id: args.data.expertId === 2 ? 701 : 702,
        promptId: args.data.promptId,
        expertId: args.data.expertId,
        sequence: args.data.expertId === 2 ? 1 : 2,
        content: `resp-${args.data.expertId}`,
        createdAt: new Date("2026-02-22T00:00:01.000Z")
      };
    });

    panelRunnerMock.runPanel.mockReturnValue({
      mode: "executed",
      responses: [
        { expertId: 2, expertName: "A", sequence: 1, content: "resp-2" },
        { expertId: 5, expertName: "B", sequence: 2, content: "resp-5" }
      ],
      usage: {
        input_tokens: 80,
        output_tokens: 120,
        total_tokens: 200
      }
    });

    prismaMock.$transaction.mockImplementation(async (cb: (txArg: TxClient) => unknown) => cb(tx));

    const result = await createPromptForConversation(7, 88, {
      content: "hello team"
    });

    expect(callOrder[0]).toBe("prompt.create");
    expect(callOrder[1]).toBe("response.create.2");
    expect(callOrder[2]).toBe("response.create.5");
    expect(panelRunnerMock.runPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        panelName: "Launch Council"
      })
    );

    expect(tx.response.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          promptId: 501,
          expertId: 2
        })
      })
    );
    expect(tx.response.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          promptId: 501,
          expertId: 5
        })
      })
    );
    expect(tx.prompt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          llmInputTokens: 80,
          llmOutputTokens: 120,
          llmTotalTokens: 200
        })
      })
    );

    expect(result.prompt.id).toBe(501);
    expect(result.responses).toHaveLength(2);
  });

  it("passes recency history under budget with first-prompt anchor when possible", async () => {
    const tx = createTxClient();

    prismaMock.conversation.findFirst.mockResolvedValue({
      id: 88,
      panelId: 42,
      panel: {
        name: "Launch Council",
        instructions: "Use practical, testable advice."
      }
    });
    prismaMock.expert.findMany.mockResolvedValue([
      { id: 2, name: "A", specialization: "X", soul: "Y", position: 1 }
    ]);
    prismaMock.prompt.findMany.mockResolvedValue([
      {
        sequence: 10,
        content: "x".repeat(9000),
        responses: []
      },
      {
        sequence: 9,
        content: "y".repeat(9000),
        responses: []
      },
      {
        sequence: 1,
        content: "z".repeat(100),
        responses: []
      }
    ]);

    tx.conversation.findFirst.mockResolvedValue({ id: 88 });
    tx.prompt.findFirst.mockResolvedValue({
      sequence: 10
    });
    tx.prompt.create.mockResolvedValue({
      id: 777,
      conversationId: 88,
      sequence: 11,
      content: "new prompt",
      createdAt: new Date("2026-02-22T00:00:00.000Z")
    });
    tx.response.create.mockResolvedValue({
      id: 901,
      promptId: 777,
      expertId: 2,
      sequence: 1,
      content: "resp",
      createdAt: new Date("2026-02-22T00:00:01.000Z")
    });
    panelRunnerMock.runPanel.mockReturnValue({
      mode: "executed",
      responses: [{ expertId: 2, expertName: "A", sequence: 1, content: "resp" }],
      usage: {
        input_tokens: 50,
        output_tokens: 60,
        total_tokens: 110
      }
    });

    prismaMock.$transaction.mockImplementation(async (cb: (txArg: TxClient) => unknown) => cb(tx));

    await createPromptForConversation(7, 88, {
      content: "new prompt"
    });

    expect(panelRunnerMock.runPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        history: expect.arrayContaining([
          expect.objectContaining({ sequence: 1 }),
          expect.objectContaining({ sequence: 10 })
        ])
      })
    );

    const runnerArgs = panelRunnerMock.runPanel.mock.calls[0][0] as {
      history: Array<{ sequence: number }>;
    };
    expect(runnerArgs.history.map((item) => item.sequence)).toEqual([1, 10]);
  });

  it("rejects prompt execution when daily token cap reservation fails", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue({
      id: 88,
      panelId: 42,
      panel: {
        name: "Launch Council",
        instructions: "Use practical, testable advice."
      }
    });
    prismaMock.prompt.findMany.mockResolvedValue([]);
    prismaMock.expert.findMany.mockResolvedValue([
      { id: 2, name: "A", specialization: "X", soul: "Y", position: 1 }
    ]);
    prismaMock.llmUsageDaily.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      createPromptForConversation(7, 88, {
        content: "new prompt"
      })
    ).rejects.toMatchObject({
      status: 429
    });

    expect(panelRunnerMock.runPanel).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

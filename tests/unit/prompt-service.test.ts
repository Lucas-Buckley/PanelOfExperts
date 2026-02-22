import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn()
}));

const markPromptActivityMock = vi.hoisted(() => ({
  markPromptActivity: vi.fn()
}));

const panelRunnerMock = vi.hoisted(() => ({
  runPanel: vi.fn()
}));

vi.mock("../../src/lib/db", () => ({
  prisma: prismaMock
}));

vi.mock("../../src/server/repositories/activityOrdering", () => ({
  markPromptActivity: markPromptActivityMock.markPromptActivity
}));

vi.mock("../../src/server/services/panelRunner", () => ({
  runPanel: panelRunnerMock.runPanel
}));

import { createPromptForConversation } from "../../src/server/services/promptService";

type TxClient = {
  conversation: { findFirst: ReturnType<typeof vi.fn> };
  prompt: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
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
    prompt: { findFirst: vi.fn(), create: vi.fn() },
    expert: { findMany: vi.fn() },
    response: { create: vi.fn() },
    panel: { update: vi.fn() }
  };
}

beforeEach(() => {
  prismaMock.$transaction.mockReset();
  markPromptActivityMock.markPromptActivity.mockReset();
  panelRunnerMock.runPanel.mockReset();
});

describe("prompt service", () => {
  it("rejects invalid conversation ownership", async () => {
    const tx = createTxClient();
    tx.conversation.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(async (cb: (txArg: TxClient) => unknown) => cb(tx));

    await expect(
      createPromptForConversation(7, 88, {
        content: "hello"
      })
    ).rejects.toMatchObject({
      status: 404
    });

    expect(tx.prompt.create).not.toHaveBeenCalled();
    expect(tx.response.create).not.toHaveBeenCalled();
  });

  it("creates prompt before responses and links response foreign keys correctly", async () => {
    const tx = createTxClient();
    const callOrder: string[] = [];

    tx.conversation.findFirst.mockResolvedValue({
      id: 88,
      panelId: 42
    });
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
    tx.expert.findMany.mockResolvedValue([
      { id: 2, name: "A", specialization: "X", soul: "Y", position: 1 },
      { id: 5, name: "B", specialization: "X", soul: "Y", position: 2 }
    ]);
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
      mode: "placeholder",
      responses: [
        { expertId: 2, sequence: 1, content: "resp-2" },
        { expertId: 5, sequence: 2, content: "resp-5" }
      ]
    });

    prismaMock.$transaction.mockImplementation(async (cb: (txArg: TxClient) => unknown) => cb(tx));

    const result = await createPromptForConversation(7, 88, {
      content: "hello team"
    });

    expect(callOrder[0]).toBe("prompt.create");
    expect(callOrder[1]).toBe("response.create.2");
    expect(callOrder[2]).toBe("response.create.5");

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

    expect(result.prompt.id).toBe(501);
    expect(result.responses).toHaveLength(2);
  });
});

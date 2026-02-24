import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  panel: {
    findFirst: vi.fn()
  },
  conversation: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn()
  }
}));

vi.mock("../../src/lib/db", () => ({
  prisma: prismaMock
}));

import {
  createConversationForAccount,
  getConversationForAccount,
  listConversationsForPanelForAccount
} from "../../src/server/services/conversationService";

beforeEach(() => {
  prismaMock.panel.findFirst.mockReset();
  prismaMock.conversation.create.mockReset();
  prismaMock.conversation.findFirst.mockReset();
  prismaMock.conversation.findMany.mockReset();
});

describe("conversation service", () => {
  it("conversation creation requires valid panel ownership", async () => {
    prismaMock.panel.findFirst.mockResolvedValue(null);

    await expect(
      createConversationForAccount(5, {
        panelId: 999,
        name: "Planning Chat"
      })
    ).rejects.toMatchObject({
      status: 404
    });

    expect(prismaMock.conversation.create).not.toHaveBeenCalled();
  });

  it("creates conversation when panel is owned by account", async () => {
    prismaMock.panel.findFirst.mockResolvedValue({ id: 10 });
    prismaMock.conversation.create.mockResolvedValue({
      id: 40,
      panelId: 10,
      name: "Planning Chat",
      lastPromptedAt: null,
      prompts: []
    });

    const created = await createConversationForAccount(5, {
      panelId: 10,
      name: "Planning Chat"
    });

    expect(created.id).toBe(40);
    expect(prismaMock.panel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 10,
        accountId: 5
      },
      select: { id: true }
    });
  });

  it("conversation retrieval returns prompts/responses in stable order", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue({
      id: 77,
      panelId: 12,
      name: "Thread",
      lastPromptedAt: null,
      prompts: [
        {
          id: 1,
          conversationId: 77,
          sequence: 1,
          content: "First prompt",
          createdAt: new Date(),
          responses: []
        }
      ]
    });

    const loaded = await getConversationForAccount(5, 77);

    expect(loaded.id).toBe(77);
    expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 77,
          panel: {
            accountId: 5
          }
        },
        select: expect.objectContaining({
          prompts: expect.objectContaining({
            orderBy: [{ sequence: "asc" }, { id: "asc" }],
            select: expect.objectContaining({
              responses: expect.objectContaining({
                orderBy: [{ sequence: "asc" }, { id: "asc" }]
              })
            })
          })
        })
      })
    );
  });

  it("lists conversations for owned panel in recency order", async () => {
    prismaMock.panel.findFirst.mockResolvedValue({ id: 12 });
    prismaMock.conversation.findMany.mockResolvedValue([
      {
        id: 90,
        panelId: 12,
        name: "Newest",
        lastPromptedAt: new Date("2026-02-24T02:00:00.000Z")
      },
      {
        id: 88,
        panelId: 12,
        name: "Older",
        lastPromptedAt: new Date("2026-02-23T21:00:00.000Z")
      }
    ]);

    const listed = await listConversationsForPanelForAccount(5, { panelId: 12 });

    expect(listed).toHaveLength(2);
    expect(prismaMock.panel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 12,
        accountId: 5
      },
      select: { id: true }
    });
    expect(prismaMock.conversation.findMany).toHaveBeenCalledWith({
      where: {
        panelId: 12
      },
      orderBy: [{ lastPromptedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        panelId: true,
        name: true,
        lastPromptedAt: true
      }
    });
  });

  it("rejects conversation listing when panel is not owned", async () => {
    prismaMock.panel.findFirst.mockResolvedValue(null);

    await expect(
      listConversationsForPanelForAccount(7, { panelId: 400 })
    ).rejects.toMatchObject({
      status: 404
    });

    expect(prismaMock.conversation.findMany).not.toHaveBeenCalled();
  });
});

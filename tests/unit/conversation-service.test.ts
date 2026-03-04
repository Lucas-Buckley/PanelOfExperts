import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  panel: {
    findFirst: vi.fn()
  },
  conversation: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  }
}));

vi.mock("../../src/lib/db", () => ({
  prisma: prismaMock
}));

import {
  createConversationForAccount,
  deleteConversationForAccount,
  getConversationForAccount,
  listConversationsForPanelForAccount,
  renameConversationForAccount
} from "../../src/server/services/conversationService";

beforeEach(() => {
  prismaMock.panel.findFirst.mockReset();
  prismaMock.conversation.create.mockReset();
  prismaMock.conversation.findFirst.mockReset();
  prismaMock.conversation.findMany.mockReset();
  prismaMock.conversation.update.mockReset();
  prismaMock.conversation.delete.mockReset();
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

  it("lists conversations for an owned panel in recency order", async () => {
    const now = new Date("2026-03-02T10:00:00.000Z");
    prismaMock.panel.findFirst.mockResolvedValue({ id: 10 });
    prismaMock.conversation.findMany.mockResolvedValue([
      {
        id: 300,
        panelId: 10,
        name: "Newest",
        lastPromptedAt: now
      },
      {
        id: 299,
        panelId: 10,
        name: "Older",
        lastPromptedAt: null
      }
    ]);

    const listed = await listConversationsForPanelForAccount(5, 10);

    expect(listed).toHaveLength(2);
    expect(prismaMock.panel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 10,
        accountId: 5
      },
      select: { id: true }
    });
    expect(prismaMock.conversation.findMany).toHaveBeenCalledWith({
      where: { panelId: 10 },
      orderBy: [{ lastPromptedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        panelId: true,
        name: true,
        lastPromptedAt: true
      }
    });
  });

  it("rejects listing conversations for a panel not owned by account", async () => {
    prismaMock.panel.findFirst.mockResolvedValue(null);

    await expect(listConversationsForPanelForAccount(5, 999)).rejects.toMatchObject({
      status: 404
    });

    expect(prismaMock.conversation.findMany).not.toHaveBeenCalled();
  });

  it("deletes conversation for owner", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue({ id: 77 });
    prismaMock.conversation.delete.mockResolvedValue({ id: 77 });

    const deleted = await deleteConversationForAccount(5, 77);

    expect(deleted).toEqual({ id: 77 });
    expect(prismaMock.conversation.delete).toHaveBeenCalledWith({
      where: { id: 77 }
    });
  });

  it("denies conversation deletion for non-owner", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await expect(deleteConversationForAccount(5, 77)).rejects.toMatchObject({
      status: 404
    });

    expect(prismaMock.conversation.delete).not.toHaveBeenCalled();
  });

  it("renames conversation for owner", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue({ id: 77 });
    prismaMock.conversation.update.mockResolvedValue({
      id: 77,
      panelId: 10,
      name: "Renamed Conversation",
      lastPromptedAt: null
    });

    const renamed = await renameConversationForAccount(5, 77, {
      name: "Renamed Conversation"
    });

    expect(renamed).toMatchObject({
      id: 77,
      panelId: 10,
      name: "Renamed Conversation"
    });
    expect(prismaMock.conversation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 77,
        panel: {
          accountId: 5
        }
      },
      select: { id: true }
    });
    expect(prismaMock.conversation.update).toHaveBeenCalledWith({
      where: {
        id: 77
      },
      data: {
        name: "Renamed Conversation"
      },
      select: {
        id: true,
        panelId: true,
        name: true,
        lastPromptedAt: true
      }
    });
  });

  it("denies conversation rename for non-owner", async () => {
    prismaMock.conversation.findFirst.mockResolvedValue(null);

    await expect(
      renameConversationForAccount(5, 77, {
        name: "Renamed Conversation"
      })
    ).rejects.toMatchObject({
      status: 404
    });

    expect(prismaMock.conversation.update).not.toHaveBeenCalled();
  });

  it("validates conversation rename payload", async () => {
    await expect(
      renameConversationForAccount(5, 77, {
        name: "   "
      })
    ).rejects.toMatchObject({
      status: 400
    });
  });
});

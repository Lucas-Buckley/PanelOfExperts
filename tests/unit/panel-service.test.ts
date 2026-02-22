import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  panel: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn()
  }
}));

vi.mock("../../src/lib/db", () => ({
  prisma: prismaMock
}));

import { createPanelForAccount, getPanelForAccount } from "../../src/server/services/panelService";

beforeEach(() => {
  prismaMock.panel.create.mockReset();
  prismaMock.panel.findMany.mockReset();
  prismaMock.panel.findFirst.mockReset();
});

describe("panel service", () => {
  it("panel creation persists nested experts correctly", async () => {
    prismaMock.panel.create.mockResolvedValue({
      id: 11,
      accountId: 3,
      name: "Founders Council",
      description: "Panel description",
      instructions: "Panel instructions",
      lastPromptedAt: null,
      experts: [
        {
          id: 101,
          name: "Expert A",
          specialization: "Strategy",
          soul: "Concise and skeptical",
          position: 1
        },
        {
          id: 102,
          name: "Expert B",
          specialization: "Execution",
          soul: "Pragmatic and direct",
          position: 2
        }
      ]
    });

    const created = await createPanelForAccount(3, {
      name: "Founders Council",
      description: "Panel description",
      instructions: "Panel instructions",
      experts: [
        {
          name: "Expert A",
          specialization: "Strategy",
          soul: "Concise and skeptical"
        },
        {
          name: "Expert B",
          specialization: "Execution",
          soul: "Pragmatic and direct"
        }
      ]
    });

    expect(created.id).toBe(11);
    expect(prismaMock.panel.create).toHaveBeenCalledTimes(1);
    const createArgs = prismaMock.panel.create.mock.calls[0][0] as {
      data: { accountId: number; experts: { create: Array<{ position: number }> } };
    };
    expect(createArgs.data.accountId).toBe(3);
    expect(createArgs.data.experts.create).toHaveLength(2);
    expect(createArgs.data.experts.create[0]?.position).toBe(1);
    expect(createArgs.data.experts.create[1]?.position).toBe(2);
  });

  it("owner can access panel", async () => {
    prismaMock.panel.findFirst.mockResolvedValue({
      id: 20,
      accountId: 7,
      name: "Owner panel",
      description: null,
      instructions: null,
      lastPromptedAt: null,
      experts: []
    });

    const panel = await getPanelForAccount(7, 20);
    expect(panel.id).toBe(20);
    expect(prismaMock.panel.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 20,
          accountId: 7
        }
      })
    );
  });

  it("non-owner is denied for panel read", async () => {
    prismaMock.panel.findFirst.mockResolvedValue(null);

    await expect(getPanelForAccount(99, 20)).rejects.toMatchObject({
      status: 404
    });
  });
});

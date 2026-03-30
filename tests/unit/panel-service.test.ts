import { beforeEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "../../src/config/appConfig";
const prismaMock = vi.hoisted(() => ({
    panel: {
        create: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn()
    },
    expert: {
        update: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn()
    },
    $transaction: vi.fn()
}));
vi.mock("../../src/lib/db", () => ({
    prisma: prismaMock
}));
import { createPanelForAccount, deletePanelForAccount, getPanelForAccount, updatePanelForAccount } from "../../src/server/services/panelService";
beforeEach(() => {
    prismaMock.panel.create.mockReset();
    prismaMock.panel.findMany.mockReset();
    prismaMock.panel.findFirst.mockReset();
    prismaMock.panel.update.mockReset();
    prismaMock.panel.delete.mockReset();
    prismaMock.expert.update.mockReset();
    prismaMock.expert.create.mockReset();
    prismaMock.expert.deleteMany.mockReset();
    prismaMock.$transaction.mockReset();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock));
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
            data: {
                accountId: number;
                experts: {
                    create: Array<{
                        position: number;
                    }>;
                };
            };
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
        expect(prismaMock.panel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: 20,
                accountId: 7
            }
        }));
    });
    it("non-owner is denied for panel read", async () => {
        prismaMock.panel.findFirst.mockResolvedValue(null);
        await expect(getPanelForAccount(99, 20)).rejects.toMatchObject({
            status: 404
        });
    });
    it("rejects panel creation when expert count exceeds safety cap", async () => {
        const tooManyExperts = Array.from({ length: appConfig.llmMaxExpertsPerPanel + 1 }, (_unused, index) => ({
            name: `E${index + 1}`,
            specialization: `S${index + 1}`,
            soul: `Soul ${index + 1}`
        }));
        await expect(createPanelForAccount(3, {
            name: "Too Many Experts",
            experts: tooManyExperts
        })).rejects.toMatchObject({
            status: 400
        });
        expect(prismaMock.panel.create).not.toHaveBeenCalled();
    });
    it("allows missing soul and persists empty-string default", async () => {
        prismaMock.panel.create.mockResolvedValue({
            id: 12,
            accountId: 3,
            name: "No Soul Panel",
            description: null,
            instructions: null,
            lastPromptedAt: null,
            experts: [
                {
                    id: 103,
                    name: "Expert A",
                    specialization: "Strategy",
                    soul: "",
                    position: 1
                }
            ]
        });
        await createPanelForAccount(3, {
            name: "No Soul Panel",
            experts: [
                {
                    name: "Expert A",
                    specialization: "Strategy"
                }
            ]
        });
        const createArgs = prismaMock.panel.create.mock.calls[0][0] as {
            data: {
                experts: {
                    create: Array<{
                        soul: string;
                    }>;
                };
            };
        };
        expect(createArgs.data.experts.create[0]?.soul).toBe("");
    });
    it("updates panel metadata for owner", async () => {
        prismaMock.panel.findFirst.mockResolvedValue({ id: 20 });
        prismaMock.panel.update.mockResolvedValue({
            id: 20,
            accountId: 7,
            name: "Revised panel",
            description: "Updated description",
            instructions: null,
            lastPromptedAt: null,
            experts: []
        });
        const updated = await updatePanelForAccount(7, 20, {
            name: "Revised panel",
            description: "Updated description",
            instructions: ""
        });
        expect(updated.name).toBe("Revised panel");
        expect(prismaMock.panel.findFirst).toHaveBeenCalledWith({
            where: {
                id: 20,
                accountId: 7
            },
            select: { id: true }
        });
        expect(prismaMock.panel.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 20 },
            data: {
                name: "Revised panel",
                description: "Updated description",
                instructions: null
            }
        }));
    });
    it("updates panel experts when roster changes are valid", async () => {
        prismaMock.panel.findFirst
            .mockResolvedValueOnce({
            id: 20,
            experts: [
                {
                    id: 201,
                    position: 1,
                    _count: {
                        responses: 0
                    }
                },
                {
                    id: 202,
                    position: 2,
                    _count: {
                        responses: 0
                    }
                }
            ]
        })
            .mockResolvedValueOnce({
            id: 20,
            accountId: 7,
            name: "Revised panel",
            description: "Updated description",
            instructions: "Tighten reasoning",
            lastPromptedAt: null,
            experts: [
                {
                    id: 201,
                    name: "Expert A",
                    specialization: "Strategy",
                    soul: "Concise",
                    position: 1
                },
                {
                    id: 203,
                    name: "Expert C",
                    specialization: "Operations",
                    soul: "Pragmatic",
                    position: 2
                }
            ]
        });
        prismaMock.panel.update.mockResolvedValue({ id: 20 });
        prismaMock.expert.update.mockResolvedValue({});
        prismaMock.expert.create.mockResolvedValue({
            id: 203
        });
        prismaMock.expert.deleteMany.mockResolvedValue({
            count: 1
        });
        const updated = await updatePanelForAccount(7, 20, {
            name: "Revised panel",
            description: "Updated description",
            instructions: "Tighten reasoning",
            experts: [
                {
                    id: 201,
                    name: "Expert A",
                    specialization: "Strategy",
                    soul: "Concise"
                },
                {
                    name: "Expert C",
                    specialization: "Operations",
                    soul: "Pragmatic"
                }
            ]
        });
        expect(updated.experts).toHaveLength(2);
        expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
        expect(prismaMock.expert.deleteMany).toHaveBeenCalledWith({
            where: {
                id: {
                    in: [202]
                }
            }
        });
        expect(prismaMock.expert.create).toHaveBeenCalledWith({
            data: {
                panelId: 20,
                name: "Expert C",
                specialization: "Operations",
                soul: "Pragmatic",
                position: 2
            }
        });
        expect(prismaMock.expert.update).toHaveBeenCalledWith({
            where: {
                id: 201
            },
            data: {
                name: "Expert A",
                specialization: "Strategy",
                soul: "Concise",
                position: 1
            }
        });
    });
    it("rejects removing experts that already have responses", async () => {
        prismaMock.panel.findFirst.mockResolvedValue({
            id: 20,
            experts: [
                {
                    id: 201,
                    position: 1,
                    _count: {
                        responses: 2
                    }
                }
            ]
        });
        await expect(updatePanelForAccount(7, 20, {
            experts: [
                {
                    name: "Replacement Expert",
                    specialization: "Operations",
                    soul: "Pragmatic"
                }
            ]
        })).rejects.toMatchObject({
            status: 400
        });
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
    it("deletes panel for owner", async () => {
        prismaMock.panel.findFirst.mockResolvedValue({ id: 20 });
        prismaMock.panel.delete.mockResolvedValue({ id: 20 });
        const deleted = await deletePanelForAccount(7, 20);
        expect(deleted).toEqual({ id: 20 });
        expect(prismaMock.panel.delete).toHaveBeenCalledWith({
            where: { id: 20 }
        });
    });
    it("denies panel deletion for non-owner", async () => {
        prismaMock.panel.findFirst.mockResolvedValue(null);
        await expect(deletePanelForAccount(7, 20)).rejects.toMatchObject({
            status: 404
        });
        expect(prismaMock.panel.delete).not.toHaveBeenCalled();
    });
});

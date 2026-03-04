import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createIdempotencyRequestHash,
  executeWithIdempotency,
  mapIdempotencyErrorToHttp,
  readIdempotencyKeyFromRequest
} from "../../src/server/http/idempotency";

type IdempotencyStoreMock = {
  idempotencyRequest: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

afterEach(() => {
  vi.useRealTimers();
});

function createStoreMock(): IdempotencyStoreMock {
  /**
   * Purpose: Creates an isolated idempotency-store mock with Prisma-like methods.
   * Inputs: None.
   * Outputs: Mock idempotency store object for deterministic unit tests.
   */
  return {
    idempotencyRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn()
    }
  };
}

describe("idempotency http helper", () => {
  it("builds stable request hashes across key order changes", () => {
    const hashA = createIdempotencyRequestHash({
      b: 2,
      a: 1,
      nested: {
        z: true,
        k: "x"
      }
    });
    const hashB = createIdempotencyRequestHash({
      nested: {
        k: "x",
        z: true
      },
      a: 1,
      b: 2
    });

    expect(hashA).toBe(hashB);
  });

  it("reads optional idempotency key header from requests", () => {
    const withKey = new Request("http://localhost/test", {
      headers: {
        "Idempotency-Key": "prompt:abc123"
      }
    });
    const withoutKey = new Request("http://localhost/test");

    expect(readIdempotencyKeyFromRequest(withKey)).toBe("prompt:abc123");
    expect(readIdempotencyKeyFromRequest(withoutKey)).toBeNull();
  });

  it("executes directly when idempotency key is missing", async () => {
    const execute = vi.fn(async () => ({
      status: 201,
      body: {
        ok: true
      }
    }));

    const result = await executeWithIdempotency({
      accountId: 1,
      endpoint: "/api/conversations",
      method: "POST",
      idempotencyKey: null,
      requestHash: createIdempotencyRequestHash({ panelId: 1, name: "A" }),
      execute
    });

    expect(result.replayed).toBe(false);
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("stores completed result on first idempotent execution", async () => {
    const store = createStoreMock();
    store.idempotencyRequest.create.mockResolvedValue({
      id: 1
    });
    store.idempotencyRequest.update.mockResolvedValue({
      id: 1
    });

    const execute = vi.fn(async () => ({
      status: 201,
      body: {
        id: 42,
        panelId: 3,
        name: "New Conversation"
      }
    }));

    const result = await executeWithIdempotency({
      accountId: 7,
      endpoint: "/api/conversations",
      method: "POST",
      idempotencyKey: "conversation:xyz",
      requestHash: createIdempotencyRequestHash({ panelId: 3, name: "New Conversation" }),
      execute,
      store
    });

    expect(result.replayed).toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.idempotencyRequest.create).toHaveBeenCalledTimes(1);
    expect(store.idempotencyRequest.update).toHaveBeenCalledTimes(1);
  });

  it("replays completed response when same key and same request hash are reused", async () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const store = createStoreMock();
    store.idempotencyRequest.create.mockRejectedValue({
      code: "P2002"
    });
    store.idempotencyRequest.findUnique.mockResolvedValue({
      requestHash: createIdempotencyRequestHash({ conversationId: 5, content: "hello" }),
      state: "completed",
      responseStatus: 201,
      responseBody: {
        prompt: {
          id: 100
        },
        responses: []
      },
      expiresAt: new Date("2026-03-04T12:00:00.000Z")
    });

    const execute = vi.fn(async () => ({
      status: 201,
      body: {
        prompt: {
          id: 100
        },
        responses: []
      }
    }));

    const result = await executeWithIdempotency({
      accountId: 7,
      endpoint: "/api/conversations/[conversationId]/prompts",
      method: "POST",
      idempotencyKey: "prompt:xyz",
      requestHash: createIdempotencyRequestHash({ conversationId: 5, content: "hello" }),
      execute,
      store
    });

    expect(result.replayed).toBe(true);
    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      prompt: {
        id: 100
      },
      responses: []
    });
    expect(execute).not.toHaveBeenCalled();

  });

  it("rejects reused key when payload hash differs", async () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const store = createStoreMock();
    store.idempotencyRequest.create.mockRejectedValue({
      code: "P2002"
    });
    store.idempotencyRequest.findUnique.mockResolvedValue({
      requestHash: createIdempotencyRequestHash({ conversationId: 5, content: "old" }),
      state: "completed",
      responseStatus: 201,
      responseBody: {
        id: 1
      },
      expiresAt: new Date("2026-03-04T12:00:00.000Z")
    });

    const execute = vi.fn(async () => ({
      status: 201,
      body: {
        id: 2
      }
    }));

    await expect(
      executeWithIdempotency({
        accountId: 7,
        endpoint: "/api/conversations/[conversationId]/prompts",
        method: "POST",
        idempotencyKey: "prompt:xyz",
        requestHash: createIdempotencyRequestHash({ conversationId: 5, content: "new" }),
        execute,
        store
      })
    ).rejects.toThrow("Idempotency key was already used for a different request payload.");

  });

  it("maps missing idempotency table/schema errors to actionable migration guidance", () => {
    const mapped = mapIdempotencyErrorToHttp({ code: "P2021" });
    expect(mapped.status).toBe(503);
    expect(mapped.message).toContain("db:migrate:deploy");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(),
}));

vi.mock("./api-client", () => ({ apiFetch }));

import { deleteChatThread, fetchChatThreads, threadsPath } from "./use-chat-threads";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Quarterly numbers",
    agentId: "a1",
    agentName: "Chat",
    createdAt: "2026-09-17T10:00:00.000Z",
    isDefaultChat: true,
    ...overrides,
  };
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("threadsPath", () => {
  it("asks for the chat scope without an agent id", () => {
    expect(threadsPath("chat")).toBe("/api/v1/threads?scope=chat");
    expect(threadsPath("chat", "a1")).toBe("/api/v1/threads?scope=chat");
  });

  it("carries the agent id on the agent scope only", () => {
    expect(threadsPath("agent", "a1")).toBe("/api/v1/threads?scope=agent&agentId=a1");
    expect(threadsPath("agent")).toBe("/api/v1/threads?scope=agent");
  });
});

describe("fetchChatThreads", () => {
  it("returns the host rows newest-first, untouched", async () => {
    const first = row({ id: "t1", createdAt: "2026-09-17T10:00:00.000Z" });
    const second = row({ id: "t2", createdAt: "2026-09-16T10:00:00.000Z" });
    apiFetch.mockResolvedValue(json({ threads: [first, second] }));
    const threads = await fetchChatThreads("chat");
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/threads?scope=chat");
    expect(threads.map((thread) => thread.id)).toEqual(["t1", "t2"]);
    expect(threads[0]?.preview).toBeNull();
  });

  it("drops malformed rows instead of rendering blanks", async () => {
    apiFetch.mockResolvedValue(json({ threads: [row(), { id: 7 }, null, { title: "no id" }] }));
    const threads = await fetchChatThreads("chat");
    expect(threads).toHaveLength(1);
  });

  it("tolerates a payload without a threads array", async () => {
    apiFetch.mockResolvedValue(json({}));
    await expect(fetchChatThreads("chat")).resolves.toEqual([]);
  });

  it("throws the host message on a failure status", async () => {
    apiFetch.mockResolvedValue(json({ error: { message: "Workspace missing" } }, 404));
    await expect(fetchChatThreads("chat")).rejects.toThrow("Workspace missing");
  });

  it("falls back to localized copy when the failure body is not json", async () => {
    apiFetch.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(fetchChatThreads("chat")).rejects.toThrow("Could not load sessions");
  });
});

describe("deleteChatThread", () => {
  it("sends DELETE for the row", async () => {
    apiFetch.mockResolvedValue(json({ ok: true }));
    await deleteChatThread("t1");
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/threads/t1", { method: "DELETE" });
  });

  it("escapes an id that would otherwise break the path", async () => {
    apiFetch.mockResolvedValue(json({ ok: true }));
    await deleteChatThread("t 1/../x");
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/threads/t%201%2F..%2Fx", { method: "DELETE" });
  });

  it("throws the host message when the row survives", async () => {
    apiFetch.mockResolvedValue(json({ error: { message: "Thread not found" } }, 404));
    await expect(deleteChatThread("t1")).rejects.toThrow("Thread not found");
  });

  it("falls back to localized copy without a host message", async () => {
    apiFetch.mockResolvedValue(json({}, 500));
    await expect(deleteChatThread("t1")).rejects.toThrow("Could not delete session");
  });
});

/**
 * The whole Phase 1 loop, through the real router, against a local stand-in for the Bot API:
 * connect a bot → add a channel → send → receive → read it back.
 *
 * Nothing here talks to Telegram. `globalThis.fetch` is replaced by the sandbox for the duration,
 * so a route that tried to reach the network would fail loudly rather than quietly succeed.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ROUTER_IMPORT_BUDGET_MS } from "../__fixtures__/test-budgets";
import type { HostRequest, HostResult } from "../types";
import { SANDBOX_TOKEN, createBotApiSandbox } from "../channels/__fixtures__/bot-api";

// Isolation: the database, settings.enc and the channel files all live under this dir.
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-channels-handlers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "c".repeat(64);
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.OPENAI_API_KEY;

const CHAT = { id: "-1001234567890", title: "Trading floor", type: "supergroup" as const, username: "trading_floor" };

type Dispatch = (request: HostRequest) => Promise<HostResult>;
type JsonResponse = { status: number; body: Record<string, unknown> };

let dispatch: Dispatch;
let sandbox: ReturnType<typeof createBotApiSandbox>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  ({ dispatch } = await import("../router"));
}, ROUTER_IMPORT_BUDGET_MS);

beforeEach(async () => {
  sandbox = createBotApiSandbox({ chats: [CHAT] });
  globalThis.fetch = sandbox.fetch;
  // One data dir for the file, so each test starts from a desk with no bot and no channels.
  await resetDesk();
  sandbox.calls.length = 0;
  sandbox.sent.length = 0;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  // The router opened the kernel SQLite inside dataDir. Windows will not delete a file something
  // still holds, so that handle is closed before the dir goes.
  const { sql } = await import("@agentforge/db");
  sql.close();
  rmSync(dataDir, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 });
});

async function json(method: string, path: string, body?: unknown): Promise<JsonResponse> {
  const result = await dispatch({ method, path, query: {}, params: {}, headers: {}, body });
  if (result.type !== "json") {
    throw new Error(`expected json, got ${result.type}`);
  }
  return { status: result.status, body: (result.body ?? {}) as Record<string, unknown> };
}

function errorCode(body: Record<string, unknown>): string {
  return (body as { error?: { code?: string } }).error?.code ?? "";
}

/**
 * A desk with no bot, no channels and no poll cursor.
 *
 * The token lives in `settings.enc`, so it goes through the route; everything else is files under
 * `channels/`, and the cursor in particular has to go — each test builds a fresh sandbox whose
 * update ids start over, and a cursor left at a higher number would silently skip them.
 */
async function resetDesk(): Promise<void> {
  await json("DELETE", "/api/v1/channels/telegram/bot");
  rmSync(join(dataDir, "channels"), { force: true, recursive: true });
}

async function connectBot(): Promise<JsonResponse> {
  return await json("POST", "/api/v1/channels/telegram/bot", { token: SANDBOX_TOKEN });
}

async function addChannel(target = "@trading_floor"): Promise<string> {
  const created = await json("POST", "/api/v1/channels", { chatTarget: target });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

describe("channels: the bot", () => {
  it("starts disconnected and reports no token", async () => {
    const before = await json("GET", "/api/v1/channels/telegram/bot");
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ connected: false, username: null, fingerprint: null });
  });

  it("connects a token only after Telegram identifies it, and never reports it back", async () => {
    const connected = await connectBot();
    expect(connected.status).toBe(200);
    expect(connected.body).toMatchObject({ connected: true, username: "dpsbuddy_sandbox_bot" });
    expect(connected.body.fingerprint).toMatch(/^sha256:/);
    expect(JSON.stringify(connected.body)).not.toContain(SANDBOX_TOKEN);
    expect(sandbox.calls).toContain("getMe");

    // The settings payload shows the same boolean, and still no token.
    const settings = await json("GET", "/api/v1/settings");
    expect(settings.body.hasTelegramBot).toBe(true);
    expect(JSON.stringify(settings.body)).not.toContain(SANDBOX_TOKEN);
  });

  it("stores the token encrypted, never in the clear on disk", async () => {
    await connectBot();
    const file = join(dataDir, "settings.enc");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).not.toContain(SANDBOX_TOKEN);
  });

  it("does not open the gateway: a bot token is not a model provider", async () => {
    await connectBot();
    const settings = await json("GET", "/api/v1/settings");
    expect(settings.body.runtime).toBe("stub");
    expect(settings.body.hasOpenai).toBe(false);
  });

  it("refuses a token that is not BotFather-shaped, without calling out", async () => {
    const result = await json("POST", "/api/v1/channels/telegram/bot", { token: "sk-not-a-bot-token" });
    expect(result.status).toBe(400);
    expect(sandbox.calls).toEqual([]);
  });

  it("forgets the token on disconnect but keeps the channels", async () => {
    await connectBot();
    const channelId = await addChannel();
    const gone = await json("DELETE", "/api/v1/channels/telegram/bot");
    expect(gone.body).toMatchObject({ connected: false, username: null });
    const list = await json("GET", "/api/v1/channels");
    expect((list.body.channels as unknown[]).map((row) => (row as { id: string }).id)).toContain(channelId);
  });
});

describe("channels: send and receive", () => {
  it("adds a channel from an @username, resolving the real chat", async () => {
    await connectBot();
    const created = await json("POST", "/api/v1/channels", { chatTarget: "@trading_floor" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      transport: "telegram",
      chatId: CHAT.id,
      title: "Trading floor",
      chatType: "supergroup",
    });
    expect(sandbox.calls).toContain("getChat");
  });

  it("refuses to add a channel before a bot is connected", async () => {
    const result = await json("POST", "/api/v1/channels", { chatTarget: "@trading_floor" });
    expect(result.status).toBe(409);
    expect(errorCode(result.body)).toBe("channel_not_connected");
  });

  it("refuses a malformed chat target before opening a socket", async () => {
    await connectBot();
    const before = sandbox.calls.length;
    const result = await json("POST", "/api/v1/channels", { chatTarget: "https://t.me/trading_floor" });
    expect(result.status).toBe(400);
    expect(sandbox.calls).toHaveLength(before);
  });

  it("sends a message to the channel and files it as outbound", async () => {
    await connectBot();
    const channelId = await addChannel();
    const sent = await json("POST", `/api/v1/channels/${channelId}/send`, { text: "IHSG opened flat" });
    expect(sent.status).toBe(201);
    expect(sandbox.sent).toEqual([expect.objectContaining({ chatId: CHAT.id, text: "IHSG opened flat" })]);

    const stored = await json("GET", `/api/v1/channels/${channelId}/messages`);
    expect(stored.body.messages).toEqual([
      expect.objectContaining({ direction: "out", text: "IHSG opened flat", author: "@dpsbuddy_sandbox_bot" }),
    ]);
  });

  it("refuses empty and over-long text", async () => {
    await connectBot();
    const channelId = await addChannel();
    expect((await json("POST", `/api/v1/channels/${channelId}/send`, { text: "  " })).status).toBe(400);
    expect((await json("POST", `/api/v1/channels/${channelId}/send`, { text: "x".repeat(4097) })).status).toBe(400);
    expect(sandbox.sent).toEqual([]);
  });

  it("receives a message posted in the channel and puts it in the conversation", async () => {
    await connectBot();
    const channelId = await addChannel();
    await json("POST", `/api/v1/channels/${channelId}/send`, { text: "morning" });
    sandbox.arrive({ chatId: CHAT.id, text: "what is BBCA doing", author: "kyo" });

    const poll = await json("POST", "/api/v1/channels/telegram/poll");
    expect(poll.body).toMatchObject({ received: 1, unmatched: 0 });

    const stored = await json("GET", `/api/v1/channels/${channelId}/messages`);
    expect((stored.body.messages as unknown[]).map((row) => (row as { direction: string; text: string }))).toEqual([
      expect.objectContaining({ direction: "out", text: "morning" }),
      expect.objectContaining({ direction: "in", text: "what is BBCA doing", author: "@kyo" }),
    ]);
  });

  it("does not file the same inbound message twice across polls", async () => {
    await connectBot();
    const channelId = await addChannel();
    sandbox.arrive({ chatId: CHAT.id, text: "once", author: "kyo" });
    expect((await json("POST", "/api/v1/channels/telegram/poll")).body).toMatchObject({ received: 1 });
    expect((await json("POST", "/api/v1/channels/telegram/poll")).body).toMatchObject({ received: 0 });
    expect(await json("GET", `/api/v1/channels/${channelId}/messages`)).toMatchObject({
      body: { messages: [expect.objectContaining({ text: "once" })] },
    });
  });

  it("counts a message from a chat this desk has not added, and still clears the cursor", async () => {
    await connectBot();
    await addChannel();
    sandbox.addChat({ id: "-100999", title: "Some other group", type: "group" });
    sandbox.arrive({ chatId: "-100999", text: "not our chat", author: "stranger" });

    const poll = await json("POST", "/api/v1/channels/telegram/poll");
    expect(poll.body).toMatchObject({ received: 0, unmatched: 1 });
    // Cleared: a second poll does not report it again, and Telegram's queue has drained.
    expect((await json("POST", "/api/v1/channels/telegram/poll")).body).toMatchObject({ unmatched: 0 });
    expect(sandbox.pending()).toBe(0);
  });

  it("refuses to poll before a bot is connected", async () => {
    const result = await json("POST", "/api/v1/channels/telegram/poll");
    expect(result.status).toBe(409);
    expect(errorCode(result.body)).toBe("channel_not_connected");
  });
});

describe("channels: by-id routes", () => {
  it("reads and deletes one channel by id, and 404s an unknown one", async () => {
    await connectBot();
    const channelId = await addChannel();
    expect((await json("GET", `/api/v1/channels/${channelId}`)).body).toMatchObject({ id: channelId });
    expect((await json("GET", "/api/v1/channels/does-not-exist")).status).toBe(404);
    expect((await json("GET", "/api/v1/channels/does-not-exist/messages")).status).toBe(404);
    expect((await json("POST", "/api/v1/channels/does-not-exist/send", { text: "hi" })).status).toBe(404);

    expect((await json("DELETE", `/api/v1/channels/${channelId}`)).status).toBe(200);
    expect((await json("GET", `/api/v1/channels/${channelId}`)).status).toBe(404);
    expect((await json("DELETE", `/api/v1/channels/${channelId}`)).status).toBe(404);
  });

  it("does not let `telegram/bot` be swallowed by the `:channelId` route", async () => {
    const result = await json("GET", "/api/v1/channels/telegram/bot");
    expect(result.status).toBe(200);
    expect(result.body).toHaveProperty("connected");
  });
});

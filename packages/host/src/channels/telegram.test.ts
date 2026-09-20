import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { PINNED_TELEGRAM_API_ORIGIN } from "@agentforge/core/channels/pinned";
import { SANDBOX_TOKEN, createBotApiSandbox } from "./__fixtures__/bot-api";
import { TelegramClient, assertBotTokenShape, redactToken } from "./telegram";

const CHAT = { id: "-1001234567890", title: "Trading floor", type: "supergroup" as const, username: "trading_floor" };

function clientOn(sandbox: ReturnType<typeof createBotApiSandbox>): TelegramClient {
  return new TelegramClient(SANDBOX_TOKEN, { fetchImpl: sandbox.fetch, origin: "https://api.telegram.org" });
}

describe("assertBotTokenShape", () => {
  it("accepts a BotFather-shaped token and trims it", () => {
    expect(assertBotTokenShape(` ${SANDBOX_TOKEN} `)).toBe(SANDBOX_TOKEN);
  });

  it("refuses anything else before it can reach a URL", () => {
    for (const bad of ["", "   ", "not-a-token", "123:short", "sk-a-gateway-key", undefined, 7]) {
      expect(() => assertBotTokenShape(bad)).toThrow(ApiError);
    }
  });
});

describe("redactToken", () => {
  it("removes the token from a URL path and from a bare paste", () => {
    const url = `https://api.telegram.org/bot${SANDBOX_TOKEN}/sendMessage`;
    expect(redactToken(`fetch failed: ${url}`)).not.toContain(SANDBOX_TOKEN);
    expect(redactToken(`token is ${SANDBOX_TOKEN}`)).not.toContain(SANDBOX_TOKEN);
    expect(redactToken(`fetch failed: ${url}`)).toContain("bot<token>");
  });
});

describe("TelegramClient", () => {
  it("identifies the bot behind a token", async () => {
    const sandbox = createBotApiSandbox();
    await expect(clientOn(sandbox).getMe()).resolves.toMatchObject({ username: "dpsbuddy_sandbox_bot" });
    expect(sandbox.calls).toEqual(["getMe"]);
  });

  it("resolves a chat by id and by @username", async () => {
    const sandbox = createBotApiSandbox({ chats: [CHAT] });
    const client = clientOn(sandbox);
    await expect(client.getChat({ kind: "id", value: CHAT.id })).resolves.toEqual({
      id: CHAT.id,
      title: "Trading floor",
      type: "supergroup",
    });
    await expect(client.getChat({ kind: "username", value: "@trading_floor" })).resolves.toMatchObject({
      id: CHAT.id,
    });
  });

  it("sends a message and returns the id Telegram assigned", async () => {
    const sandbox = createBotApiSandbox({ chats: [CHAT] });
    const sent = await clientOn(sandbox).sendMessage(CHAT.id, "IHSG opened flat");
    expect(sandbox.sent).toEqual([expect.objectContaining({ chatId: CHAT.id, text: "IHSG opened flat" })]);
    expect(sent.messageId).toBe(sandbox.sent.map((row) => row.messageId).at(0));
  });

  it("reads inbound text and moves the cursor past everything it saw", async () => {
    const sandbox = createBotApiSandbox({ chats: [CHAT] });
    sandbox.arrive({ chatId: CHAT.id, text: "what is BBCA doing", author: "kyo" });
    const photo = sandbox.arrive({ chatId: CHAT.id, text: "", kind: "photo" });
    const client = clientOn(sandbox);

    const first = await client.getUpdates(null);
    expect(first.messages.map((row) => row.text)).toEqual(["what is BBCA doing"]);
    expect(first.messages[0]).toMatchObject({ chatId: CHAT.id, author: "@kyo" });
    // The photo carried no text, but the cursor still clears it: otherwise it is re-read forever.
    expect(first.nextOffset).toBe(photo + 1);

    const second = await client.getUpdates(first.nextOffset);
    expect(second.messages).toEqual([]);
    expect(sandbox.pending()).toBe(0);
  });

  it("turns `ok: false` into an ApiError carrying Telegram's own reason", async () => {
    const sandbox = createBotApiSandbox({ failWith: "Bad Request: chat not found" });
    await expect(clientOn(sandbox).getChat({ kind: "id", value: "-1" })).rejects.toThrow(/chat not found/);
  });

  it("maps an unauthorized token to channel_forbidden", async () => {
    const sandbox = createBotApiSandbox({ token: "999999999:AnotherTokenEntirely0000000000000000" });
    await expect(clientOn(sandbox).getMe()).rejects.toMatchObject({ code: "channel_forbidden" });
  });

  it("refuses to follow a redirect", async () => {
    const client = new TelegramClient(SANDBOX_TOKEN, {
      origin: "https://api.telegram.org",
      fetchImpl: (async () => new Response(null, { status: 302, headers: { Location: "https://evil.test/" } })) as typeof fetch,
    });
    await expect(client.getMe()).rejects.toThrow(/redirect/i);
  });

  it("never lets the token escape in a transport error", async () => {
    const client = new TelegramClient(SANDBOX_TOKEN, {
      origin: "https://api.telegram.org",
      fetchImpl: (async (input: string | URL | Request) => {
        throw new Error(`connect ECONNREFUSED for ${String(input)}`);
      }) as typeof fetch,
    });
    await expect(client.getMe()).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(SANDBOX_TOKEN) }) as Error,
    );
  });

  it("times out instead of hanging, and says so without the token", async () => {
    const client = new TelegramClient(SANDBOX_TOKEN, {
      origin: "https://api.telegram.org",
      timeoutMs: 10,
      fetchImpl: ((_input: string | URL | Request, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as typeof fetch,
    });
    await expect(client.getMe()).rejects.toMatchObject({ status: 504 });
  });

  it("builds its URL on the pinned origin when nothing overrides it", async () => {
    const seen: string[] = [];
    const client = new TelegramClient(SANDBOX_TOKEN, {
      fetchImpl: (async (input: string | URL | Request) => {
        seen.push(String(input));
        return new Response(JSON.stringify({ ok: true, result: { id: 1, username: "b", first_name: "B" } }), {
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });
    await client.getMe();
    expect(seen[0]?.startsWith(`${PINNED_TELEGRAM_API_ORIGIN}/bot`)).toBe(true);
  });
});

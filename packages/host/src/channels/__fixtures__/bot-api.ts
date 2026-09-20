/**
 * A local, in-memory stand-in for the Telegram Bot API.
 *
 * It exists because the loop this feature has to prove — connect, send, receive — cannot be proven
 * against the real api.telegram.org without a BotFather token and a human in a group chat. This
 * fixture answers the same four methods with the same envelope shape (`{ ok, result }` /
 * `{ ok: false, description }`), keeps an update queue with real `update_id` semantics, and lets a
 * test (or a person, through `scripts/telegram-sandbox.ts`) drop a message into a chat as if
 * somebody had typed it.
 *
 * Used by `channels/telegram.test.ts` and `handlers/channels.test.ts` as a `fetch` implementation,
 * and by the sandbox script over real HTTP so the whole app can be driven against it.
 *
 * It is a fixture, not a mock of our own code: it models Telegram, and the product code under test
 * is the real client and the real handlers.
 */

import type { ChannelChatType } from "@agentforge/core/channels";

export const SANDBOX_TOKEN = "123456789:AAFakeSandboxTokenForLocalTesting01";

export type SandboxChat = {
  id: string;
  title: string;
  type: ChannelChatType;
  username?: string;
};

export type SandboxSent = { chatId: string; text: string; messageId: string; at: number };

export type SandboxUpdate = {
  update_id: number;
  message: {
    message_id: number;
    date: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; title: string; type: ChannelChatType; username?: string };
    text?: string;
  };
};

export type BotApiSandbox = {
  /** Drop-in for `globalThis.fetch` / `TelegramClient`'s `fetchImpl`. */
  fetch: typeof globalThis.fetch;
  /** Methods called, in order, for assertions. */
  calls: string[];
  /** Everything `sendMessage` accepted. */
  sent: SandboxSent[];
  /** Simulate somebody posting in a chat the bot can see. Returns the update id. */
  arrive(input: { chatId: string; text: string; author?: string; kind?: "text" | "photo" }): number;
  /** Add a chat the bot is a member of, after construction. */
  addChat(chat: SandboxChat): void;
  /** Updates the bot has not consumed yet, so a test can assert the cursor moved. */
  pending(): number;
};

export type BotApiSandboxOptions = {
  token?: string;
  botUsername?: string;
  botName?: string;
  chats?: readonly SandboxChat[];
  /** Fail every call with this Telegram `description`, to exercise the error path. */
  failWith?: string;
  now?: () => number;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createBotApiSandbox(options: BotApiSandboxOptions = {}): BotApiSandbox {
  const token = options.token ?? SANDBOX_TOKEN;
  const botUsername = options.botUsername ?? "dpsbuddy_sandbox_bot";
  const botName = options.botName ?? "DPSBuddy Sandbox";
  const now = options.now ?? (() => Date.now());
  const chats = new Map<string, SandboxChat>();
  for (const chat of options.chats ?? []) {
    chats.set(chat.id, chat);
  }
  const calls: string[] = [];
  const sent: SandboxSent[] = [];
  const updates: SandboxUpdate[] = [];
  let nextUpdateId = 1000;
  let nextMessageId = 500;
  /** Everything below this id has been acknowledged by a later `getUpdates`, as Telegram does it. */
  let consumedBefore = 0;

  const arrive: BotApiSandbox["arrive"] = ({ chatId, text, author = "tester", kind = "text" }) => {
    const chat = chats.get(chatId);
    if (!chat) {
      throw new Error(`sandbox: no chat ${chatId}`);
    }
    nextUpdateId += 1;
    nextMessageId += 1;
    updates.push({
      update_id: nextUpdateId,
      message: {
        message_id: nextMessageId,
        date: Math.floor(now() / 1000),
        from: { id: 42, first_name: author, username: author.replace(/^@/, "") },
        chat: { id: Number(chat.id), title: chat.title, type: chat.type, username: chat.username },
        // A photo update carries no `text`: the client must skip it without stalling the cursor.
        ...(kind === "text" ? { text } : {}),
      },
    });
    return nextUpdateId;
  };

  const respond = (method: string, body: Record<string, unknown>): Response => {
    calls.push(method);
    if (options.failWith) {
      return json({ ok: false, error_code: 400, description: options.failWith });
    }
    if (method === "getMe") {
      return json({ ok: true, result: { id: 123456789, is_bot: true, username: botUsername, first_name: botName } });
    }
    if (method === "getChat") {
      const target = String(body.chat_id ?? "");
      const chat =
        chats.get(target) ??
        [...chats.values()].find((row) => row.username && `@${row.username}` === target);
      if (!chat) {
        return json({ ok: false, error_code: 400, description: "Bad Request: chat not found" });
      }
      return json({
        ok: true,
        result: { id: Number(chat.id), title: chat.title, type: chat.type, username: chat.username },
      });
    }
    if (method === "sendMessage") {
      const chatId = String(body.chat_id ?? "");
      const text = String(body.text ?? "");
      if (!chats.has(chatId)) {
        return json({ ok: false, error_code: 403, description: "Forbidden: bot is not a member of that chat" });
      }
      nextMessageId += 1;
      const at = now();
      sent.push({ chatId, text, messageId: String(nextMessageId), at });
      return json({
        ok: true,
        result: { message_id: nextMessageId, date: Math.floor(at / 1000), chat: { id: Number(chatId) }, text },
      });
    }
    if (method === "getUpdates") {
      const offset = typeof body.offset === "number" ? body.offset : null;
      if (offset !== null) {
        consumedBefore = Math.max(consumedBefore, offset);
      }
      const limit = typeof body.limit === "number" ? body.limit : 100;
      const rows = updates.filter((row) => row.update_id >= consumedBefore).slice(0, limit);
      return json({ ok: true, result: rows });
    }
    return json({ ok: false, error_code: 404, description: `Not Found: method ${method}` }, 404);
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
    const [, calledToken, method] = match ?? [];
    if (!method) {
      return json({ ok: false, description: "Not Found" }, 404);
    }
    if (calledToken !== token) {
      return json({ ok: false, error_code: 401, description: "Unauthorized" }, 401);
    }
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    return respond(method, body);
  }) as typeof globalThis.fetch;

  return {
    fetch: fetchImpl,
    calls,
    sent,
    arrive,
    addChat(chat) {
      chats.set(chat.id, chat);
    },
    pending() {
      return updates.filter((row) => row.update_id >= consumedBefore).length;
    },
  };
}

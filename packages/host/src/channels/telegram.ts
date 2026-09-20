/**
 * Telegram Bot API client — the only place in the product that opens a socket to Telegram.
 *
 * Four methods, all the first slice needs: `getMe` (is this token a bot), `getChat` (resolve a chat
 * target to a real chat), `sendMessage` (post), `getUpdates` (pull). Design and the egress rules it
 * implements: docs/internal/telegram-channels-plan.md.
 *
 * Three properties this file exists to hold:
 *
 *  - **The origin is pinned** (`@agentforge/core/channels/pinned`). No stored base URL, no owner
 *    override; the dev hook is ignored in a packaged build and in production, exactly like the model
 *    gateway's.
 *  - **The token never leaves this file in a string anyone else sees.** The Bot API puts it in the
 *    URL path, which is the shape that ends up in error messages and logs, so every message that can
 *    escape goes through `redactToken` and `telegram.test.ts` asserts it.
 *  - **No redirects.** A 3xx is an error, never a hop: nothing re-sends a URL carrying the token to
 *    a host Telegram did not answer from.
 */

import { ApiError } from "@agentforge/core";
import {
  CHANNEL_CAPS,
  channelDisplayText,
  type ChannelChatType,
  type ChatTarget,
} from "@agentforge/core/channels";
import { resolvedTelegramApiOrigin } from "@agentforge/core/channels/pinned";
import { log } from "../log";

export const TELEGRAM_TIMEOUT_MS = 15_000;
export const TELEGRAM_MAX_RESPONSE_BYTES = 1024 * 1024;

/** A bot token is `<numeric id>:<35-char secret>`. Checked before it is put in a URL. */
const TOKEN_PATTERN = /^\d{5,20}:[A-Za-z0-9_-]{30,}$/;
const REDACTED = "bot<token>";

export type TelegramFetch = typeof globalThis.fetch;

export type TelegramBotIdentity = { id: string; username: string; name: string };

export type TelegramChat = { id: string; title: string; type: ChannelChatType };

export type TelegramSentMessage = { messageId: string; at: number };

export type TelegramInboundMessage = {
  updateId: number;
  chatId: string;
  messageId: string;
  author: string;
  text: string;
  at: number;
};

export type TelegramUpdates = { messages: TelegramInboundMessage[]; nextOffset: number | null };

/**
 * Strip anything that looks like a bot token out of text on its way to a log line or an ApiError.
 *
 * Two forms: the URL path segment (`/bot123:ABC/sendMessage`) and a bare token that a caller pasted
 * into a field. Both are replaced wholesale — a partially redacted secret is still a secret.
 */
export function redactToken(value: string): string {
  return value
    .replace(/bot\d{5,20}:[A-Za-z0-9_-]+/g, REDACTED)
    .replace(/\b\d{5,20}:[A-Za-z0-9_-]{30,}\b/g, "<token>");
}

export function assertBotTokenShape(raw: unknown): string {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) {
    throw new ApiError("invalid_request", "A bot token is required", 400);
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new ApiError(
      "invalid_request",
      "That does not look like a Telegram bot token (123456789:ABC…, from BotFather)",
      400,
    );
  }
  return token;
}

type TelegramEnvelope = { ok?: unknown; result?: unknown; description?: unknown; error_code?: unknown };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numericId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string" && /^-?\d{1,20}$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

function chatTypeOf(value: unknown): ChannelChatType {
  return value === "channel" || value === "group" || value === "supergroup" || value === "private"
    ? value
    : "group";
}

/**
 * Telegram answers `200 { ok: false, description }` for most real failures, so the status alone says
 * nothing. `description` is Telegram's own text: it is surfaced to the owner because it is the only
 * thing that explains "bot was kicked" or "chat not found", and redacted on the way out anyway.
 */
function unwrap(payload: TelegramEnvelope, status: number): unknown {
  if (payload.ok === true) {
    return payload.result;
  }
  const description = typeof payload.description === "string" ? payload.description : "";
  const code = typeof payload.error_code === "number" ? payload.error_code : status;
  const message = description ? `Telegram refused the call: ${description}` : "Telegram refused the call";
  throw new ApiError(code === 401 || code === 403 ? "channel_forbidden" : "channel_error", redactToken(message), 400);
}

async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) {
    return await response.text();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > TELEGRAM_MAX_RESPONSE_BYTES) {
          throw new ApiError("channel_error", "Telegram sent more than this client will read", 502);
        }
        chunks.push(value);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export type TelegramClientOptions = {
  fetchImpl?: TelegramFetch;
  timeoutMs?: number;
  /** Test seam only; production always resolves the pinned origin. */
  origin?: string;
};

export class TelegramClient {
  private readonly token: string;
  private readonly fetchImpl: TelegramFetch;
  private readonly timeoutMs: number;
  private readonly origin: string;

  constructor(token: string, options: TelegramClientOptions = {}) {
    this.token = assertBotTokenShape(token);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? TELEGRAM_TIMEOUT_MS;
    this.origin = options.origin ?? resolvedTelegramApiOrigin();
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.origin}/bot${this.token}/${method}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        // `manual`: a redirect would re-send the token-bearing URL to a host Telegram did not answer from.
        redirect: "manual",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError("channel_error", `Telegram did not answer within ${this.timeoutMs / 1000}s`, 504);
      }
      const detail = redactToken(error instanceof Error ? error.message : String(error));
      log.warn("telegram_call_failed", { method, detail });
      throw new ApiError("channel_error", `Could not reach Telegram: ${detail}`, 502);
    } finally {
      clearTimeout(timer);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new ApiError("channel_error", `Telegram answered with a redirect (${response.status})`, 502);
    }
    const text = await readCapped(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError("channel_error", `Telegram answered with something that is not JSON (${response.status})`, 502);
    }
    return unwrap(parsed as TelegramEnvelope, response.status);
  }

  /** Who this token belongs to. The connect route's proof that a pasted token is real. */
  async getMe(): Promise<TelegramBotIdentity> {
    const result = record(await this.call("getMe", {}));
    const id = numericId(result.id);
    const username = typeof result.username === "string" ? result.username : "";
    if (!id || !username) {
      throw new ApiError("channel_error", "Telegram did not identify that token as a bot", 502);
    }
    return { id, username, name: channelDisplayText(result.first_name, username) };
  }

  /** Resolve a chat target to the chat itself, which is also the proof the bot can see it. */
  async getChat(target: ChatTarget): Promise<TelegramChat> {
    const result = record(await this.call("getChat", { chat_id: target.value }));
    const id = numericId(result.id);
    if (!id) {
      throw new ApiError("channel_error", "Telegram did not return a chat id for that target", 502);
    }
    const type = chatTypeOf(result.type);
    const fallback = typeof result.username === "string" ? `@${result.username}` : target.value;
    return { id, title: channelDisplayText(result.title ?? result.first_name, fallback), type };
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramSentMessage> {
    const result = record(await this.call("sendMessage", { chat_id: chatId, text }));
    const messageId = numericId(result.message_id);
    const date = typeof result.date === "number" ? result.date * 1000 : Date.now();
    if (!messageId) {
      throw new ApiError("channel_error", "Telegram accepted the message but returned no id", 502);
    }
    return { messageId, at: date };
  }

  /**
   * Pull whatever has arrived since `offset`.
   *
   * `nextOffset` is the highest update id seen plus one, which is the cursor Telegram expects and
   * also its acknowledgement: an update is only dropped from its queue once the next call asks past
   * it. A poll that reads nothing leaves the cursor alone.
   */
  async getUpdates(offset: number | null): Promise<TelegramUpdates> {
    const body: Record<string, unknown> = {
      limit: CHANNEL_CAPS.maxUpdatesPerPoll,
      // Long polling would hold an HTTP request open; a press of the button is a short read.
      timeout: 0,
      allowed_updates: ["message", "channel_post"],
    };
    if (offset !== null) {
      body.offset = offset;
    }
    const result = await this.call("getUpdates", body);
    const rows = Array.isArray(result) ? result : [];
    const messages: TelegramInboundMessage[] = [];
    let highest: number | null = null;
    for (const row of rows) {
      const update = record(row);
      const updateId = typeof update.update_id === "number" ? update.update_id : null;
      if (updateId === null) {
        continue;
      }
      highest = highest === null ? updateId : Math.max(highest, updateId);
      const message = record(update.message ?? update.channel_post);
      const chat = record(message.chat);
      const chatId = numericId(chat.id);
      const messageId = numericId(message.message_id);
      const text = typeof message.text === "string" ? message.text : "";
      if (!chatId || !messageId || !text) {
        // Joins, photos, edits: counted against the cursor so they are not re-read, not stored.
        continue;
      }
      const from = record(message.from);
      const author = channelDisplayText(
        typeof from.username === "string" ? `@${from.username}` : from.first_name,
        channelDisplayText(chat.title, "Unknown"),
      );
      const date = typeof message.date === "number" ? message.date * 1000 : Date.now();
      messages.push({ updateId, chatId, messageId, author, text: text.slice(0, CHANNEL_CAPS.maxTextChars), at: date });
    }
    return { messages, nextOffset: highest === null ? null : highest + 1 };
  }
}

/**
 * Channels — a named outside conversation a desk can post into and read from.
 *
 * The kernel half: record shapes, caps, and the two validators that run before anything opens a
 * socket. Transport-specific wire work lives in the host (`packages/host/src/channels/telegram.ts`).
 *
 * Design: docs/internal/telegram-channels-plan.md. A channel is desk-scoped, like a dataset or a
 * matter — never an org-wide directory, and never a second chat surface.
 */

import { ApiError } from "../errors";

/** Transports a channel can speak. Telegram is the only one today; the field exists so a second is additive. */
export const CHANNEL_TRANSPORTS = ["telegram"] as const;
export type ChannelTransport = (typeof CHANNEL_TRANSPORTS)[number];

/** What Telegram calls the conversation on the other end. `private` is a one-to-one chat with the bot. */
export const CHANNEL_CHAT_TYPES = ["channel", "group", "supergroup", "private"] as const;
export type ChannelChatType = (typeof CHANNEL_CHAT_TYPES)[number];

export const CHANNEL_CAPS = {
  /** Channels one desk may hold. */
  maxPerWorkspace: 20,
  /** The Bot API's own `sendMessage` limit; rejected here rather than by Telegram. */
  maxTextChars: 4096,
  /** Messages kept per channel, newest last. Older ones are dropped on write. */
  maxStoredMessages: 200,
  /** Updates asked for in one poll. */
  maxUpdatesPerPoll: 100,
  /** Author / title strings are display text; anything longer is somebody testing the store. */
  maxNameChars: 120,
} as const;

export type ChannelRecord = {
  id: string;
  /** Both ids ride on the record so the Phase 3 tenancy migration has what it needs. */
  organizationId: string;
  workspaceId: string;
  transport: ChannelTransport;
  /** What the owner typed: `@name` or a numeric chat id. Kept for display and re-resolution. */
  chatTarget: string;
  /** The numeric chat id Telegram resolved, which is what every later call uses. */
  chatId: string;
  title: string;
  chatType: ChannelChatType;
  createdAt: number;
  updatedAt: number;
  lastSentAt: number | null;
  lastReceivedAt: number | null;
};

export type ChannelMessageDirection = "in" | "out";

export type ChannelMessage = {
  id: string;
  channelId: string;
  direction: ChannelMessageDirection;
  /** The transport's own message id, so a re-poll cannot file the same message twice. */
  externalId: string;
  /**
   * Display name of the sender, as the transport reported it. Untrusted text from an outside
   * network: it is stored and displayed, never interpolated into a prompt or a path.
   */
  author: string;
  text: string;
  at: number;
};

export type ChatTarget = { kind: "id"; value: string } | { kind: "username"; value: string };

/** A Telegram chat id: signed, and long for supergroups (`-100…`). */
const CHAT_ID_PATTERN = /^-?\d{1,20}$/;
/** A public @username: 5–32 chars, letters / digits / underscore, starting with a letter. */
const USERNAME_PATTERN = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;

/**
 * The owner's `chatTarget`, validated before a socket is opened.
 *
 * Both forms end up in a URL query value, so the pattern is the guard: anything that is not a plain
 * id or a plain @name is a 400 here rather than a surprise request shape at the transport.
 */
export function parseChatTarget(raw: unknown): ChatTarget {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new ApiError("invalid_request", "A channel needs a chat id or an @username", 400);
  }
  if (CHAT_ID_PATTERN.test(value)) {
    return { kind: "id", value };
  }
  const withAt = value.startsWith("@") ? value : `@${value}`;
  if (USERNAME_PATTERN.test(withAt)) {
    return { kind: "username", value: withAt };
  }
  throw new ApiError(
    "invalid_request",
    "A chat target is a numeric chat id (-1001234567890) or an @username",
    400,
  );
}

/** Outbound text, trimmed and capped. Empty after trimming is a 400: an empty post helps nobody. */
export function assertSendableText(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new ApiError("invalid_request", "A message needs some text", 400);
  }
  if (value.length > CHANNEL_CAPS.maxTextChars) {
    throw new ApiError(
      "invalid_request",
      `A message is at most ${CHANNEL_CAPS.maxTextChars} characters`,
      400,
    );
  }
  return value;
}

/** Display text from outside: collapsed to one line and capped, so a title cannot wreck the list. */
export function channelDisplayText(raw: unknown, fallback: string): string {
  const value = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return (value || fallback).slice(0, CHANNEL_CAPS.maxNameChars);
}

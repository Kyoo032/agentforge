import type { ChannelMessage, ChannelRecord } from "@agentforge/core/channels";
import { apiFetch } from "./api-client";

export type { ChannelMessage, ChannelRecord };

export type ChannelBotStatus = {
  connected: boolean;
  username: string | null;
  name: string | null;
  connectedAt: number | null;
  /** `sha256:` prefix of the saved token, or null. Never the token. */
  fingerprint: string | null;
  /** False when a developer machine is pointed at a local mock of the Bot API. */
  pinnedOrigin: boolean;
};

export type ChannelsPayload = { channels: ChannelRecord[]; bot: ChannelBotStatus };

export type PollResult = {
  received: number;
  unmatched: number;
  channels: Array<{ channelId: string; added: number }>;
};

/** The host's code for "this desk has no bot yet", which the page turns into its own prompt. */
export const NOT_CONNECTED_CODE = "channel_not_connected";

export class ChannelError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChannelError";
    this.code = code;
  }
}

function errorFrom(payload: unknown, fallback: string): ChannelError {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { code?: unknown; message?: unknown } }).error;
    if (error && typeof error === "object") {
      const message = typeof error.message === "string" && error.message.trim() ? error.message : fallback;
      const code = typeof error.code === "string" ? error.code : "channel_error";
      return new ChannelError(code, message);
    }
  }
  return new ChannelError("channel_error", fallback);
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw errorFrom(data, fallback);
  }
  return data as T;
}

export async function loadChannels(): Promise<ChannelsPayload> {
  const res = await apiFetch("/api/v1/channels");
  return readJson<ChannelsPayload>(res, "Could not load this desk's channels");
}

export async function connectTelegramBot(token: string): Promise<ChannelBotStatus> {
  const res = await apiFetch("/api/v1/channels/telegram/bot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return readJson<ChannelBotStatus>(res, "Telegram did not accept that token");
}

export async function disconnectTelegramBot(): Promise<ChannelBotStatus> {
  const res = await apiFetch("/api/v1/channels/telegram/bot", { method: "DELETE" });
  return readJson<ChannelBotStatus>(res, "Could not disconnect the bot");
}

export async function addChannel(chatTarget: string): Promise<ChannelRecord> {
  const res = await apiFetch("/api/v1/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatTarget }),
  });
  return readJson<ChannelRecord>(res, "Could not add that channel");
}

export async function removeChannel(channelId: string): Promise<void> {
  const res = await apiFetch(`/api/v1/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
  await readJson<{ ok: boolean }>(res, "Could not remove that channel");
}

export async function loadChannelMessages(channelId: string): Promise<ChannelMessage[]> {
  const res = await apiFetch(`/api/v1/channels/${encodeURIComponent(channelId)}/messages`);
  const payload = await readJson<{ messages: ChannelMessage[] }>(res, "Could not load that conversation");
  return payload.messages ?? [];
}

export async function sendToChannel(channelId: string, text: string): Promise<ChannelMessage | null> {
  const res = await apiFetch(`/api/v1/channels/${encodeURIComponent(channelId)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const payload = await readJson<{ message: ChannelMessage | null }>(res, "Telegram did not accept that message");
  return payload.message ?? null;
}

export async function pollTelegram(): Promise<PollResult> {
  const res = await apiFetch("/api/v1/channels/telegram/poll", { method: "POST" });
  return readJson<PollResult>(res, "Could not check for new messages");
}

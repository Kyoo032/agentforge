/**
 * Channels — the desk's outside conversations (docs/internal/telegram-channels-plan.md).
 *
 * Three groups of routes:
 *
 *  - `/api/v1/channels/telegram/bot` — connect, report, forget the bot token. The token goes into
 *    the desk's `settings.enc` slice like the gateway key and never comes back out.
 *  - `/api/v1/channels[/:channelId]` — the desk's channel list, and one channel by id.
 *  - `/api/v1/channels/:channelId/send` and `/api/v1/channels/telegram/poll` — out and in.
 *
 * Everything is desk-scoped through `getTenant`, and nothing here reaches the model gateway: a
 * channel is a transport, not a job.
 */

import { ApiError, keyFingerprintOrNull, type TenantContext } from "@agentforge/core";
import { assertSendableText, parseChatTarget } from "@agentforge/core/channels";
import { isPinnedTelegramOrigin, resolvedTelegramApiOrigin } from "@agentforge/core/channels/pinned";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { loadSettings, saveSettings } from "../settings-store";
import { assertBotTokenShape, TelegramClient } from "../channels/telegram";
import { channelStore, requireChannel, type AppendMessageInput } from "../channels/store";

type TenantHandler = (tenant: TenantContext, request: HostRequest) => Promise<HostResult> | HostResult;

async function withTenant(request: HostRequest, run: TenantHandler): Promise<HostResult> {
  try {
    const tenant = await getTenant(request.workspaceId);
    return await run(tenant, request);
  } catch (error) {
    return jsonError(error);
  }
}

/** Test seam: the handler tests hand in a client built on a local mock of the Bot API. */
export type ChannelDeps = { client?: (token: string) => TelegramClient };

function savedToken(tenant: TenantContext): string | undefined {
  return loadSettings(tenant).telegramBotToken;
}

/**
 * The client for this desk, or a 409 that names the missing step.
 *
 * 409 rather than 403: nothing is forbidden, the desk simply has not connected a bot yet, and the
 * page turns this code straight into "Connect a bot first".
 */
function clientFor(tenant: TenantContext, deps: ChannelDeps): TelegramClient {
  const token = savedToken(tenant);
  if (!token) {
    throw new ApiError("channel_not_connected", "Connect a Telegram bot for this desk first", 409);
  }
  return deps.client ? deps.client(token) : new TelegramClient(token);
}

function botPayload(tenant: TenantContext) {
  const token = savedToken(tenant);
  const identity = token ? channelStore().readBot(tenant) : null;
  return {
    connected: Boolean(token),
    username: identity?.username ?? null,
    name: identity?.name ?? null,
    connectedAt: identity?.connectedAt ?? null,
    // The fingerprint is the same non-secret handle Settings shows for the gateway key.
    fingerprint: keyFingerprintOrNull(token),
    /** False only on a developer machine pointed at a mock; the page says so out loud. */
    pinnedOrigin: isPinnedTelegramOrigin(resolvedTelegramApiOrigin()),
  };
}

export function handleGetTelegramBot(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => jsonOk(botPayload(tenant)));
}

/**
 * Connect a bot: shape-check the token, ask Telegram who it is, and only then write it.
 *
 * Saving first and validating later would leave a desk holding a token that cannot send, reported
 * as connected. `getMe` is one call and it is the whole proof.
 */
export function handlePostTelegramBot(request: HostRequest, deps: ChannelDeps = {}): Promise<HostResult> {
  return withTenant(request, async (tenant) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const token = assertBotTokenShape(body.token);
    const client = deps.client ? deps.client(token) : new TelegramClient(token);
    const identity = await client.getMe();
    saveSettings({ telegramBotToken: token }, tenant);
    channelStore().writeBot(tenant, { ...identity, connectedAt: Date.now() });
    return jsonOk(botPayload(tenant));
  });
}

/**
 * Forget the token for this desk. Channels and their stored messages stay: the owner disconnected a
 * bot, they did not ask to lose the conversation, and reconnecting picks up where it left off.
 */
export function handleDeleteTelegramBot(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => {
    saveSettings({ telegramBotToken: "" }, tenant);
    channelStore().clearBot(tenant);
    return jsonOk(botPayload(tenant));
  });
}

export function handleGetChannels(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) =>
    jsonOk({ channels: channelStore().list(tenant), bot: botPayload(tenant) }),
  );
}

/**
 * Add a channel: resolve the target with `getChat` before storing it.
 *
 * That call is also the permission check — Telegram only answers for a chat the bot is actually in —
 * so a desk cannot end up with a channel it could never post to.
 */
export function handlePostChannels(request: HostRequest, deps: ChannelDeps = {}): Promise<HostResult> {
  return withTenant(request, async (tenant) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const target = parseChatTarget(body.chatTarget);
    const chat = await clientFor(tenant, deps).getChat(target);
    const channel = channelStore().create(tenant, {
      transport: "telegram",
      chatTarget: target.value,
      chatId: chat.id,
      title: chat.title,
      chatType: chat.type,
    });
    return jsonOk(channel, 201);
  });
}

export function handleGetChannel(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => jsonOk(requireChannel(tenant, request.params.channelId)));
}

export function handleDeleteChannel(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => {
    if (!channelStore().remove(tenant, request.params.channelId)) {
      throw new ApiError("not_found", "Channel not found", 404);
    }
    return jsonOk({ ok: true });
  });
}

export function handleGetChannelMessages(request: HostRequest): Promise<HostResult> {
  return withTenant(request, (tenant) => {
    const channel = requireChannel(tenant, request.params.channelId);
    return jsonOk({ channelId: channel.id, messages: channelStore().messages(tenant, channel.id) });
  });
}

/** Post to the channel, then file what was sent so the page shows one conversation, not two lists. */
export function handlePostChannelSend(request: HostRequest, deps: ChannelDeps = {}): Promise<HostResult> {
  return withTenant(request, async (tenant) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const text = assertSendableText(body.text);
    const channel = requireChannel(tenant, request.params.channelId);
    const sent = await clientFor(tenant, deps).sendMessage(channel.chatId, text);
    const bot = channelStore().readBot(tenant);
    const [message] = channelStore().append(tenant, channel.id, [
      {
        direction: "out",
        externalId: sent.messageId,
        author: bot ? `@${bot.username}` : "bot",
        text,
        at: sent.at,
      },
    ]);
    return jsonOk({ channelId: channel.id, message: message ?? null }, 201);
  });
}

/**
 * Pull whatever arrived since the last poll and file it onto the desk's channels.
 *
 * The cursor moves past **every** update the call returned, including ones that matched no channel
 * and ones that carried no text — otherwise a photo posted in an unrelated group would be re-read
 * on every poll forever. `unmatched` is reported so the page can say "3 messages arrived from a chat
 * this desk has not added".
 */
export function handlePostTelegramPoll(request: HostRequest, deps: ChannelDeps = {}): Promise<HostResult> {
  return withTenant(request, async (tenant) => {
    const store = channelStore();
    const client = clientFor(tenant, deps);
    const updates = await client.getUpdates(store.readOffset(tenant));
    const byChannel = new Map<string, AppendMessageInput[]>();
    let unmatched = 0;
    for (const message of updates.messages) {
      const channel = store.findByChatId(tenant, message.chatId);
      if (!channel) {
        unmatched += 1;
        continue;
      }
      const rows = byChannel.get(channel.id) ?? [];
      rows.push({
        direction: "in",
        externalId: message.messageId,
        author: message.author,
        text: message.text,
        at: message.at,
      });
      byChannel.set(channel.id, rows);
    }
    const channels: Array<{ channelId: string; added: number }> = [];
    let received = 0;
    for (const [channelId, rows] of byChannel) {
      const added = store.append(tenant, channelId, rows);
      received += added.length;
      channels.push({ channelId, added: added.length });
    }
    if (updates.nextOffset !== null) {
      store.writeOffset(tenant, updates.nextOffset);
    }
    return jsonOk({ received, unmatched, channels });
  });
}

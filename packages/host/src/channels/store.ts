/**
 * Channels — desk store over `localDataDir()/channels/<tenant prefix><workspaceId>/`, where the
 * tenant prefix is empty for `local-tenant` and `tenants/<tenantId>/` for everyone else (Phase 3
 * lane D, `../tenant-paths.ts`; see `docs/internal/maps/tenant-storage.md`).
 *
 * ```
 * channels.json              the desk's channels
 * state.json                 { updateOffset } — the getUpdates cursor, one per desk (per bot)
 * messages/<channelId>.json  the stored conversation, oldest first
 * ```
 *
 * No table and no migration on purpose: Phase 3 tenancy owns `packages/db` right now
 * (docs/internal/web-phase3-tenancy-spec.md). Every record still carries `organizationId` and
 * `workspaceId`, so moving this into a table later is a migration and not a redesign.
 *
 * Every method filters on `tenant.workspaceId`, and a record belonging to another desk reads as
 * **missing** rather than forbidden — the same rule the Legal matter store follows.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { ApiError, type TenantContext } from "@agentforge/core";
import { tenantScopedRoot } from "../tenant-paths";
import {
  CHANNEL_CAPS,
  type ChannelChatType,
  type ChannelMessage,
  type ChannelRecord,
  type ChannelTransport,
} from "@agentforge/core/channels";
import { localDataDir } from "@agentforge/db/vault-key";
import { botIdentitySchema, channelStateSchema, channelsFileSchema, messagesFileSchema } from "./records";
import { log } from "../log";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export type CreateChannelInput = {
  transport: ChannelTransport;
  chatTarget: string;
  chatId: string;
  title: string;
  chatType: ChannelChatType;
};

/**
 * Who the saved token belongs to, cached at connect time.
 *
 * Only so the `/channels` page can name the bot without a network call on every load; the token
 * itself never lands here, and this file is dropped when the desk disconnects.
 */
export type StoredBotIdentity = {
  id: string;
  username: string;
  name: string;
  connectedAt: number;
};

export type AppendMessageInput = {
  direction: ChannelMessage["direction"];
  externalId: string;
  author: string;
  text: string;
  at: number;
};

export interface ChannelStore {
  /** Newest first. */
  list(tenant: TenantContext): ChannelRecord[];
  get(tenant: TenantContext, id: string): ChannelRecord | null;
  /** The desk's channel for a resolved chat id, which is how an inbound update finds its home. */
  findByChatId(tenant: TenantContext, chatId: string): ChannelRecord | null;
  create(tenant: TenantContext, input: CreateChannelInput): ChannelRecord;
  remove(tenant: TenantContext, id: string): boolean;
  /** Oldest first, capped at `CHANNEL_CAPS.maxStoredMessages`. */
  messages(tenant: TenantContext, channelId: string): ChannelMessage[];
  /** Files messages onto a channel, skipping ones already stored. Returns what was actually added. */
  append(tenant: TenantContext, channelId: string, rows: readonly AppendMessageInput[]): ChannelMessage[];
  /** The bot this desk connected, as `getMe` reported it. Absent until a token is saved. */
  readBot(tenant: TenantContext): StoredBotIdentity | null;
  writeBot(tenant: TenantContext, identity: StoredBotIdentity): void;
  clearBot(tenant: TenantContext): void;
  readOffset(tenant: TenantContext): number | null;
  writeOffset(tenant: TenantContext, offset: number | null): void;
  /** Everything this desk stored, dropped when the desk itself is deleted. */
  dropWorkspace(tenant: TenantContext, workspaceId: string): void;
}

function assertSafeId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new ApiError("invalid_request", `${label} is malformed`, 400);
  }
  return value;
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function readJson(file: string): unknown {
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    log.warn("channels_file_unreadable", { file: path.basename(file), detail: error instanceof Error ? error.message : error });
    return null;
  }
}

export function createChannelStore(rootDir: string): ChannelStore {
  // Phase 3 lane D: the tenant comes before the desk. Desk ids are not unique across tenants, so
  // without the prefix two tenants that happen to share one would read each other's bot identity,
  // channel list, `getUpdates` offset and stored conversations.
  const deskDir = (tenant: TenantContext): string =>
    path.join(tenantScopedRoot(rootDir, tenant.tenantId), assertSafeId(tenant.workspaceId, "Workspace id"));
  const channelsFile = (tenant: TenantContext): string => path.join(deskDir(tenant), "channels.json");
  const stateFile = (tenant: TenantContext): string => path.join(deskDir(tenant), "state.json");
  const botFile = (tenant: TenantContext): string => path.join(deskDir(tenant), "bot.json");
  const messagesFile = (tenant: TenantContext, channelId: string): string =>
    path.join(deskDir(tenant), "messages", `${assertSafeId(channelId, "Channel id")}.json`);

  /**
   * A row whose stored `workspaceId` is not this desk's is dropped here rather than filtered by the
   * caller: the file is the only thing standing between two desks, so the check lives at the read.
   */
  const loadChannels = (tenant: TenantContext): ChannelRecord[] => {
    const parsed = channelsFileSchema.safeParse(readJson(channelsFile(tenant)));
    if (!parsed.success) {
      return [];
    }
    return parsed.data.channels.filter((row) => row.workspaceId === tenant.workspaceId);
  };

  const persistChannels = (tenant: TenantContext, channels: readonly ChannelRecord[]): void => {
    writeJsonAtomic(channelsFile(tenant), { version: 1, channels });
  };

  const loadMessages = (tenant: TenantContext, channelId: string): ChannelMessage[] => {
    const parsed = messagesFileSchema.safeParse(readJson(messagesFile(tenant, channelId)));
    return parsed.success ? parsed.data.messages.filter((row) => row.channelId === channelId) : [];
  };

  const findChannel = (tenant: TenantContext, id: string): ChannelRecord | null =>
    loadChannels(tenant).find((row) => row.id === id) ?? null;

  const touch = (tenant: TenantContext, channelId: string, patch: Partial<ChannelRecord>): void => {
    const channels = loadChannels(tenant);
    const next = channels.map((row) =>
      row.id === channelId ? { ...row, ...patch, updatedAt: Date.now() } : row,
    );
    if (next.length === channels.length && !channels.some((row) => row.id === channelId)) {
      return;
    }
    persistChannels(tenant, next);
  };

  return {
    list(tenant) {
      return loadChannels(tenant).sort((a, b) => b.createdAt - a.createdAt);
    },

    get(tenant, id) {
      return findChannel(tenant, id);
    },

    findByChatId(tenant, chatId) {
      return loadChannels(tenant).find((row) => row.chatId === chatId) ?? null;
    },

    create(tenant, input) {
      const channels = loadChannels(tenant);
      const existing = channels.find((row) => row.chatId === input.chatId && row.transport === input.transport);
      if (existing) {
        throw new ApiError("invalid_request", "This desk already has that channel", 409);
      }
      if (channels.length >= CHANNEL_CAPS.maxPerWorkspace) {
        throw new ApiError(
          "invalid_request",
          `A desk can hold ${CHANNEL_CAPS.maxPerWorkspace} channels. Remove one first.`,
          400,
        );
      }
      const now = Date.now();
      const channel: ChannelRecord = {
        id: randomUUID(),
        organizationId: tenant.organizationId,
        workspaceId: tenant.workspaceId,
        transport: input.transport,
        chatTarget: input.chatTarget,
        chatId: input.chatId,
        title: input.title,
        chatType: input.chatType,
        createdAt: now,
        updatedAt: now,
        lastSentAt: null,
        lastReceivedAt: null,
      };
      persistChannels(tenant, [...channels, channel]);
      return channel;
    },

    remove(tenant, id) {
      const channels = loadChannels(tenant);
      const next = channels.filter((row) => row.id !== id);
      if (next.length === channels.length) {
        return false;
      }
      persistChannels(tenant, next);
      rmSync(messagesFile(tenant, id), { force: true });
      return true;
    },

    messages(tenant, channelId) {
      if (!findChannel(tenant, channelId)) {
        return [];
      }
      return loadMessages(tenant, channelId);
    },

    append(tenant, channelId, rows) {
      const channel = findChannel(tenant, channelId);
      if (!channel) {
        throw new ApiError("not_found", "Channel not found", 404);
      }
      const stored = loadMessages(tenant, channelId);
      const seen = new Set(stored.map((row) => `${row.direction}:${row.externalId}`));
      const added: ChannelMessage[] = [];
      for (const row of rows) {
        const key = `${row.direction}:${row.externalId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        added.push({
          id: randomUUID(),
          channelId,
          direction: row.direction,
          externalId: row.externalId,
          author: row.author,
          text: row.text,
          at: row.at,
        });
      }
      if (added.length === 0) {
        return [];
      }
      const next = [...stored, ...added]
        .sort((a, b) => a.at - b.at)
        .slice(-CHANNEL_CAPS.maxStoredMessages);
      writeJsonAtomic(messagesFile(tenant, channelId), { version: 1, messages: next });
      const inbound = added.filter((row) => row.direction === "in");
      const outbound = added.filter((row) => row.direction === "out");
      touch(tenant, channelId, {
        lastReceivedAt: inbound.length > 0 ? Math.max(...inbound.map((row) => row.at)) : channel.lastReceivedAt,
        lastSentAt: outbound.length > 0 ? Math.max(...outbound.map((row) => row.at)) : channel.lastSentAt,
      });
      return added;
    },

    readBot(tenant) {
      const parsed = botIdentitySchema.safeParse(readJson(botFile(tenant)));
      return parsed.success ? parsed.data : null;
    },

    writeBot(tenant, identity) {
      writeJsonAtomic(botFile(tenant), identity);
    },

    clearBot(tenant) {
      rmSync(botFile(tenant), { force: true });
    },

    readOffset(tenant) {
      const parsed = channelStateSchema.safeParse(readJson(stateFile(tenant)));
      return parsed.success ? parsed.data.updateOffset : null;
    },

    writeOffset(tenant, offset) {
      writeJsonAtomic(stateFile(tenant), { version: 1, updateOffset: offset });
    },

    dropWorkspace(tenant, workspaceId) {
      const id = workspaceId.trim();
      if (!id || !ID_PATTERN.test(id)) {
        return;
      }
      // Scoped by the caller's tenant, so deleting a desk never reaches into another tenant's tree
      // even when the two happen to share a desk id.
      rmSync(path.join(tenantScopedRoot(rootDir, tenant.tenantId), id), { force: true, recursive: true });
    },
  };
}

let defaultStore: ChannelStore | null = null;

export function channelsRoot(): string {
  return path.resolve(localDataDir(), "channels");
}

/** Singleton over `localDataDir()/channels`. */
export function channelStore(): ChannelStore {
  if (!defaultStore) {
    defaultStore = createChannelStore(channelsRoot());
  }
  return defaultStore;
}

export function requireChannel(tenant: TenantContext, id: string): ChannelRecord {
  const channel = channelStore().get(tenant, id);
  if (!channel) {
    throw new ApiError("not_found", "Channel not found", 404);
  }
  return channel;
}

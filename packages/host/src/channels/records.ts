/**
 * Channels — on-disk record shapes and the zod schemas that guard them when read back.
 *
 * `channels.json`, `state.json` and `messages/<id>.json` are re-read on every request, so they are
 * treated as untrusted input: nothing is returned that has not been through a schema here.
 */

import { z } from "zod";
import {
  CHANNEL_CHAT_TYPES,
  CHANNEL_TRANSPORTS,
  type ChannelMessage,
  type ChannelRecord,
} from "@agentforge/core/channels";

export const channelRecordSchema: z.ZodType<ChannelRecord> = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().min(1),
  transport: z.enum(CHANNEL_TRANSPORTS),
  chatTarget: z.string().min(1),
  chatId: z.string().min(1),
  title: z.string(),
  chatType: z.enum(CHANNEL_CHAT_TYPES),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastSentAt: z.number().nullable(),
  lastReceivedAt: z.number().nullable(),
});

export const channelMessageSchema: z.ZodType<ChannelMessage> = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  direction: z.enum(["in", "out"]),
  externalId: z.string().min(1),
  author: z.string(),
  text: z.string(),
  at: z.number(),
});

export const botIdentitySchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  name: z.string(),
  connectedAt: z.number(),
});

export const channelsFileSchema = z.object({
  version: z.literal(1),
  channels: z.array(channelRecordSchema),
});

export const messagesFileSchema = z.object({
  version: z.literal(1),
  messages: z.array(channelMessageSchema),
});

/** The Bot API `getUpdates` cursor, per desk. Absent means "never polled". */
export const channelStateSchema = z.object({
  version: z.literal(1),
  updateOffset: z.number().nullable(),
});

export type ChannelsFile = z.infer<typeof channelsFileSchema>;
export type MessagesFile = z.infer<typeof messagesFileSchema>;
export type ChannelState = z.infer<typeof channelStateSchema>;

# Channels (Telegram)

Last verified: 2026-09-20 at c204e5e

## Overview

Channels are the desk's outside conversations: a Telegram bot connected to one workspace, a list of groups or channels that bot can reach, and the last 200 messages each way. It is the transport layer Kyo's "market blast" will use — Phase 2 hangs a **Send to channel** action off the Market briefing, Phase 3 is the trading conversation ([`../telegram-channels-plan.md`](../telegram-channels-plan.md)).

It is **not** a product mode (no rail mode, no `productModes` entry, no pack seed), **not** a chat surface, and **not** a bot framework: there is no command router and no per-user state. Nothing here reaches the model gateway.

## How it works

### Connect a bot

Rail → Account → **Channels** (`apps/web/components/app-rail.tsx:394-401`) → `/channels` (`apps/web/src/App.tsx:170`) → `ChannelsPage` (`apps/web/components/channels-page.tsx:149`).

`POST /api/v1/channels/telegram/bot` (`packages/host/src/router.ts:263`) → `handlePostTelegramBot` (`packages/host/src/handlers/channels.ts:82`):

1. `assertBotTokenShape` (`packages/host/src/channels/telegram.ts:68`) rejects anything that is not `<digits>:<secret>` **before** the value can reach a URL.
2. `TelegramClient.getMe` (`telegram.ts:206`) asks Telegram who the token belongs to. A token Telegram will not identify is never written — the failure lands at the paste, not at the first send.
3. `saveSettings({ telegramBotToken })` (`handlers/channels.ts:88`) puts it in the desk's slice of `settings.enc`, through the same `KEY_FIELDS` path as the gateway key (`packages/core/src/secrets.ts:102-108`).
4. The bot's `@username` is cached in `channels/<workspaceId>/bot.json` (`packages/host/src/channels/store.ts:263-274`) so the page can name it without a network call.

The renderer only ever sees `connected`, `username`, `connectedAt`, a `sha256:` fingerprint and `pinnedOrigin` (`handlers/channels.ts:57-70`). `GET /api/v1/settings` reports the same as `hasTelegramBot` / `telegramBotFingerprint` (`packages/core/src/secrets.ts:256-261`).

**Failure modes:** bad shape → 400 with no call made; Telegram rejects → `channel_forbidden`; no `AGENTFORGE_SECRETS_KEY` → the settings store's own failure, same as the gateway key.

### Add a channel

`POST /api/v1/channels` → `handlePostChannels` (`handlers/channels.ts:118`):

`parseChatTarget` (`packages/core/src/channels/index.ts:82`) accepts `-?\d{1,20}` or `@name`, nothing else → `TelegramClient.getChat` (`telegram.ts:217`) resolves it, which is also the proof the bot is in that chat → `channelStore().create` (`store.ts:174`) writes the record with `organizationId` and `workspaceId` on it.

**Failure modes:** malformed target → 400 before a socket opens; bot not in the chat → Telegram's "chat not found", surfaced verbatim; same chat twice → 409; more than `CHANNEL_CAPS.maxPerWorkspace` (20) → 400.

### Send

`POST /api/v1/channels/:channelId/send` → `handlePostChannelSend` (`handlers/channels.ts:155`): `assertSendableText` (4096 chars, the Bot API's own limit) → `requireChannel` (desk-scoped, 404 for another desk's id) → `sendMessage` → the sent text is filed as `direction: "out"` so the page shows one conversation rather than two lists.

### Receive

`POST /api/v1/channels/telegram/poll` → `handlePostTelegramPoll` (`handlers/channels.ts:183`):

`getUpdates(offset)` (`telegram.ts:245`) → each text message is matched to a channel by resolved `chatId` (`store.findByChatId`) → `store.append` dedupes on `direction:externalId` → `store.writeOffset` moves the cursor past **every** update the call returned, including non-text ones and ones from chats the desk has not added. Those are reported as `unmatched` so the page can say so.

Pull only. There is no webhook and no inbound route: the host binds loopback behind the reverse proxy and has nowhere to receive an unauthenticated POST.

### Egress

`api.telegram.org` is pinned in `packages/core/src/channels/pinned.ts:14`, resolved through `resolvedTelegramApiOrigin()` which honours `AGENTFORGE_TELEGRAM_API_URL` only when `gatewayUrlOverrideAllowed()` — never packaged, never `NODE_ENV=production`, the same rule the model gateway's endpoint got in 0.14.26. Calls are `redirect: "manual"` (a 3xx is an error), 15 s timeout, 1 MB response cap, JSON only. The token rides in the URL path, so every message that can escape goes through `redactToken` (`telegram.ts:62`) first.

## Where things live

| File | Role |
|---|---|
| `packages/core/src/channels/index.ts` | Record shapes, `CHANNEL_CAPS`, `parseChatTarget`, `assertSendableText` |
| `packages/core/src/channels/pinned.ts` | The pinned API origin and the dev-only override rule |
| `packages/host/src/channels/telegram.ts` | The Bot API client: `getMe` / `getChat` / `sendMessage` / `getUpdates`, redaction, caps |
| `packages/host/src/channels/store.ts` | Desk store over `localDataDir()/channels/<workspaceId>/` |
| `packages/host/src/channels/records.ts` | Zod schemas every stored file is read through |
| `packages/host/src/channels/__fixtures__/bot-api.ts` | In-memory stand-in for the Bot API, shared by the tests and the sandbox script |
| `packages/host/src/handlers/channels.ts` | The ten routes |
| `packages/host/src/router.ts:281-290` | Route table entries |
| `apps/web/components/channels-page.tsx` | The page |
| `apps/web/lib/channels-client.ts` | Its fetch layer and error codes |
| `apps/web/locales/{en,id}/channels.json` | Copy, both locales |
| `scripts/telegram-sandbox.ts` | The sandbox over real HTTP, for driving the app without BotFather |

Storage layout, under `localDataDir()/channels/<workspaceId>/`: `channels.json`, `bot.json`, `state.json` (the `getUpdates` cursor), `messages/<channelId>.json`. Dropped by "Start over" (`HOST_RESET_ENTRIES`, `packages/host/src/handlers/settings.ts:287`) and when the desk itself is deleted (`packages/host/src/handlers/workspaces.ts:168`).

## Gotchas

- **No table, on purpose.** Phase 3 tenancy owns `packages/db` right now, so a channels table written in parallel would collide with migration `0015` for no gain. The records already carry `organizationId` and `workspaceId`, so the move is a migration later, not a redesign.
- **The poll cursor is per desk, and `getUpdates` is per bot.** Two desks sharing one bot token will steal each other's updates. One bot per desk.
- **Telegram privacy mode.** A bot in a group receives only messages addressed to it until privacy is turned off in @BotFather; in a channel it must be an administrator. "Send works, receive is empty" is nearly always this.
- **A bot token is not a model provider.** It is in `settings.enc` beside the gateway key but outside `hasLiveProvider`, so saving one does not flip `runtime` to `ai` and does not open the gateway gate.
- **Inbound text is untrusted.** Phase 1 stores and displays it and never hands it to a model. Anything in Phase 2 that does must run the same injection guard a knowledge source does.
- **Another desk's channel id reads as 404, not 403.** Same rule as the Legal matter store: existence is not confirmed across desks.

## Verify

[`.cursor/skills/verify-agentforge/features/channels.md`](../../../.cursor/skills/verify-agentforge/features/channels.md). Handles: `channels-link`, `channels-page`, `channels-bot-token`, `channels-bot-connect`, `channels-bot-status`, `channels-bot-fingerprint`, `channels-bot-disconnect`, `channels-sandbox-note`, `channels-add-target`, `channels-add-submit`, `channels-item`, `channels-remove`, `channels-selected`, `channels-composer-text`, `channels-send`, `channels-needs-bot`, `channels-poll`, `channels-notice`, `channels-message` (with `data-direction`), `channels-empty`, `channels-error`.

Automated: `packages/core/src/channels/index.test.ts`, `packages/host/src/channels/{telegram,store}.test.ts`, `packages/host/src/handlers/channels.test.ts` (the whole loop through the real router against the fixture), `apps/web/lib/channels-client.test.ts`, plus the `channels` namespace in `apps/web/lib/account-locales.test.ts`.

## Why

- **Claim: Channels is an account-rail surface, not a product mode.** `[Direct]` — the mode catalog is fixed and mode-first in [`../../product-modes.md`](../../product-modes.md), which already classes Knowledge Base and Usage as account-rail pages that are "not a product mode"; a channel is a connection several modes use, not a job with a prompt and an artifact.
- **Claim: the first mode to use a channel is Market.** `[Direct]` — Kyo's backlog card (2026-09-20) is titled "Telegram channel / market blast", and the Market briefing is already number- and advice-guarded, so it is the only output in the app that is safe to post to an outside audience unedited.
- **Claim: the token belongs in `settings.enc`, not a new store.** `[Direct]` — `AGENTS.md` **Secrets and prompt security** puts every per-desk secret in that envelope under `AGENTFORGE_SECRETS_KEY`; a second secret store would be a second thing to get wrong.
- **Claim: no webhook.** `[Supported]` — `AGENTS.md` **Non-negotiables** has the host binding loopback behind the reverse proxy with outbound HTTPS as the only tenant-carrying traffic; an inbound Telegram callback would need a public unauthenticated route, which nothing in the current deployment has.

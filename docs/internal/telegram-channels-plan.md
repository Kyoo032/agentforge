# Channels: Telegram integration (and the market blast after it)

**Ask (Kyo, 2026-09-20):** "Add channel integration like Telegram inside DPSBuddy; later for market trading."
Backlog card: Notion `3e10ab347e3d8124bb4cd90b5f177ea0`, Lark track-only. Status: Backlog → Phase 1 built on `feat/telegram-channel-2mivef`.

This page is the design. What actually landed in Phase 1 and where the code is: [`maps/channels.md`](maps/channels.md). Where to press: [`.cursor/skills/verify-agentforge/features/channels.md`](../../.cursor/skills/verify-agentforge/features/channels.md).

## What a channel is, in DPSBuddy terms

A **channel** is a named outside conversation that one desk can post into and read from. It is the same class of object as a Data **dataset** or a Legal **matter**: the owner names it, it belongs to one workspace, it holds a little state, and modes use it. It is not a chat thread, not a product mode, and not an agent.

Deliberately not:

- **Not a second inbox.** DPSBuddy does not try to be a Telegram client. A channel keeps the last `200` messages so the owner can see the conversation the app is part of, and nothing older.
- **Not a bot framework.** There is no command router, no conversation state machine, no per-user session. The bot posts what a mode tells it to and records what came back.
- **Not multiplayer.** A channel belongs to the desk that created it. Nothing about it is shared with another desk, and Telegram identities are never mapped onto DPSBuddy users.

`transport` is a field on the record from the first commit. Telegram is the only value today; WhatsApp Business or Discord would be a second value and a second client file, not a second subsystem.

## Which existing mode it hangs off

**None — and that is the point.** Channels are an **account-rail surface** at `/channels`, beside Knowledge Base, Workspaces and Usage. The catalog in [`../product-modes.md`](../product-modes.md) stays as it is: no new nav mode, no new pack seed, no `mode-channels` testid, no change to `resolveWorkspaceModes`.

The reasoning is the same one that keeps Knowledge Base off the rail's mode list: a channel is a **connection the desk owns**, used by several modes, not a job with a prompt and an artifact. Making it a mode would mean every desk template has to decide whether it wants it, and a desk that unchecks it would lose a connection rather than a tab.

The first mode that **uses** a channel is **Market**. Kyo's card calls it the "market blast": a Market briefing is already a guarded, code-stamped artifact, which makes it the safest thing in the app to send to an outside audience. That is Phase 2 below, not Phase 1.

## The bot token

Stored **exactly like the gateway key**, because it is the same class of secret:

- Field `telegramBotToken` on the per-workspace slice of `settings.enc` (AES-256-GCM under `AGENTFORGE_SECRETS_KEY`). It goes through `mergeSecrets` in the same `KEY_FIELDS` loop, so an empty patch value clears it and a save never half-writes it.
- The renderer never gets it back. `maskSecrets` reports `hasTelegramBot` and `telegramBotFingerprint` (`sha256:` prefix, the same helper the gateway key uses) and nothing else. `GET /api/v1/settings` and `GET /api/v1/channels/telegram/bot` both stop there.
- It never reaches a log line. The Bot API puts the token **in the URL path** (`https://api.telegram.org/bot<token>/sendMessage`), which is exactly the shape that leaks into error strings, so the client redacts the path segment before any message is thrown or logged, and a test asserts it.
- Per **workspace**, not per machine: two desks can drive two different bots, and one desk's token is not readable from the other.
- It is not a model provider. Saving one does not open the gateway gate, does not change `runtime`, and does not add a provider to `resolveProviderKeys`. The gateway stays pinned to `api.tokotokenai.com`.

Connecting is `POST /api/v1/channels/telegram/bot` with `{ token }`. The host calls `getMe` first and only writes the token if Telegram says the token is a bot, so a typo fails at the moment the owner pastes it rather than at the first send.

## Egress

One new outbound destination, pinned: **`https://api.telegram.org`**. It joins the gateway and the portal on the list of hosts the server talks to (`AGENTS.md`, Non-negotiables).

- HTTPS only, host pinned in code, path built from a fixed method name. No stored base URL, no env override, nothing the owner can re-point — the same rule the gateway endpoint got in 0.14.26.
- `redirect: "manual"`: a 3xx from the API is an error, never a hop. Nothing follows a redirect with the token in the URL.
- 15 s timeout, 1 MB response cap, JSON only.
- **Pull, never push.** Inbound messages arrive because the host asks for them (`getUpdates`), not because Telegram calls us. No webhook, no new listening port, no public callback URL — which matters because the host binds loopback behind the reverse proxy and has no route for an unauthenticated inbound POST.

What crosses that boundary is what the owner typed (or, from Phase 2, a briefing they chose to send) and what the channel replied. Telegram sees it in plaintext; that is the nature of the product, and the `/channels` page says so in both locales.

## Storage

No new table and no migration. Phase 3 tenancy owns `packages/db` right now (tenants table, `tenant_id`, migration `0015`), and a channels table written in parallel would collide with it for no gain.

So the store is a file store, the shape Legal and Data already use:

```
<localDataDir()>/channels/<workspaceId>/
  channels.json              ChannelRecord[]  (cap 20 per desk)
  state.json                 { updateOffset }  — the Bot API getUpdates cursor, per desk
  messages/<channelId>.json  ChannelMessage[] (cap 200, newest last)
```

Every record carries `organizationId` and `workspaceId`, every read filters on `tenant.workspaceId`, and a record whose stored `workspaceId` does not match reads as **missing** (404), not as forbidden. Reads go through zod schemas, because the file is re-read on every request and is therefore untrusted input. `channels` is added to `HOST_RESET_ENTRIES` so "Start over" takes it with everything else the host wrote.

**When there is a tenants table** (Phase 3 lane B / D), this moves to `tenants/<id>/channels/…` with the rest of the per-tenant state, or becomes a table — either way the record already carries the two ids that migration needs, and the store is the only thing that has to change.

## Phase 1 — what shipped

Connect a bot, name a channel, send to it, read from it.

| Route | What it does |
|---|---|
| `GET /api/v1/channels/telegram/bot` | Is a bot connected on this desk: `{ connected, username, fingerprint }`. Never the token |
| `POST /api/v1/channels/telegram/bot` | `{ token }` → `getMe` → save to `settings.enc`. 400 on a token Telegram rejects |
| `DELETE /api/v1/channels/telegram/bot` | Forget the token on this desk. Channels and history stay |
| `POST /api/v1/channels/telegram/poll` | `getUpdates` from the stored offset → file each message onto its channel → `{ received, unmatched, channels }` |
| `GET /api/v1/channels` | The desk's channels, newest first |
| `POST /api/v1/channels` | `{ chatTarget }` (`@name` or a numeric chat id) → `getChat` → record with the real title and type |
| `GET /api/v1/channels/:channelId` | One channel |
| `DELETE /api/v1/channels/:channelId` | Forget the channel and its stored messages |
| `POST /api/v1/channels/:channelId/send` | `{ text }` → `sendMessage` → the sent message is filed as `direction: "out"` |
| `GET /api/v1/channels/:channelId/messages` | The stored conversation, oldest first |

UI is one page, `/channels`, in the account rail: the bot card (connect / fingerprint / disconnect), the channel list, a composer per channel, and the message list with a **Check for new messages** button. Copy is in `apps/web/locales/{en,id}/channels.json` with the usual parity test.

Caps and guards: 20 channels a desk, 4096 characters an outbound message (the Bot API's own limit), 200 stored messages a channel, 100 updates a poll. A `chatTarget` is either `-?\d{1,20}` or `@name`; anything else is a 400 before a socket is opened.

## Phase 2 — the market blast (next)

A guarded artifact goes out to a channel on the owner's press:

- A **Send to channel** action on the Market briefing (and, once it reads well, Research and Finance), rendering the artifact to plain text with the disclaimer the market pipeline already stamps.
- The number guard and the advice guard run **before** the send, not just before the download: `advice_leak` refuses a post the same way it refuses a DOCX.
- A per-channel send log, so a briefing that went out twice is visible.
- Inbound stays read-only. If Phase 2 ever feeds an inbound message to a model, it goes through the same injection guard as a knowledge source first — a Telegram group is an untrusted text source by definition.

## Phase 3 — market trading (later, and not a broker)

Kyo's card says "later for market trading". Written down now so Phase 1 does not accidentally block it:

- **Commands in, briefings out.** `/watch BBCA`, `/brief` in a channel run the existing Market pipeline for that desk and post the result back. That needs a command parser and a rate limit, not a new pipeline.
- **A trade is never placed by DPSBuddy.** The Market mode's advice guard exists precisely because the product does not give directives; a broker integration would contradict it. Any real order flow is a separate product decision by Kyo, with a separate spec, and at minimum a broker API, an audit log, and a confirmation step that is not a chat message.
- The open question to settle first: who is allowed to command the bot. A Telegram group is not an account, so mapping a Telegram user onto a desk needs the portal identity that Phase 1 of the web migration is building. Until then, commands would be desk-wide and anyone in the group could run them — which is fine for a briefing and not fine for anything else.

## Open questions for Kyo

1. **One bot per desk, or one bot for the install?** Phase 1 is per desk, which is the safer default and matches the gateway key. An install-wide bot would be less setup for a single-tenant deploy.
2. **Polling cadence.** Phase 1 polls when the owner presses the button. A background poller is a timer in the host process, and on the hosted server it runs per desk — cheap, but it is the first always-on outbound loop in the product.
3. **Does the blast belong to Market only**, or to every artifact with a guard (Research, Finance, Legal)? Legal output is draft work product and probably never wants a channel.

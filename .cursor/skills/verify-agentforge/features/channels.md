# Channels (Telegram)

Account-rail page at `/channels`: connect a Telegram bot to the desk, add a group or channel the bot is in, post to it, and read what comes back. Not a product mode and not on the mode catalog — `mode-channels` must have count 0. How it works: [`maps/channels.md`](../../../docs/internal/maps/channels.md). Design and the phases after this one: [`telegram-channels-plan.md`](../../../docs/internal/telegram-channels-plan.md).

## Sub-features

- **channels-bot** — paste a BotFather token, see the bot's `@username` and a `sha256:` fingerprint, disconnect. The token is never shown again and never appears in any payload.
- **channels-add** — add a chat by `@username` or by numeric chat id; the host resolves it with `getChat`, which is also the proof the bot can see it.
- **channels-send** — post a message; it appears in the conversation as `direction="out"`.
- **channels-receive** — **Check for new messages** pulls `getUpdates` and files inbound text onto the matching channel; messages from a chat the desk has not added are counted as `unmatched`, not stored.
- **channels-scope** — a second desk sees none of it: its own bot, its own channels, its own conversation.

## How to get to it (user POV)

Rail → Account group → **Channels** (`channels-link`), or `http://127.0.0.1:3000/channels` directly. Visible on every desk, like Knowledge Base and Usage; it does not depend on `productModes`.

With no bot connected the page shows the connect form and the composer's Send is disabled with `channels-needs-bot` beside it.

## Driving it with the DPSBuddy harness

**Without a real bot (the normal case).** Start the local Bot API sandbox, point the host at it, and drive the page:

```bash
npx tsx scripts/telegram-sandbox.ts            # prints a token and two chat ids
AGENTFORGE_TELEGRAM_API_URL=http://127.0.0.1:3399 pnpm dev
node .cursor/skills/verify-agentforge/scripts/doctor.mjs
```

The page shows `channels-sandbox-note` whenever the host is pointed at anything but `api.telegram.org`. If that note is **absent** during a sandbox drive, the env var did not reach the host — restart `:3000`, it has no watcher.

1. `goto /channels`, settle, assert `channels-page` and `channels-link` (count 1).
2. Fill `channels-bot-token` with the token the sandbox printed, click `channels-bot-connect`. Wait for `channels-bot-disconnect`; `channels-bot-status` reads "Connected as @…" and `channels-bot-fingerprint` starts `sha256:`.
3. Fill `channels-add-target` with `@trading_floor`, click `channels-add-submit`. Wait for `channels-item`; `channels-selected` reads "Trading floor".
4. Fill `channels-composer-text`, click `channels-send`. Wait for `[data-testid="channels-message"][data-direction="out"]`. Cross-check `GET http://127.0.0.1:3399/_sandbox/state` — the text is in `sent`.
5. Make a message arrive: `POST http://127.0.0.1:3399/_sandbox/arrive` with `{"chatId":"-1001234567890","author":"kyo","text":"…"}`.
6. Click `channels-poll`. Wait for `[data-direction="in"]`; `channels-notice` reads "1 new messages."
7. Click `channels-poll` again and assert the message count did **not** change. A duplicate here means the cursor is not being written.

**With a real bot.** Same walk with no `AGENTFORGE_TELEGRAM_API_URL` — create a bot with @BotFather, add it to a test group, and use that group's id. `channels-sandbox-note` must be absent. Do not use the owner's production bot, and do not paste a real token on a shared desk.

Proof to keep under `evidence/channels/<run-id>/`: the drive log, the four screenshots (empty, connected, sent, received), and the doctor JSON.

## Gotchas

- **The bot token is per desk, not per machine.** Switching desks shows a disconnected bot even though `settings.enc` still holds the other desk's token. That is the design, not a lost token.
- **Two desks sharing one bot token fight over the cursor.** `getUpdates` is per bot: whichever desk polls first consumes the update and the other never sees it. Use a different bot per desk when driving desk isolation.
- **A group bot sees nothing by default.** Telegram's privacy mode means a bot in a group only receives messages addressed to it (or commands) until privacy is turned off in @BotFather. In a *channel* the bot must be an administrator. "Send worked, receive is empty" is almost always this, not our code.
- **`getChat` is the permission check.** Adding a chat the bot is not in fails with Telegram's own "chat not found" — that is the expected 400, not a harness fault.
- **Non-text updates are skipped but still clear the cursor.** A photo posted in the group raises no message in the app and no `unmatched` count; that is deliberate.
- G1 applies: the connect, add and send buttons are real `<form>` submits. Settle after `goto` before pressing, or the browser does a native submit and the page reloads with nothing sent.

# PII

Chat (and other model runs) keep the prompt the owner typed. Before that text becomes the model/tool prompt, the host replaces local PII matches with `[email]`, `[phone]`, `[id]`, or `[card]`. There is no warn banner and no Send anyway — the system handles it.

## Sub-features

- `pii-keep-original` the composer and `message-list` show the exact text the owner sent.
- `pii-mask-outbound` `createRuntime()` masks `systemPrompt` and history text parts before stub or live execute. Image/video studio tools and research search queries use the same `maskPii`.
- `pii-local-scan` is regex only (`scanPii` / `maskPii` in `@agentforge/core/pii`). No remote classifier.
- `pii-no-banner` `pii-warning` and `pii-send-anyway` are gone. A lone `@` is not PII.

## How to get to it (user POV)

- Open Chat (`/chat` or `mode-chat`).
- Type a prompt that includes an email (or phone). Send as usual.
- Your bubble still has the email. The model only sees `[email]` (stub reply includes that token).

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `runtime: "stub"` for a stub-proof send.

- **Open Chat.** Go to `/chat`. `composer-text` and `composer-send` are visible. `pii-warning` count is 0.
- **Send original.** Fill `composer-text` with `VERIFY pii <run-id> contact me at verify@example.com`. Click `composer-send`. `message-list` contains that exact email (20s). `composer-send` returns to `Send`.
- **Outbound mask.** The stub assistant line contains `[email]` and does not repeat `verify@example.com`.
- **Non-trigger.** `hello @ world` sends with no mask token and no banner.
- **IDE proof.** Screenshot under `evidence/pii/<run-id>/` with the original email in the user bubble and `[email]` in the stub reply.
- **Cloud.** Foundation sends have no email — they must still pass. Do not add a banner assert.

## Gotchas

- Masking is host-side, on the way into the model. Do not look for a Chat banner.
- Long digit runs in a verify id can also become `[id]` / `[phone]` in the stub reply. The user bubble still has the original id.
- Do not paste real personal data into Cloud evidence. Use `example.com` addresses.
- `scanPii("hello @ world")` is empty — no mask.

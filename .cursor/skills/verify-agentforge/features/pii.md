# PII

Chat composer warns on send when the prompt looks like it contains personal data (email, phone, ID, card). Scanning is local regex (`@agentforge/core/pii`), warn-only — never a hard block.

## Sub-features

- `pii-warning` shows the warn-on-send banner when the composer text matches local PII patterns. Banner copy is `piiWarning(findings)`.
- `pii-send-anyway` is the control that confirms this exact text and actually sends.
- `pii-local-scan` runs in the client with regex only — no remote classifier. Import `@agentforge/core/pii`, not the core barrel.
- `pii-warn-only` never hard-blocks send; the user can always proceed via send-anyway.

## How to get to it (user POV)

- Open Chat (`/chat` or `mode-chat`).
- Type an email or phone number into the composer (`composer-text`).
- Attempt send; read the warning and choose Send anyway if you mean it.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- `runtime: "stub"` for a stub-proof send (or record live if doctor says `ai`).
- `pii-warning` and `pii-send-anyway` are landed on the composer.

Contract:

- **Open Chat.** Go to `/chat`. `composer-text` and `composer-send` are visible.
- **Trigger warn.** Fill `composer-text` with a unique prompt that includes a clear email (e.g. `VERIFY pii <run-id> contact me at verify@example.com`). Click `composer-send`. `pii-warning` is visible (10s). The message is not yet in `message-list` as a committed send until send-anyway.
- **Send anyway.** Click `pii-send-anyway`. `message-list` contains the prompt (20s). `composer-send` returns to `Send`.
- **Re-warn.** After a successful send, or when the composer text changes, the next PII-shaped prompt warns again. Confirm is per exact text, not a session-wide dismiss.
- **Non-trigger.** A prompt with a lone `@` that is not an email (`hello @ world`) must not show `pii-warning` on send.
- **Routes.** The same warn applies to every composer send that posts user text (text / image / video), not only the text branch.
- **IDE proof.** Screenshot under `evidence/pii/<run-id>/` with the banner visible, then after send-anyway with the prompt in the transcript.
- **Cloud.** Same steps in the stub suite; existing foundation sends have no email/phone and must keep working without the banner.

## Gotchas

- Warn-on-send must not fire on every `@`. Bare mentions without an email/phone shape are not PII hits. `scanPii("hello @ world")` is empty.
- `pii-send-anyway` must actually send. A banner that traps the user is a product bug.
- This is warn-only — never treat a missing hard-block as a fail.
- Do not paste real personal data into Cloud evidence. Use synthetic `example.com` addresses and fake numbers.

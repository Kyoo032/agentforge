# PII

Chat (and other model runs) keep the prompt the owner typed. Before that text becomes the model/tool prompt, the host replaces local PII matches with `[email]`, `[phone]`, `[id]`, `[card]` and — since 2026-09-17 — `[nik]`, `[npwp]`, `[account]`. There is no warn banner and no Send anyway — the system handles it. Finance has a **second, earlier** guard with its own two notices; it is the only mode that shows the owner a count of what was hidden. The map is [`docs/internal/maps/pii-and-key-security.md`](../../../../docs/internal/maps/pii-and-key-security.md).

## Sub-features

- `pii-keep-original` the composer and `message-list` show the exact text the owner sent.
- `pii-mask-outbound` `createRuntime()` masks `systemPrompt` and history text parts before stub or live execute. Image/video studio tools and research search queries use the same `maskPii`.
- `pii-local-scan` is regex only (`scanPii` / `maskPii` in `@agentforge/core/pii`). No remote classifier.
- `pii-id-indonesia` the same `scanPii` also masks a NIK (`[nik]`), a dotted NPWP (`[npwp]`), a labelled bank account — `No. Rekening 1234567890` → `[account]` — and an `08xx` local phone (`[phone]`). Not Finance-only: this fires in Chat too. An account number with a word between the cue and the digits ("Rekening Bank: 1250000000") is **not** masked, by design.
- `pii-finance-notice` Finance redacts before the prompt is built and reports a count. Two testids, both read-only: `finance-upload-pii` on the upload step and `finance-result-pii` on the result. There is no confirm, dismiss or send-anyway control on either — a notice is all there is.
- `pii-no-banner` `pii-warning` and `pii-send-anyway` are gone. A lone `@` is not PII.

## How to get to it (user POV)

- Open Chat (`/chat` or `mode-chat`).
- Type a prompt that includes an email (or phone). Send as usual.
- Your bubble still has the email. The model only sees `[email]`. The stub assistant line does not show that token: with no calculator or clock in the prompt it is the need-key sentence ("I need a Toko Token gateway key in Settings to answer that."), which never quotes the prompt.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- `runtime: "stub"` for a stub-proof send.

- **Open Chat.** Go to `/chat`. `composer-text` and `composer-send` are visible. `pii-warning` count is 0.
- **Send original.** Fill `composer-text` with `VERIFY pii <run-id> contact me at verify@example.com`. Click `composer-send`. `message-list` contains that exact email (20s). `composer-send` returns to `Send`.
- **Outbound mask.** The user bubble in `message-list` still contains `verify@example.com`. The newest `message-output` is the stub need-key sentence and contains neither `[email]` nor `verify@example.com`. Do not treat a missing `[email]` in that line as a failed mask — `createRuntime()` runs `maskOutboundRunInput` before execute (`packages/core/src/runtime/create-runtime.ts`), and `StubRuntime` answers with `stubChatCopy().needKey` instead of echoing history (`packages/core/src/runtime/stub-runtime.ts`). The mask itself is the unit proof in `packages/core/src/security/pii.test.ts`.
- **Non-trigger.** `hello @ world` sends with no mask token and no banner.
- **IDE proof.** Screenshot under `evidence/pii/<run-id>/` with the original email in the user bubble and the need-key sentence in the stub reply.
- **Cloud.** Foundation sends have no email — they must still pass. Do not add a banner assert.

## Gotchas

- Masking is host-side, on the way into the model. Do not look for a Chat banner.
- Bare digit runs (market cap, volume) are not phones or IDs. Formatted phones (`+1 (415) 555-2671`) and SSN-style IDs still mask. The user bubble still has the original text.
- **Money is never masked, and that is the assertion that matters on a Finance desk.** A rupiah total written the Indonesian way (`1.250.000.000.000`) and a bare total that happens to pass Luhn both used to come back as `[phone]` / `[card]`; three guards now stop that, and the host re-checks afterwards and puts a figure back if redaction ate one. A number that changed between the typed text and the model's copy is a fail, not a mask working.
- **A Finance PII count is not proof a mask fired.** A figure that was hidden and then restored is filtered out of the count, so the number the notice shows is identifiers only.
- `[name]` is a token that exists and is essentially never seen. A name column in a Finance sheet becomes a stable pseudonym — `Karyawan 1`, `Karyawan 2` — so the rows stay distinguishable and the totals still add up. Do not assert `[name]`; assert `Karyawan 1`.
- A name in free text with no column header above it is **not** detected, deliberately. Do not file it.
- Do not paste real personal data into Cloud evidence. Use `example.com` addresses.
- `scanPii("hello @ world")` is empty — no mask.

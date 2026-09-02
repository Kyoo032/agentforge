# Security

Settings can confirm which gateway key is saved without ever showing the raw secret. The host hashes the trimmed key (SHA-256) and returns a short `sha256:` prefix. TLS and at-rest seal are already in product; this file maps those surfaces, it does not claim a new envelope.

## Sub-features

- `key-fingerprint` shows `Saved key fingerprint sha256:…` on Simple Settings (`data-testid="key-fingerprint"`) when `hasOpenai` and `openaiKeyFingerprint` are present. Hidden when no gateway key. Never put the prefix in the password input.
- `privacy-note` already states HTTPS-only remote endpoints and that Agentforge does not log prompts. That is the TLS / retention note — do not add a second TLS banner.
- At-rest seal is the existing AES-256-GCM envelope on `settings.enc` (`sealPayload` / `openPayload`). Do not claim new seal work from a fingerprint change.
- Doctor prints `keyFingerprint: true` only when `hasOpenai` and `openaiKeyFingerprint` is a non-empty `sha256:` string; otherwise `false`. Missing key is not a doctor fail.

## How to get to it (user POV)

- Open Settings (`settings-link` or `/settings`).
- After a gateway key is saved, the line under the key field names the fingerprint. The password field stays empty / replace-placeholder.
- With no key (Cloud, GHA, fresh desk), that line is absent. The privacy note is still on Simple.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Do **not** paste or save a gateway key unless the operator asked.
- Cloud / GHA force stub and have no key.

- **Open Settings.** Click `settings-link` or go to `/settings`. `settings-form` is visible. Stay on this page.
- **With a saved key** (`doctor.hasOpenai === true`). `key-fingerprint` is visible (10s). Its text starts with `Saved key fingerprint sha256:` (12 hex chars after the prefix). `openai-key` does not contain the fingerprint or the raw secret.
- **With no key** (`doctor.hasOpenai === false`). `key-fingerprint` count is 0. `privacy-note` is still visible. Doctor `keyFingerprint` is `false`.
- **API.** `GET /api/v1/settings` may include `openaiKeyFingerprint` (and optional extra-provider fingerprints). The JSON must not contain the raw key. When no key, the fingerprint field is null / absent from the UI — not a leaked secret.
- **IDE proof.** Screenshot under `evidence/security/<run-id>/` with Simple visible. If a key is saved, capture `key-fingerprint`. If not, capture the missing line plus `privacy-note`.
- **Cloud.** Skip fingerprint visibility. Assert `key-fingerprint` count 0 and that doctor reports `keyFingerprint: false`. Do not paste a key to force the line.

## Gotchas

- Cloud and GHA have no gateway key. Treat missing `key-fingerprint` as the empty-state pass, not a product fail. Still assert the field is absent (count 0), not leaked into `openai-key` or the settings JSON body as a raw secret.
- The fingerprint is a 12-hex prefix (`sha256:` + 12 chars), not the full digest and not the key. Do not ask the owner to paste the secret to “verify” the prefix.
- Hashing is server-side (`maskSecrets` → `openaiKeyFingerprint`). The Settings client must not import `keyFingerprint` or hash in the browser.
- `privacy-note` already covers TLS. A fingerprint change does not add or rewrite the at-rest envelope.
- Doctor must not exit 1 when `keyFingerprint` is `false`. That is the Cloud stub default.
- At-rest inventory (existing AES-256-GCM envelope: `v` / `alg` / `n` / `ct` / `tag` via `sealPayload` / `openPayload` + vault key). **Sealed:** `settings.enc` (gateway, extras, tool keys); `agent_versions.system_prompt`; `messages.content`; `tool_invocations.input` / `output`. Legacy plaintext still opens (`openPayload` returns the value when it is not an envelope).
- **Stays plaintext on purpose:** thread `title` (short UX label); agent name / slug / description; model ids (`agent_versions.model`, version `config` generate pins, Settings model picks); binding `config` (empty or copied flags — product does not store keys there); `runs.usage` / `runs.error`; tool key names and status; key fingerprints (`sha256:` + 12 hex — hashes, not secrets).
- This is the product envelope, not a new crypto stack and not an ISO 27001 claim.

# Settings

Settings is where the owner pastes a Toko Token gateway URL and key. There is no login. The form, privacy note, runtime line, and Usage panel (this key vs this desk estimate, in USD) are visible without saving. Extras (Anthropic, Volcengine, FAL, generate backends) stay collapsed until opened.

## Sub-features

- `settings-open` shows the gateway form and Build / Agents links.
- `settings-privacy` shows the retention / no-log note.
- `settings-runtime` reports `stub` or live status on `runtime-status`.
- `settings-placeholder` keeps the gateway URL placeholder `https://api.tokotokenai.com/v1`.
- `settings-extras` reveals optional keys only after the Extras disclosure is opened.
- `settings-usage-empty` shows `usage-panel` with `usage-this-key` asking to paste a gateway key when none is saved. `usage-by-model` is visible (empty copy until this desk has priced runs).
- `settings-usage-this-key` shows billed spend/remaining in USD on `usage-this-key` when a key is saved (host reads Toko `/api/usage/token` with the saved `sk-`; never an Access Token). `usage-key-meter` is the used vs remaining bar.
- `settings-usage-desk-estimate` shows `usage-desk-estimate` in USD from recorded input/output tokens × public `/api/pricing`. Old threads stay `$0.00` until new runs land.
- `settings-usage-by-model` charts spend per model on `usage-by-model` / `usage-model-chart` from the same desk tokens × catalog prices. Bars are USD; each row also shows run count and input/output tokens. Gateway this-key totals stay one number — Toko `/api/usage/token` has no per-model split.

## How to get to it (user POV)

- Choose Settings on the left rail (`settings-link`).
- Webdev: open `http://127.0.0.1:3000/settings`. Packaged: Settings in the Electron window (not :3000).
- From Chat empty-state copy, follow the Settings link.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Do **not** click `save-settings` or paste a key unless the operator asked.
- Do **not** type into `openai-key` on the operator's desk.

- **Open Settings.** Click `settings-link` or go to `/settings`. URL matches `/settings`. `settings-form` is visible (15s).
- **Identity.** `privacy-note` is visible. `openai-base-url` is visible and its `placeholder` is `https://api.tokotokenai.com/v1`. `settings-build-link` and `settings-agents-link` are visible.
- **Runtime.** With no provider key, `runtime-status` contains `stub` and `no keys yet` (15s). If a key is already saved, the line contains `Runtime: ai` and `Gateway key saved` — record that; it is not a stub fail.
- **Usage empty (Cloud / no key).** `usage-panel` is visible. `usage-this-key` contains `Paste a gateway key`. `usage-desk-estimate` is visible (usually `$0.00`). `usage-by-model` is visible. `usage-key-meter` and `usage-model-chart` are absent until a key / priced desk runs exist.
- **Usage live (Windows, key already saved, read-only).** Do not paste a key. `usage-this-key` contains `$` used (or Unlimited, or a visible fail pointing at the dashboard). `usage-key-meter` is visible when this-key status is ok. `usage-desk-estimate` contains `$`. If this desk has priced runs, `usage-model-chart` shows one bar per model and `usage-model-row-<model-id>` lists USD. This key ≠ this desk.
- **Extras (read-only).** Click the text `Extras` (exact). `anthropic-key`, `volcengine-key`, `fal-key`, `image_gen-backend`, and `video_gen-backend` become visible. Do not fill them.
- **IDE proof.** Screenshot + snapshot under `evidence/settings/<run-id>/` with the form, privacy note, runtime line, and usage panel visible.
- **Cloud.** Same empty-state assertions in `foundation.spec.ts`. Do not paste a gateway key.

## Gotchas

- Saving probes `GET /v1/models` against the pasted URL. A typo or `http://` non-loopback URL is a product 400, not a harness bug.
- The raw key never comes back after save. A filled `openai-key` on reload means you are looking at the empty replace-placeholder, not the secret.
- `runtime-status` is the user-visible doctor. Trust that text over env `AGENTFORGE_RUNTIME` once a key exists — `resolveRuntimeMode` prefers a saved key.
- Mutating `/api` from a non-localhost Origin is rejected. Webdev: drive `127.0.0.1:3000`. Packaged: any loopback Origin on the ephemeral port is allowed; do not doctor :3000 as the app.
- Settings is not a product mode. The rail control is `settings-link`, not `mode-settings`.
- This key is gateway-billed spend for that `sk-` (all clients). This desk is an Agentforge estimate from local tokens × catalog prices. They will not match. The by-model chart is this desk only.
- Seedance / tiered jobs are omitted from the desk dollar amount (“billed after they finish”). Do not treat that as a harness fail.
- There is no Access Token field and no key create/revoke UI. Do not hunt for one.

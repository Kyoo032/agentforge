# Settings

Settings is where the owner pastes a Toko Token gateway key from api.tokotokenai.com. There is no login. The page shows the key field, Save, Usage panel, privacy note, and runtime status. There is no Advanced tab, no Extras, no Build/Agents links, and no injection-guard bypass in the UI.

## Sub-features

- `settings-open` shows the gateway form (`settings-form`, `openai-key`, `save-settings`).
- `settings-privacy` shows the retention / no-log note (`privacy-note`).
- `settings-runtime` reports offline demo or live status on `runtime-status`.
- `settings-usage-empty` shows `usage-panel` with `usage-this-key` asking to paste a gateway key when none is saved. `usage-by-model` is visible (empty copy until this desk has priced runs).
- `settings-usage-this-key` shows billed spend/remaining in USD on `usage-this-key` when a key is saved (host reads Toko `/api/usage/token` with the saved `sk-`; never an Access Token). `usage-key-meter` is the used vs remaining bar.
- `settings-usage-desk-estimate` shows `usage-desk-estimate` in USD from recorded input/output tokens × public `/api/pricing`. Old threads stay `$0.00` until new runs land.
- `settings-usage-by-model` charts spend per model on `usage-by-model` / `usage-model-chart` from the same desk tokens × catalog prices.

## How to get to it (user POV)

- Choose Settings on the left rail (`settings-link`).
- Webdev: open `http://127.0.0.1:3000/settings`. Packaged: Settings in the Electron window (not :3000).
- From Chat empty-state copy, follow the Settings link.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Do **not** click `save-settings` or paste a key unless the operator asked.
- Do **not** type into `openai-key` on the operator's desk.

- **Open Settings.** Click `settings-link` or go to `/settings`. URL matches `/settings`. `settings-form` is visible (15s). `settings-tab-simple`, `settings-tab-advanced`, `settings-build-link`, `openai-base-url`, and `injection-guard-bypass` have count 0.
- **Identity.** `openai-key`, `save-settings`, and `privacy-note` are visible.
- **Runtime.** With no provider key, `runtime-status` contains `Offline demo` and `no keys yet` (15s). If a key is already saved, the line contains `Status: Live` and `Gateway key saved` — record that; it is not an offline fail.
- **Usage empty (Cloud / no key).** `usage-panel` is visible. `usage-this-key` contains `Paste a gateway key`. `usage-desk-estimate` is visible (usually `$0.00`). `usage-by-model` is visible. `usage-key-meter` and `usage-model-chart` are absent until a key / priced desk runs exist.
- **Usage live (Windows, key already saved, read-only).** Do not paste a key. `usage-this-key` contains `$` used (or Unlimited, or a visible fail pointing at the dashboard). `usage-key-meter` is visible when this-key status is ok. `usage-desk-estimate` contains `$`. If this desk has priced runs, `usage-model-chart` shows one bar per model.
- **IDE proof.** Screenshot + snapshot under `evidence/settings/<run-id>/` with the form, privacy note, runtime, and usage.
- **Cloud.** Same empty-state assertions in `foundation.spec.ts`. Do not paste a gateway key.

## Gotchas

- Saving probes `GET /v1/models` against the saved URL. A typo or `http://` non-loopback URL is a product 400, not a harness bug.
- The raw key never comes back after save. A filled `openai-key` on reload means you are looking at the empty replace-placeholder, not the secret.
- Advanced fields remain in the host store (guard on, tools on) but are not in the GTM UI. Hunting for `injection-guard-bypass` and finding count 0 is a pass.
- `runtime-status` is the user-visible doctor. Trust that text over env `AGENTFORGE_RUNTIME` once a key exists — `resolveRuntimeMode` prefers a saved key.
- Mutating `/api` from a non-localhost Origin is rejected. Webdev: drive `127.0.0.1:3000`. Packaged: any loopback Origin on the ephemeral port is allowed; do not doctor :3000 as the app.
- Settings is not a product mode. The rail control is `settings-link`, not `mode-settings`.
- This key is gateway-billed spend for that `sk-` (all clients). This desk is an Agentforge estimate from local tokens × catalog prices. They will not match.
- There is no Access Token field and no key create/revoke UI. Do not hunt for one.

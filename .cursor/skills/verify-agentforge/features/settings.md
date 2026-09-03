# Settings

Settings is where the owner pastes a Toko Token gateway key from api.tokotokenai.com. There is no login. The page shows the key field, Save, a compact this-key usage strip with Open Usage, privacy note, and runtime status. There is no Advanced tab, no Extras, no Build/Agents links, and no injection-guard bypass in the UI.

## Sub-features

- `settings-open` shows the gateway form (`settings-form`, `openai-key`, `save-settings`).
- `settings-privacy` shows the retention / no-log note (`privacy-note`).
- `settings-runtime` reports offline demo or live status on `runtime-status`.
- `settings-usage-empty` shows `usage-this-key` asking to paste a gateway key when none is saved, plus `usage-open` → `/usage`. Full by-model chart and desk estimate live on Usage — see [usage.md](./usage.md).

## How to get to it (user POV)

- Choose Settings on the left rail (`settings-link`).
- Packaged: Settings in the Electron window (not :3000; no HTTP).
- From Chat empty-state copy, follow the Settings link.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Do **not** click `save-settings` or paste a key unless the operator asked.
- Do **not** type into `openai-key` on the operator's desk.

- **Open Settings.** Click `settings-link` or go to `/settings`. URL matches `/settings`. `settings-form` is visible (15s). `settings-tab-simple`, `settings-tab-advanced`, `settings-build-link`, `openai-base-url`, and `injection-guard-bypass` have count 0.
- **Identity.** `openai-key`, `save-settings`, and `privacy-note` are visible.
- **Runtime.** With no provider key, `runtime-status` contains `Offline demo` and `no keys yet` (15s). If a key is already saved, the line contains `Status: Live` and `Gateway key saved` — record that; it is not an offline fail.
- **Usage strip (Cloud / no key).** `usage-this-key` contains `Paste a gateway key`. `usage-open` is visible. Do not assert `usage-by-model` or `usage-desk-estimate` on Settings.
- **Open Usage.** Click `usage-open` (or rail `usage-link`). Continue on [usage.md](./usage.md).
- **IDE proof.** Screenshot + snapshot under `evidence/settings/<run-id>/` with the form, privacy note, runtime, and Open Usage.
- **Cloud.** Same empty-state assertions in `foundation.spec.ts`. Do not paste a gateway key.

## Gotchas

- Saving probes `GET /v1/models` against the locked gateway URL (Toko Token on webdev; AIHub on Kemenkeu / Metranet flavors). A missing key is a product 400/offline demo, not a harness bug.
- GET Settings may still embed a this-key snapshot for the slim strip. Full range charts use `GET /api/v1/usage` on the Usage page.
- The raw key never comes back after save. A filled `openai-key` on reload means you are looking at the empty replace-placeholder, not the secret.
- Advanced fields remain in the host store (guard on, tools on) but are not in the GTM UI. Hunting for `injection-guard-bypass` and finding count 0 is a pass.
- `runtime-status` is the user-visible doctor. Trust that text over env `AGENTFORGE_RUNTIME` once a key exists — `resolveRuntimeMode` prefers a saved key.
- Mutating `/api` from a non-localhost Origin is rejected on **webdev**. Packaged has no HTTP API; the renderer uses IPC. Do not doctor :3000 as the app.
- Settings is not a product mode. The rail control is `settings-link`, not `mode-settings`.
- There is no Access Token field and no key create/revoke UI. Do not hunt for one.

# Settings

Settings is where the owner pastes a Toko Token gateway key from api.tokotokenai.com. There is no login. The page shows the key field, Save, a compact this-key usage strip with Open Usage, privacy note, and runtime status. There is no Advanced tab, no Extras, no Build/Agents links, and no injection-guard bypass in the UI. Below the privacy note sits the **Start over** card: sign out of the gateway, or reset the machine to a fresh install.

## Sub-features

- `settings-open` shows the gateway form (`settings-form`, `openai-key`, `save-settings`).
- `settings-privacy` shows the retention / no-log note (`privacy-note`).
- `settings-runtime` reports offline demo or live status on `runtime-status`.
- `settings-edit-turn-cap` (`apps/web/components/settings-page.tsx:396`) is the Edit studio's per-turn USD cap, a number input in the gateway card (0.5–50, default 2). It travels with the key on save — the settings POST body is exactly `{ openaiApiKey, editTurnCapUsd }` — so **reading it is free, but typing in it and pressing `save-settings` writes to the operator's desk**. Read the value, never change it.
- `settings-usage-empty` shows `usage-this-key` asking to paste a gateway key when none is saved, plus `usage-open` → `/usage`. Full by-model chart and desk estimate live on Usage — see [usage.md](./usage.md).
- **Endpoint: not shown at all (2026-09-17).** The gateway URL is pinned host-side (`packages/core/src/gateway/pinned.ts`) and was removed from the UI: there is no `settings-endpoint` element, no **Endpoint URL** label, no locked-endpoint helper line and no reset control. Settings names the host in exactly two prose strings — the intro sentence ("Paste your Toko Token API key from api.tokotokenai.com") and the privacy note ("Prompts leave this machine only over HTTPS to api.tokotokenai.com"). Both come from `{gatewayHost}` via `gatewayHostLabel()`, never from an element that looks editable. `POST /api/v1/settings` no longer reads `openaiBaseUrl` from the body at all, so there is nothing to validate or reject.
- `settings-gateway-status` (`apps/web/components/settings-page.tsx:344`) is the key verdict row under the field: `Key verified · Last checked <date> · Re-check` when the verdict is ok, `Key rejected by gateway · Last checked <date> · Re-check` after a failed re-check. On a `stub`, `needs_key` or never-checked desk there is **no** `Last checked` chip at all — `checkedAt` is null and the row is the status word plus Re-check (driven 2026-09-17 on the operator's stub desk: "Demo luring · Periksa ulang"). `settings-gateway-recheck` (:353) re-probes. `settings-gateway-grace` (:359) renders only under grace; `settings-gateway-reason` (:364) only for `invalid_key` / `unreachable` / `error`. Full gate recipe: [gateway-gate.md](./gateway-gate.md).
- `settings-locale` (`apps/web/components/settings-page.tsx:313`) is the language `<select>`. Changing it renders the restart banner `settings-locale-restart` (:321) with `settings-locale-restart-button` (:326). Full language recipe: [locale.md](./locale.md).
- `settings-reset` (0.14.26) is the **Start over** card after `privacy-note`. Two destructive rows, no `window.confirm`: `settings-reset-key` opens `settings-reset-key-confirm` (`settings-reset-key-submit`, `settings-reset-cancel`) and POSTs `/api/v1/settings/reset` with `{ scope: "key" }` — the key is forgotten on every desk, threads stay, and the app drops to onboarding. `settings-reset-all` opens `settings-reset-all-confirm` (`settings-reset-all-confirm-name`, `settings-reset-all-submit`, `settings-reset-cancel`); the owner types the literal `RESET` before submit enables, and the POST carries `{ scope: "all", confirm: "RESET" }`. Afterwards the card shows `settings-reset-restarting` (packaged: the shell relaunches with `reset`) or `settings-reset-restart-needed` (webdev: no bridge, restart the dev server by hand). A refused reset renders `settings-reset-error`. **On a hosted build both rows refuse.** With `AGENTFORGE_SERVER=1` each scope answers `403 reset_disabled` before anything is touched — `resetGatewayKey` at `packages/host/src/handlers/settings.ts:400-440` and `resetEverything` at `:330-332` — so this recipe is a webdev and desktop walk only; on a hosted desk the proof is the 403 and an unchanged key.
- `settings-reset-pending` (0.14.26) is the banner the same card shows while a full reset is queued (`GET /api/v1/settings` → `resetPending: true`): `settings-reset-pending-cancel` sends `DELETE /api/v1/settings/reset` and swaps to `settings-reset-pending-cancelled`; `settings-reset-pending-restart` (packaged only) relaunches with the wipe. A refused relaunch (update installing, already exiting, forbidden sender) shows `settings-reset-restart-needed` with the reason instead of `settings-reset-restarting`.
- `settings-updates` moved to the rail in 0.14.21: `app-updates-toggle` in `rail-footer` opens `app-updates-panel` (`app-updates-status`, `app-updates-check` / `app-updates-install`, `app-updates-close`). DPSBuddy only. Webdev: check button disabled, copy says the installed app downloads GitHub releases. Packaged DPSBuddy: check / update-and-restart. Flavors render no icon.

## How to get to it (user POV)

- Choose Settings on the left rail (`settings-link`).
- Packaged: Settings in the Electron window (not :3000; no HTTP).
- From Chat empty-state copy, follow the Settings link.

## Driving it with the DPSBuddy harness

Preconditions:

- Doctor exits 0.
- Do **not** click `save-settings` or paste a key unless the operator asked.
- Do **not** type into `openai-key` on the operator's desk.

- **Open Settings.** Click `settings-link` or go to `/settings`. URL matches `/settings`. `settings-form` is visible (15s). `settings-tab-simple`, `settings-tab-advanced`, `settings-build-link`, `openai-base-url`, and `injection-guard-bypass` have count 0. Packaged: prove this in the Electron window. When a key is saved, `key-fingerprint` is present and its text matches `/sha256:[0-9a-f]{12}/` — the sentence around it is locale copy (`settings.fingerprint`; `apps/web/locales/en/settings.json:20`, `apps/web/locales/id/settings.json:20`), so never match the English words. The hash is host-side (`packages/core/src/security/fingerprint.ts:14` — `sha256:` plus the first 12 hex chars), same assertion [security.md](./security.md) uses. Desktop doctor does not print `keyFingerprint`.
- **Identity.** `openai-key`, `save-settings`, and `privacy-note` are visible.
- **Edit turn cap.** `settings-edit-turn-cap` is visible and its value parses as a number between 0.5 and 50. Record it; do not change it. It is the only other writable field on the page.
- **Runtime.** With no provider key, `runtime-status` contains `Offline demo` and `no keys yet` (15s). If a key is already saved, the line contains `Status: Live` and `Gateway key saved` — record that; it is not an offline fail.
- **Usage strip (Cloud / no key).** `usage-this-key` contains `Paste a gateway key`. `usage-open` is visible. Do not assert `usage-by-model` or `usage-desk-range` on Settings.
- **Gateway status.** `settings-gateway-status` is visible and names a verdict plus `Last checked`. With a good key it reads `Key verified · Last checked <date> · Re-check`; after a failed re-check, `Key rejected by gateway · Last checked <date> · Re-check`. `settings-gateway-grace` has count 0 unless the desk is in grace, `settings-gateway-reason` count 0 unless the verdict is `invalid_key` / `unreachable` / `error`. Click `settings-gateway-recheck` only when the operator asked — it probes their key. Full walk: [gateway-gate.md](./gateway-gate.md).
- **Language.** `settings-locale` is visible with the saved language. Change it and `settings-locale-restart` plus `settings-locale-restart-button` appear; leave the restart to the operator. Full walk: [locale.md](./locale.md).
- **Endpoint (must be absent).** `settings-endpoint` has count 0, `settings-endpoint-reset` has count 0, `openai-base-url` has count 0, and no `<input>` on the page has a value containing `tokotokenai`. The only place the host may appear is the intro paragraph text.
- **Open Usage.** Click `usage-open` (or rail `usage-link`). Continue on [usage.md](./usage.md).
- **Start over card (look, do not press).** 1. Scroll past `privacy-note`; `settings-reset` is visible. 2. `settings-reset-key` and `settings-reset-all` are visible and both confirm panels have count 0 until one is clicked. 3. Only if the operator asked for a fresh-install demo: click `settings-reset-all`, assert `settings-reset-all-confirm` is visible, type `RESET` into `settings-reset-all-confirm-name`, confirm `settings-reset-all-submit` goes from disabled to enabled, then click `settings-reset-cancel` and assert the panel is gone. 4. Record the enable/disable flip as the proof; do **not** click either submit. 5. Locale walk: with `id` saved, the card heading reads `Mulai ulang dari awal` and the typed-confirm line still names the literal `RESET`.
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
- Since 2026-09-17 the endpoint row is gone, not read-only. Hunting for `settings-endpoint` (or `settings-endpoint-reset`) and finding count 0 is the pass; finding either is a regression. Older runs and the 0.14.21 changelog describe an **Endpoint URL** line — that is history, not the current UI.
- The gateway status row and the `settings-reset` Start-over card sit on the same page. Reading the verdict is free; `settings-gateway-recheck` is a live probe. Do not confuse a rejected-key row with a broken page.
- **`settings-reset-key-submit` and `settings-reset-all-submit` are destructive and must not be clicked on the operator's desk unless asked** — the same rule as `save-settings`. Sign-out forgets the gateway key on every desk; fresh install deletes every thread, desk, knowledge base, and generated file, and there is no undo. Typing `RESET` into `settings-reset-all-confirm-name` is safe on its own; the POST only fires on submit. Drive the full wipe on a throwaway `AGENTFORGE_DATA_DIR`, never on the operator's install.
- The gateway card has **two** inputs, not one. A recipe that asserts "the only input is the key" fails on `settings-edit-turn-cap`. The endpoint assertion that still holds is the narrower one: no input's *value* contains `tokotokenai`.
- There is no Access Token field and no key create/revoke UI. Do not hunt for one.

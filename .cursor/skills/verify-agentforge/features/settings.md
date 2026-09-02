# Settings

Settings is where the owner pastes a Toko Token gateway key. There is no login. Simple (default) shows the key field, Save, Usage panel, and privacy note. Advanced holds base URLs, dialect probe, tool backends, per-mode selects, and Extras. Runtime status stays visible on both tabs.

## Sub-features

- `settings-open` shows the gateway form and Build / Agents links.
- `settings-tabs` defaults to Simple (`settings-tab-simple`); Advanced is `settings-tab-advanced`.
- `settings-privacy` shows the retention / no-log note on Simple (`privacy-note`).
- `settings-runtime` reports offline demo or live status on `runtime-status` (visible on both tabs).
- `settings-placeholder` keeps the gateway URL placeholder `https://api.tokotokenai.com/v1` on `openai-base-url` (Advanced only).
- `settings-extras` reveals optional keys only after Advanced is selected and the Extras disclosure is opened (tavily / brave / fal, plus Anthropic / Volcengine / backends). Tool enable checkboxes (`tool-enabled-calculator` and siblings) stay here. `injection-guard-bypass` is Advanced-only, unchecked by default — do not turn it on unless the operator asked.
- `settings-usage-empty` shows `usage-panel` on Simple with `usage-this-key` asking to paste a gateway key when none is saved. `usage-by-model` is visible (empty copy until this desk has priced runs).
- `settings-usage-this-key` shows billed spend/remaining in USD on `usage-this-key` when a key is saved (host reads Toko `/api/usage/token` with the saved `sk-`; never an Access Token). `usage-key-meter` is the used vs remaining bar.
- `settings-usage-desk-estimate` shows `usage-desk-estimate` in USD from recorded input/output tokens × public `/api/pricing`. Old threads stay `$0.00` until new runs land.
- `settings-usage-by-model` charts spend per model on `usage-by-model` / `usage-model-chart` from the same desk tokens × catalog prices. Bars are USD; each row also shows run count and input/output tokens. Gateway this-key totals stay one number — Toko `/api/usage/token` has no per-model split.

## How to get to it (user POV)

- Choose Settings on the left rail (`settings-link`).
- Webdev: open `http://127.0.0.1:3000/settings`. Packaged: Settings in the Electron window (not :3000).
- From Chat empty-state copy, follow the Settings link.
- Simple is the default tab. Open Advanced for base URLs, tool backends, per-mode models, and Extras.

## Driving it with the Agentforge harness

Preconditions:

- Doctor exits 0.
- Do **not** click `save-settings` or paste a key unless the operator asked.
- Do **not** type into `openai-key` on the operator's desk.

- **Open Settings.** Click `settings-link` or go to `/settings`. URL matches `/settings`. `settings-form` is visible (15s). `settings-tab-simple` and `settings-tab-advanced` are visible; Simple is selected by default.
- **Simple identity.** `openai-key`, `save-settings`, and `privacy-note` are visible. `settings-build-link` and `settings-agents-link` are visible. `openai-base-url` is **absent** until Advanced is opened.
- **Runtime.** With no provider key, `runtime-status` contains `Offline demo` and `no keys yet` (15s). If a key is already saved, the line contains `Status: Live` and `Gateway key saved` — record that; it is not an offline fail. Stay on either tab; the line does not hide.
- **Usage empty (Cloud / no key).** On Simple, `usage-panel` is visible. `usage-this-key` contains `Paste a gateway key`. `usage-desk-estimate` is visible (usually `$0.00`). `usage-by-model` is visible. `usage-key-meter` and `usage-model-chart` are absent until a key / priced desk runs exist.
- **Usage live (Windows, key already saved, read-only).** Do not paste a key. On Simple, `usage-this-key` contains `$` used (or Unlimited, or a visible fail pointing at the dashboard). `usage-key-meter` is visible when this-key status is ok. `usage-desk-estimate` contains `$`. If this desk has priced runs, `usage-model-chart` shows one bar per model and `usage-model-row-<model-id>` lists USD. This key ≠ this desk.
- **Advanced.** Click `settings-tab-advanced`. `openai-base-url` is visible and its `placeholder` is `https://api.tokotokenai.com/v1`. Dialect probe text may appear on `dialect-probe` after a prior save/detect. Per-mode selects and tool backends live here.
- **Extras (read-only).** Still on Advanced, click the text `Extras` (exact). `anthropic-key`, `volcengine-key`, `tavily-key`, `brave-key`, `fal-key`, `image_gen-backend`, and `video_gen-backend` become visible. `tool-enabled-calculator` (and the other tool enable boxes) are visible. `injection-guard-bypass` is visible and **unchecked**. Do not fill keys. Do not check the bypass.
- **IDE proof.** Screenshot + snapshot under `evidence/settings/<run-id>/` with Simple (form, privacy note, runtime, usage) and at least one Advanced/Extras shot.
- **Cloud.** Same empty-state assertions in `foundation.spec.ts` (click `settings-tab-advanced` before `openai-base-url` / Extras). Do not paste a gateway key.

## Gotchas

- Saving probes `GET /v1/models` against the pasted URL. A typo or `http://` non-loopback URL is a product 400, not a harness bug.
- The raw key never comes back after save. A filled `openai-key` on reload means you are looking at the empty replace-placeholder, not the secret.
- `openai-base-url` and Extras are Advanced-only. Asserting them on Simple is a harness bug, not a product fail.
- `runtime-status` is the user-visible doctor. Trust that text over env `AGENTFORGE_RUNTIME` once a key exists — `resolveRuntimeMode` prefers a saved key.
- Mutating `/api` from a non-localhost Origin is rejected. Webdev: drive `127.0.0.1:3000`. Packaged: any loopback Origin on the ephemeral port is allowed; do not doctor :3000 as the app.
- Settings is not a product mode. The rail control is `settings-link`, not `mode-settings`.
- This key is gateway-billed spend for that `sk-` (all clients). This desk is an Agentforge estimate from local tokens × catalog prices. They will not match. The by-model chart is this desk only.
- Seedance / tiered jobs are omitted from the desk dollar amount (“billed after they finish”). Do not treat that as a harness fail.
- There is no Access Token field and no key create/revoke UI. Do not hunt for one.

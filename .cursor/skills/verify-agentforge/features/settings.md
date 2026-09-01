# Settings

Settings is where the owner pastes a Toko Token gateway URL and key. There is no login. The form, privacy note, and runtime line are visible without saving. Extras (Anthropic, Volcengine, FAL, generate backends) stay collapsed until opened.

## Sub-features

- `settings-open` shows the gateway form and Build / Agents links.
- `settings-privacy` shows the retention / no-log note.
- `settings-runtime` reports `stub` or live status on `runtime-status`.
- `settings-placeholder` keeps the gateway URL placeholder `https://api.tokotokenai.com/v1`.
- `settings-extras` reveals optional keys only after the Extras disclosure is opened.

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
- **Extras (read-only).** Click the text `Extras` (exact). `anthropic-key`, `volcengine-key`, `fal-key`, `image_gen-backend`, and `video_gen-backend` become visible. Do not fill them.
- **IDE proof.** Screenshot + snapshot under `evidence/settings/<run-id>/` with the form, privacy note, and runtime line visible.
- **Cloud.** Same assertions in `foundation.spec.ts`.

## Gotchas

- Saving probes `GET /v1/models` against the pasted URL. A typo or `http://` non-loopback URL is a product 400, not a harness bug.
- The raw key never comes back after save. A filled `openai-key` on reload means you are looking at the empty replace-placeholder, not the secret.
- `runtime-status` is the user-visible doctor. Trust that text over env `AGENTFORGE_RUNTIME` once a key exists — `resolveRuntimeMode` prefers a saved key.
- Mutating `/api` from a non-localhost Origin is rejected. Webdev: drive `127.0.0.1:3000`. Packaged: any loopback Origin on the ephemeral port is allowed; do not doctor :3000 as the app.
- Settings is not a product mode. The rail control is `settings-link`, not `mode-settings`.

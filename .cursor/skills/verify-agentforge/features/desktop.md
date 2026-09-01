# Desktop

Electron is the installed local app. Packaged builds bind an **ephemeral loopback port** (never 3000). Port 3000 is the **webdev prototype** (`pnpm dev`) only. Wrap key: keytar `Agentforge` / `wrap-key`. SQLite: Electron `userData`.

## Sub-features

- `desktop-launch` opens the **installed** Agentforge (Start menu / NSIS). Splash then Chat in the Electron window. Child is bundled `node.exe` + `server.js` on a private loopback port written to `%APPDATA%\Agentforge\app-url.txt`.
- `desktop-splash` shows the splash page until that private URL answers `/chat`.
- `desktop-chat` loads Chat in the window (not in Chrome on :3000).
- `desktop-dev` (`pnpm desktop:dev`) is the **webdev prototype in a window**. It may reuse `pnpm dev` on :3000. That is not packaged proof.
- `desktop-quit` kills the bundled child only if this Electron process spawned it. Closing the installed app must not stop `pnpm dev` on :3000.

## How to get to it (user POV)

- **Packaged (the product):** install `apps/desktop/dist/Agentforge Setup 0.1.0.exe` (local build artifact, gitignored), then Start menu → Agentforge. No Node/pnpm on PATH. No :3000.
- **Webdev window:** from repo root `pnpm desktop:dev`. That still talks to the prototype on :3000.

## Driving it with the Agentforge harness

Preconditions:

- Packaged proof: the NSIS app is installed or you launch `win-unpacked\Agentforge.exe` after `desktop:build`. Do **not** treat Chrome/`pnpm dev` on :3000 as desktop.
- Webdev window proof: `pnpm install` done; `pnpm desktop:dev`. If :3000 is already serving, record `desktop-dev` reuse — not packaged.
- Do not run Playwright on Windows for this feature.
- Do not use Hermes tools, Hermes dashboard tokens, or Hermes `hermes:api`. Agentforge keys are processed as in the main skill **Keys** section.

- **Packaged launch.** Start Agentforge from the Start menu. Splash, then Chat in the Electron window (up to ~60s first boot).
- **Doctor.** `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop` exits 0. JSON `surface` is `"desktop"` and `url` is **not** `:3000`.
- **Chat.** In the Electron window: `model-picker` and `composer` visible (same as [chat.md](./chat.md)).
- **Settings.** In the window, rail `settings-link`; `settings-form` visible. Do not paste a key unless the operator asked.
- **Quit.** Close the window. Packaged child exits. `pnpm dev` on :3000, if running, stays up.
- **IDE proof.** Screenshot of the Electron window on Chat under `evidence/desktop/<run-id>/`. Include doctor JSON (`--desktop`).

## Gotchas

- **Built (2026-08-31, this machine):** `apps/desktop/dist/Agentforge Setup 0.1.0.exe` (~168 MB, unsigned). Smoke: staged `node.exe` + `server.js` on a **non-3000** port with a fresh temp `AGENTFORGE_DATA_DIR` — `GET /chat` 200 and `GET /api/v1/workspaces` returned Home. Dist is gitignored; do not claim Phase 2d “not built” on this checkout.
- Packaged Electron **must not** `loadURL('http://127.0.0.1:3000')` and **must not** reuse an existing :3000 process. If doctor `--desktop` reports port 3000, that is a fail.
- `pnpm desktop:dev` is still the webdev prototype in a Chromium frame. It is allowed to use :3000. Do not sell that as installer proof.
- Schema is created in-process on first SQLite open (`ensureSchema` / committed drizzle migrations).
- keytar may fall back to a session-only wrap key if Credential Manager is unavailable — doctor still works; note it in evidence.
- Never put `AGENTFORGE_SECRETS_KEY` or the gateway key in the renderer or `NEXT_PUBLIC_*`.
- Single-instance: a second launch focuses the existing window.
- Cursor browser overlay can steal clicks; the Electron window itself is the primary proof surface for desktop.
- **Installer “Agentforge cannot be closed”:** X on the window does not always kill `Agentforge.exe` (it still owns bundled `node.exe`). Cancel the wizard, Task Manager → end **Agentforge**, then Retry — or use a build that ships `build/installer.nsh` (`taskkill /F /IM Agentforge.exe /T`).
- **userData folder:** packaged `package.json` name used to be `@agentforge/desktop`, so Electron wrote `%APPDATA%\@agentforge\desktop`. Product path is `%APPDATA%\Agentforge` (`app.setName` + `extraMetadata.name`). Doctor `--desktop` still falls back to the scoped folder if that is all that exists.
- **styled-jsx:** Next standalone under pnpm does not hoist `styled-jsx` next to `next`. `stage-web.mjs` copies it into `apps/web/node_modules/styled-jsx`. If splash hangs, read `logs/web.log` in userData — `Cannot find module 'styled-jsx/package.json'` is this bug.

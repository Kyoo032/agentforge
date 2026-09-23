# Agentforge move log

Append-only record of relocations: commands, packages, product identity, data paths. Agents add a dated entry when something moves so the next session is not guessing.

Format:

```markdown
## YYYY-MM-DD — short title

- **What:** …
- **From:** …
- **To:** …
- **Why:** …
```

---

## 2026-09-08 — macOS shell rows: lifecycle module, tracked helpers, updater off on darwin

- **What:** Per-platform exit / reopen decisions and the fate of spawned helpers on quit.
- **From:** `main.cjs` inlined `process.platform` checks; on macOS / Linux `app.quit()` left `ffmpeg` running; a Dock reopen after boot loaded a splash that never advanced; `auto-update.cjs` would have offered a download the unsigned mac app cannot install; both mac arches wrote the same `Agentforge Setup <v>.dmg`.
- **To:** `apps/desktop/lifecycle.cjs` (pure, tested) decides `shouldQuitOnLastWindow` / `exitStrategy` / `reopenTarget`; `packages/host/src/child-processes.ts` tracks every `runFfmpeg` child and the shell's `before-quit` calls `killTrackedChildren()`; `updatesEnabled(..., platform)` is false on darwin with a user-facing reason in the state `message`; `mac.artifactName` is `Agentforge-<v>-mac-<arch>`; `desktop-build-mac*` run `pack-brand.mjs --restore-public` first; `build/icon.png` (1024²) is the mac icon source.
- **Why:** macOS port rows 1, 3, 6 in `apps/desktop/platform/macos/AGENTS.md`. Windows `exitApp` semantics are unchanged (`taskkill /T`, plain exit during an update install). Unproven on hardware: this checkout cannot run a `.app`.

## 2026-09-02 — Packaged app is IPC, not a Next HTTP child

- **What:** Local Electron host. Main process owns DB, secrets, and media.
- **From:** Packaged Electron spawned bundled `node.exe` + Next `server.js` on an ephemeral loopback port, wrote `app-url.txt`. `stage-web.mjs` copied Next standalone. Doctor `--desktop` HTTP-GETed that URL.
- **To:** `@agentforge/host` dispatch. Vite renderer. Webdev: Express on `127.0.0.1:3000`. Packaged: `host.cjs` in-process + IPC (`window.agentforge`) + `agentforge://media`. `host-status.json` (`transport: "ipc"`). No child Node, no loopback port, no `app-url.txt`. Uninstall wipes `%APPDATA%\Agentforge` and Credential Manager `Agentforge` / `wrap-key`. Native rebuild for `better-sqlite3`/`keytar` is a Windows step, not Cloud.
- **Why:** The installed app died waiting on a Next child (`styled-jsx` / `@swc/helpers`). The product is a local offline desktop app; the only outbound HTTPS is Toko Token on prompt/generate.
- **Not in this move:** a Cloud/Linux NSIS rebuild; Windows unpackaged walk; live product-page Drive.

---


- **What:** Workspace owns product modes; Agents/Studio parked; Settings is key-only
- **From:** Rail = union of custom-agent `productModes` (Home = Chat + Agents until Build). Settings Simple/Advanced + Extras. Create workspace seeds a starter agent and opens `/agents`.
- **To:** `workspaces.product_modes` JSON. Home default = all work modes. `resolveWorkspaceModes` drives the rail. Workspace dropdown above Settings; create/edit presets + mode checkboxes, open → Chat. `/agents` and `/studio/**` redirect to Chat. Settings: paste gateway key, usage, privacy. PStack verify map rewritten for the same surfaces.
- **Why:** GTM answer to “where do I use this Toko Token key?” — not a Hermes-style agent builder.
- **Not in this move:** product rename, public deploy, deleting agent kernel/Studio files, exposing Advanced settings.

## 2026-09-02 — mac/linux desktop targets + mobile docs only

- **What:** electron-builder targets and honest surface docs
- **From:** Windows-only `desktop-build` (`--win nsis` + `check-symlink.mjs`); doctor `--desktop` treated non-Windows as `~/.config/Agentforge/app-url.txt` (wrong on macOS); no mobile map
- **To:** Keep `pnpm desktop:build` as Windows NSIS x64. Add `pnpm desktop:build:mac` (dmg+zip, x64+arm64, unsigned, no notarization) and `pnpm desktop:build:linux` (AppImage+deb x64). mac/linux scripts skip `check-symlink.mjs`. Doctor `--desktop` reads Windows `%APPDATA%\Agentforge` (+ legacy scoped folder), Linux `$XDG_CONFIG_HOME/Agentforge` or `~/.config/Agentforge`, macOS `~/Library/Application Support/Agentforge`. Mobile is docs only (`docs/mobile.md` + verify `features/mobile.md`): no iOS/Android/Capacitor; a phone on LAN `:3000` is not a product surface.
- **Why:** Packaged userData is OS-specific. Cloud cannot prove the existing Windows NSIS exe. Phones are not this week's product.
- **Not in this move:** a Cloud/Linux NSIS rebuild; notarized Mac builds; any mobile binary.

## 2026-08-31 — Packaged app does not use port 3000

- **What:** Packaged Electron loopback bind
- **From:** Hardcoded `127.0.0.1:3000`; reuse whatever was already on that port (including `pnpm dev`)
- **To:** Packaged process allocates an ephemeral loopback port ≠ 3000, writes `%APPDATA%\Agentforge\app-url.txt`, always spawns bundled `node.exe`. `pnpm dev` / `pnpm desktop:dev` keep :3000 as local webdev.
- **Why:** 3000 is local webdev only. The installed app must not steal or share it. Verifier: `doctor.mjs --desktop` refuses :3000.
- **Build proof (this machine):** `apps/desktop/dist/Agentforge Setup 0.1.0.exe`; staged-server smoke on :3011 (not 3000) returned `/chat` 200 and created a Home workspace.

## 2026-08-31 — in-process drizzle migrations + Developer Mode for standalone

- **What:** Runtime schema creation and desktop standalone build preflight
- **From:** Hand-written `ensureSchema` DDL and/or `drizzle-kit push` at boot (cloud-start, GHA e2e, optional Electron path); desktop build assumed symlink create worked
- **To:** Committed `packages/db/drizzle` SQL executed by `ensureSchema` via migrate-equivalent on first SQLite open; no runtime `drizzle-kit push` in cloud-start or GHA e2e. `pnpm desktop:build` runs `check-symlink.mjs` first (Windows Developer Mode or elevated shell required because Next standalone tracing recreates pnpm symlinks).
- **Why:** Installer and Cloud/GHA must not depend on drizzle-kit at runtime; schema lives in committed migrations. Symlink EPERM on Windows without Developer Mode fails the standalone stage mid-build.

## 2026-08-31 — Desktop shell: Tauri → Electron

- **What:** Desktop window and local server ownership
- **From:** `apps/desktop/src-tauri/` (Tauri 2 + Rust). Dev: `beforeDevCommand` starts Next; prod: Rust spawns `pnpm --filter @agentforge/web start`, wrap key via `keyring` crate (`Agentforge` / `wrap-key`), data in Tauri app-data dir.
- **To:** `apps/desktop/main.cjs` (Electron main process). Same loopback URL `http://127.0.0.1:3000`. Wrap key via `keytar` (same service/account names). Data in `app.getPath('userData')`. Electron spawns Next if port 3000 is closed; kills child on quit.
- **Why:** Product decision to standardize on Electron. Next.js UI, SQLite, and verify recipes unchanged.
- **Commands unchanged:** root `pnpm desktop:dev` → `@agentforge/desktop desktop-dev`; `pnpm desktop:build` → `desktop-build`.
- **Installer:** electron-builder NSIS (current user), replaces Tauri NSIS output path.
- **Not in this move:** bundled Node in installer; full verify map for Documents/Research; eval harness.
- **Follow-up in same pass:** Electron runs `drizzle-kit push --force` against `userData` before spawning Next when it owns the server (fresh OS data dir has no tables otherwise).

## 2026-08-31 — Installer bundles Next + Node (Phase 2d)

- **What:** Packaged Windows runtime for Chat
- **From:** NSIS shell only; spawn `pnpm --filter @agentforge/web start` and `drizzle-kit push` (needed Node + pnpm on PATH and a checkout)
- **To:** `output: 'standalone'` Next server + build-machine `node.exe` in `extraResources/web`. Packaged Electron spawns that Node on `server.js`. Schema via in-process `ensureSchema` in `@agentforge/db` (no drizzle-kit at runtime).
- **Why:** Phase 2d — fresh install → paste gateway key → Chat, no Docker, no PATH Node.
- **Dev unchanged:** `pnpm desktop:dev` still starts `pnpm --filter @agentforge/web dev`.
- **Not in this move:** Electron-as-Node (`ELECTRON_RUN_AS_NODE`); shipping a separate Node download; Phase 3 wallet.

## 2026-08-31 — Demo surface is Chrome + `pnpm dev`; desktop shell parked

- **What:** The demo/presentation surface for the product.
- **From:** Desktop shell window (Electron on the Windows working tree).
- **To:** Chrome at `http://127.0.0.1:3000` served by `pnpm dev`. Runbook: [docs/closed-beta.md](../closed-beta.md).
- **Why:** The desktop shell had click-death issues (Next dev error overlay + GPU/sandbox input quirks on Windows). Chrome bypasses the shell problem entirely and is the surface the web app is actually built for. The desktop shell stays in the repo — now Electron, not deleted.
- **Rode along:** Settings Extras now renders its inner fields (provider keys, tool toggles, model/backend selects) only when the `<details>` is open, so a closed Settings page no longer mounts hundreds of hidden nodes. `AppShell` split: the shell chrome is a server component again; only `AppRail` and a tiny `ModeRedirect` stay client.

## 2026-09-08 — Public product and release repo renamed to DPSBuddy

- **What:** The public flavor's product name, installer, icons, and the GitHub releases repo.
- **From:** "Agentforge" (`Agentforge Setup <v>.exe`, `Agentforge-<v>-mac-<arch>.dmg`, `%APPDATA%\Agentforge`, Keychain service `Agentforge`), releases in `Kyoo032/DPS-Agent-Platform`.
- **To:** "DPSBuddy" with the DPS chevron mark (`branding/agentforge/icon.png|icon.ico|logo.png`, `mark.png` is the transparent glyph), `DPSBuddy Setup <v>.exe`, `DPSBuddy-<v>-mac-<arch>.dmg`, releases in `Kyoo032/DPSBuddy` (renamed in place; GitHub 301-redirects the old name, so installed 0.14.23 updaters still resolve `latest.yml`).
- **Kept:** `appId` `com.tokotoken.agentforge` (so NSIS upgrades replace the old install instead of adding a second app), the internal flavor id `agentforge` / `AGENTFORGE_*` env vars / `@agentforge/*` packages, and the private source repo name.
- **Carry-over on first launch after upgrade (`main.cjs`):** `migrateLegacyUserData()` copies `%APPDATA%\Agentforge` into `%APPDATA%\DPSBuddy` when the new desk has no database; `wrapKey()` reads the `Agentforge/wrap-key` Keychain entry and re-saves it under `DPSBuddy` so the stored gateway key stays decryptable. Nothing legacy is deleted until a real uninstall (`installer.nsh` now also removes `%APPDATA%\Agentforge`).
- **Gate:** the updater / preload / renderer no longer compare against a literal; they use `PUBLIC_PRODUCT_NAME` from `brand-read.cjs` (desktop) and `use-app-updates.ts` (renderer), `DEFAULT_PRODUCT_NAME` in `@agentforge/core`.
- **Not in this move:** a version bump or release (next release needs one, since the artifact names changed); dated changelogs / release notes keep the old name; `.cursor` evidence folders are untouched history.

## 2026-09-09 — Market mode joins the rail catalog

- **What:** A new job mode, Market (`market`, `/market`), in `PRODUCT_MODES` after Data.
- **From:** A proposed hosted Python MCP server (`dps-market-mcp`, Postgres + Docker), then a bundled local sidecar.
- **To:** In-process TypeScript in the host: `packages/core/src/market`, `packages/host/src/market`, tools `market_evidence` / `market_news` / `market_search`, SQLite cache. No server, no port, no MCP (later). The Python repo stays as the reference spec at `C:/Users/rizky/dps-market-mcp`.
- **Why:** Owner decision 2026-09-09: local Electron only, no HTTP dependency, no exception to the desktop rules. PStack verify map rewritten for the new surface (`features/market.md`).

## 2026-09-15 — Shell can restart itself ("Start over")

- **What:** How the app ends its own process for a renderer-driven restart (Settings → Start over → Reset to a fresh install).
- **From:** Nothing. The only exits were `exitApp()` (window close / Windows `taskkill /F /PID <pid> /T` tree walk, plain `app.exit(0)` while NSIS installs) and macOS Cmd+Q via `before-quit`. The renderer had no way to ask for a restart; `apps/web/lib/desktop-bridge.ts` already called an optional `bridge.relaunch()` that the preload never exposed.
- **To:** `window.agentforge.relaunch(options?: { reset?: boolean })` → `ipcRenderer.invoke("app:relaunch", { reset })` → `main.cjs` `relaunchApp(reset)`. The decision is pure and testable in `lifecycle.cjs` `relaunchPlan({ platform, installingUpdate, exiting })`: refuse with `installing-update` or `already-exiting`, otherwise `{ ok: true, killChildren: true, strategy: "relaunch-exit" }`. `relaunchApp` sets `exiting` / `hostReady`, clears `session.defaultSession.clearStorageData()` when `reset` is true, signals tracked helpers via `terminateHostChildren()`, then `app.relaunch()` + `app.exit(0)`.
- **Why the strategy is the same on both platforms:** Electron's relauncher is a detached child of this process, so the Windows tree walk in `exitApp()` would kill the process that is supposed to start us again. `exitApp()` semantics are untouched; relaunch simply does not use it. The relauncher waits for this process to exit, so the single-instance lock from module load is released before the new instance asks for it. `killChildren` is true everywhere because the tree walk is skipped: a tracked `ffmpeg` must not outlive the run.
- **Split of responsibilities:** the shell clears only Chromium storage (localStorage, IndexedDB, caches). App-owned files (`agentforge.sqlite`, `settings.enc`, `media/`) are listed by the host in `reset-pending.json` in userData and deleted by `packages/db` on the next boot before SQLite opens. The shell never deletes them.
- **Rows and proof:** new "Relaunch (Settings → reset)" row in [`apps/desktop/platform/README.md`](../../apps/desktop/platform/README.md); smoke step added to both [`windows/AGENTS.md`](../../apps/desktop/platform/windows/AGENTS.md) (step 7) and [`macos/AGENTS.md`](../../apps/desktop/platform/macos/AGENTS.md) (step 8). `node:assert` cases in `apps/desktop/lifecycle.test.cjs` cover every rule on `win32` and `darwin`. Not proven on a packaged build yet — the smoke steps are owed on the installed app.
- **Not in this move:** the Settings UI, the host's `reset-pending.json` writer, and the `packages/db` boot-time delete; each is another worker's.

### 2026-09-15 (later) — review pass on "Start over": the wipe has to stay wiped

- **What:** Four shell rules the first pass left open, plus the renderer contract for a refused restart.
- **Legacy migration is one-shot.** `migrateLegacyUserData()` used to copy an older desk forward whenever `userData\agentforge.sqlite` was missing — which is exactly the state a fresh-install reset leaves behind, so the *second* launch after a reset restored the forgotten gateway key, every thread and all media out of `%APPDATA%\@agentforge\desktop` or `%APPDATA%\Agentforge`. Now `userData\legacy-migrated.json` (`{ version, at, from }`) is written after **any** decision — copied, nothing to copy, or the desk already had a database — and its presence skips the whole step. The decision is pure in `lifecycle.cjs` `legacyMigrationPlan({ markerExists, destHasDb, legacyDirs })` → `"skip" | "mark-only" | "copy"`.
- **The wipe is applied in exactly one place.** `bootstrapPackaged()` sets `AGENTFORGE_APPLY_PENDING_RESET=1` right before `require("./host.cjs")`; `packages/db` acts on `reset-pending.json` only under that flag. Nothing else in the repo sets it.
- **The window denies navigation by default.** New `navigation.cjs` (`rendererOrigin`, `navigationDecision` → `"allow" | "external" | "block"`, `node:assert` tests, in `build.files` and the `test` script) backs `main.cjs` `hardenNavigation`: `setWindowOpenHandler` always denies and `will-navigate` is prevented unless the url is the renderer's own document (packaged `file://…/renderer/index.html`, webdev `http://127.0.0.1:3000`). `http(s)` anywhere else goes to the system browser via `shell.openExternal`. The renderer has no `window.open`, but model output is full of `target="_blank"` links (research sources, market tickers, the ffmpeg setup notice) and each would otherwise have opened a second BrowserWindow on a remote page. `ipcMain.handle("app:relaunch")` now refuses `{ ok: false, reason: "forbidden" }` unless the sender is `mainWindow.webContents.mainFrame`.
- **A refusal is not a restart.** `relaunchApp` sets `exiting` / `hostReady` only *after* `session.defaultSession.clearStorageData()` settles or a 3 s cap fires, so a close arriving mid-clear still takes the normal exit path. `relaunchDesktopApp(options)` in `apps/web/lib/desktop-bridge.ts` is now `Promise<{ ok, reason? }>` (`unavailable` on webdev; a non-object answer is success, because the process exits before it can reply), and both callers await it: the reset card shows `settings-reset-restart-needed` with `reset.restartRefused`, the locale flow falls back to `LOCALE_RESTART_EVENT`.
- **The queued wipe is visible and cancellable.** `GET /api/v1/settings` and the reset responses carry `resetPending`; the card renders `settings-reset-pending` with `settings-reset-pending-cancel` (`DELETE /api/v1/settings/reset` via `cancelReset()` / `parseCancelResetResult`, which fails closed — a cancel the host did not confirm leaves the banner up) and `settings-reset-pending-restart` (packaged only). Keys `reset.pending`, `reset.pendingCancel`, `reset.pendingRestart`, `reset.pendingCancelled`, `reset.restartRefused` in `en` and `id`. The confirm box now sends `typed.trim()` instead of the local constant, since the host is the one comparing it. `RESET_CONFIRM_WORD` stays a local copy in `apps/web/lib/reset-app.ts`: `@agentforge/core` exports it only through the root barrel, which drags `node:async_hooks` (via `tools/secret-scope`) into the renderer and fails the Vite build. Switching the renderer to the shared constant needs a browser-safe subpath in `packages/core/package.json` first.
- **Rows and proof:** three new rows in [`apps/desktop/platform/README.md`](../../apps/desktop/platform/README.md) (external links & navigation, legacy userData migration, applying a queued wipe) and the relaunch row rewritten; smoke steps 8-10 in [`windows/AGENTS.md`](../../apps/desktop/platform/windows/AGENTS.md) and 9-11 in [`macos/AGENTS.md`](../../apps/desktop/platform/macos/AGENTS.md). Not proven on a packaged build: this checkout cannot launch the installed app.


## 2026-09-18 — product target moves from the desktop installer to a hosted web app

- **What:** Where DPSBuddy runs and how it reaches users — the product target itself.
- **From:** A local-first Electron desktop app, one owner per machine, shipped as Windows NSIS / macOS dmg installers from `Kyoo032/DPSBuddy`; the host was IPC-only in the packaged app, data lived in the local data dir, and nothing counted as shipped until it was packed and installed.
- **To:** A hosted, multi-user web app on Kyo’s server: the Express host in `apps/web/server.ts` with the Vite renderer, over HTTPS behind a reverse proxy; one server with many tenants; browser login through the Toko Token portal; the wrap key from `AGENTFORGE_SECRETS_KEY` in the server’s secret manager; seat paywall and entitlement gate server-side. Shipped now means deployed to the hosted environment and driven there, logged by commit sha in the deploy log.
- **Why:** Kyo’s decision of 2026-09-18, recorded in [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md) with the rule changes, the seven open decisions, and the verified architecture facts at `986f113`.
- **Kept:** the Electron desktop app — the **Personal** product, current cut `0.15.0`, under active development again. The pack and release routes, the `Kyoo032/DPSBuddy` releases repo and the semver scheme all continue. Gateway-first is unchanged, and so are the webdev `:3000` rules.
- **Not in this move:** the tenancy schema, the browser login flow, the trusted-origin allowlist and CSRF work on mutating `/api`, hosting and backups, per-tenant media storage, the component installer on a server, and the fate of the Electron-only surfaces. All seven are open in the record.

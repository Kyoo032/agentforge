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


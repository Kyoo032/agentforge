# macOS — shell rules

Status: **port in progress**. Code for the shell rows landed on 2026-09-08 (branch `feat/macos-port-0.14.22`, targets 0.14.22); **nothing has been driven on a real Mac yet**. electron-builder has a `mac` target (dmg + zip, x64 + arm64, `identity: null`) and `scripts/macos-app.mjs` launches a built `.app`. Read [`../README.md`](../README.md) first for the cross-platform matrix; this file adds what is macOS-specific.

## Hard constraints

- **Needs a Mac.** `pnpm desktop:build:mac`, `pnpm desktop:build:mac:dir`, `pnpm desktop:mac`, `@electron/rebuild`, and every smoke step below run on macOS only. This Windows checkout cannot build, sign, or run a `.app`, and Cloud Linux must not try either.
- **The application menu is mandatory.** On macOS Cmd+C/V/X/A/Q exist only as Edit/App menu roles. `edit-menu.cjs` installs App + Edit + Window menus; never set the menu to `null` and never remove the Edit roles. A menu change is tested on both Windows and macOS.
- **Window lifecycle is Dock-style.** `lifecycle.cjs` `shouldQuitOnLastWindow("darwin")` is false: closing the window destroys it, the app stays in the Dock, and `activate` recreates the window. Cmd+Q (the `quit` role) is the only quit path. `exitApp()` and its `taskkill` tree walk never run on macOS.
- **Helpers die with the app.** `before-quit` calls the host's `killTrackedChildren()` (`packages/host/src/child-processes.ts`); `runFfmpeg` registers every ffmpeg / ffprobe it spawns. Anything else the host spawns in future must go through `trackChild`, or it survives Cmd+Q.
- **Secrets.** keytar stores the wrap key in the login Keychain under service `<productName>` / account `wrap-key`. First access on an unsigned app can show a Keychain prompt; "Always Allow" must work, and denying must fall through to the session-key warning, not a crash. Same `settings.enc` format as Windows.
- **Paths.** userData is `~/Library/Application Support/<productName>`. `doctor.mjs --desktop` reads `host-status.json` there. Logs go to `~/Library/Logs/<productName>` (`updater.log` is not written on macOS because the updater is off).
- **Updater is off until signing exists.** `auto-update.cjs` `updatesEnabled(..., "darwin")` is false; the state carries the message "Updates on macOS are manual for now. Download the new .dmg from GitHub Releases." and the renderer shows it in the Updates panel. Never publish a `latest-mac.yml`.
- **Hardware acceleration stays on.** The win32-only `app.disableHardwareAcceleration()` guard must not widen.

## Port checklist (state on 2026-09-08)

| # | Row | Code | Proof |
|---|---|---|---|
| 1 | Child processes on quit | done: `child-processes.ts` registry, `runFfmpeg` tracks, `main.cjs` `before-quit` → `terminateHostChildren()` | pending: smoke step 4 on a Mac |
| 2 | Gatekeeper | n/a | done: right-click → Open / `xattr` step in [`docs/public/0.14.22-notes.md`](../../../../docs/public/0.14.22-notes.md) |
| 3 | Updater | done: `supported: false` + manual-download message on darwin | pending: smoke step 7 |
| 4 | Native modules per arch | electron-builder rebuilds `better-sqlite3` and `keytar` for each arch during `--mac` (`npmRebuild` default). If a build was made with a mismatched ABI, run `npx @electron/rebuild -f -w better-sqlite3 -w keytar` on the Mac and rebuild | pending: both arches launch, `hasOpenai: true` after relaunch |
| 5 | Entitlements / hardened runtime | not added; only needed once signing starts | — |
| 6 | Reopen from the Dock | done: `lifecycle.reopenTarget({ hostReady })` → `createWindow()` loads the renderer directly after boot; `activate` is registered before the host boots | pending: smoke step 3 |
| 7 | Bundled ffmpeg | operator step: drop `ffmpeg` and `ffprobe` (no extension, `chmod +x`, matching arch or universal) into `apps/desktop/resources/ffmpeg/` before each arch build; see [`../../resources/ffmpeg/README.md`](../../resources/ffmpeg/README.md) | pending: `editFfmpeg.found` true in `host-status.json` |
| 8 | Icon | done: `build/icon.png` (1024², rasterized from `branding/agentforge/logo.svg`); electron-builder converts it to `.icns` | pending: Dock shows the mark, not the Electron default |
| 9 | Artifacts | done: `Agentforge-<version>-mac-<arch>.dmg` / `.zip` (`mac.artifactName`), so x64 and arm64 no longer overwrite each other | pending: `dist/` holds four files after `pnpm desktop:build:mac` |

`pnpm desktop:release` is Windows-only (it validates `latest.yml`). Mac artifacts are attached to a DPS Agent Platform release by hand, and only after every "pending" cell above is proven.

## Manual smoke on a Mac after any shell change

1. Fresh install, onboarding: paste the key with Cmd+V **and** with right-click Paste. Continue reaches Chat.
2. Chat composer: Cmd+A / Cmd+C / Cmd+V round-trip; Cmd+Z undo in the composer.
3. Close the window with the red button, click the Dock icon: Chat returns with the session intact, no splash.
4. Start a Videos edit that runs ffmpeg, then Cmd+Q mid-job: Activity Monitor shows no `Agentforge` or `ffmpeg` left.
5. Relaunch: Keychain does not re-prompt, saved key still decrypts (`hasOpenai: true` in `host-status.json`).
6. `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop` passes with `transport: "ipc"`.
7. Rail footer updates icon: the panel reads "Updates on macOS are manual for now…" and **Check for updates** is disabled.

## Do not

- Copy Windows exit semantics (`app.exit`, `taskkill`) to darwin.
- Add Xcode projects, Swift, or iOS Simulator work here; that belongs to [`apps/mobile`](../../../mobile/AGENTS.md).
- Attach a Mac artifact to DPS Agent Platform before the checklist above is proven on hardware.

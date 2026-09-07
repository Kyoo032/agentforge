# macOS — shell rules

Status: **port in progress** (started 2026-09-08). electron-builder already has a `mac` target (dmg + zip, x64 + arm64, `identity: null`) and `scripts/macos-app.mjs` launches a built `.app`, but nothing has been driven on a real Mac yet. Read [`../README.md`](../README.md) first for the cross-platform matrix; this file adds what is macOS-specific.

## Hard constraints

- **Needs a Mac.** `pnpm desktop:build:mac`, `pnpm desktop:build:mac:dir`, `pnpm desktop:mac`, `@electron/rebuild`, and every smoke step below run on macOS only. This Windows checkout cannot build, sign, or run a `.app`, and Cloud Linux must not try either.
- **The application menu is mandatory.** On macOS Cmd+C/V/X/A/Q exist only as Edit/App menu roles. `edit-menu.cjs` installs App + Edit + Window menus; never set the menu to `null` and never remove the Edit roles. A menu change is tested on both Windows and macOS.
- **Window lifecycle is Dock-style.** `shouldQuitOnLastWindow()` returns false on darwin: closing the window hides it, the app stays in the Dock, and `activate` recreates the window. Cmd+Q (the `quit` role) is the only quit path. `exitApp()` and its `taskkill` tree walk never run on macOS.
- **Secrets.** keytar stores the wrap key in the login Keychain under service `<productName>` / account `wrap-key`. First access on an unsigned app can show a Keychain prompt; "Always Allow" must work, and denying must fall through to the session-key warning, not a crash. Same `settings.enc` format as Windows.
- **Paths.** userData is `~/Library/Application Support/<productName>`. `doctor.mjs --desktop` reads `host-status.json` there. Logs go to `~/Library/Logs/<productName>`.
- **Hardware acceleration stays on.** The win32-only `app.disableHardwareAcceleration()` guard must not widen.

## Open port work (each item is a checklist row, not an assumption)

1. **Child processes on quit.** Windows relies on `taskkill /T`. On macOS nothing kills `ffmpeg` spawned by Edit when the user hits Cmd+Q. Track spawned children in the host and kill them on `before-quit`, or Edit is not shippable on Mac.
2. **Gatekeeper.** `identity: null` means an unsigned, un-notarized build. Testers must right-click → Open on first launch or run `xattr -d com.apple.quarantine`. Put that step in `docs/public/<version>-notes.md` before any Mac artifact is attached to a release.
3. **Updater.** electron-updater on macOS refuses to install unless the app is signed. Until signing exists, `auto-update.cjs` must report `supported: false` on darwin so the UI never offers a download that cannot install. Do not publish a `latest-mac.yml` that the app cannot consume.
4. **Native modules per arch.** `better-sqlite3` and `keytar` must be rebuilt for the Electron ABI on each of x64 and arm64. A universal build is optional; two artifacts are acceptable for closed beta.
5. **Entitlements / hardened runtime** are only needed once signing starts. Do not add them speculatively.
6. **Reopen from the Dock.** `createWindow()` always loads the splash. When `activate` fires with `hostReady` true, the new window must go straight to `navigateToUi()`, or the user sees a splash that never finishes.

## Manual smoke on a Mac after any shell change

1. Fresh install, onboarding: paste the key with Cmd+V **and** with right-click Paste. Continue reaches Chat.
2. Chat composer: Cmd+A / Cmd+C / Cmd+V round-trip; Cmd+Z undo in the composer.
3. Close the window with the red button, click the Dock icon: Chat returns with the session intact, no splash.
4. Cmd+Q: Activity Monitor shows no `Agentforge` or `ffmpeg` left.
5. Relaunch: Keychain does not re-prompt, saved key still decrypts (`hasOpenai: true` in `host-status.json`).
6. `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop` passes with `transport: "ipc"`.

## Do not

- Copy Windows exit semantics (`app.exit`, `taskkill`) to darwin.
- Add Xcode projects, Swift, or iOS Simulator work here; that belongs to [`apps/mobile`](../../../mobile/AGENTS.md).
- Attach a Mac artifact to DPS Agent Platform before rows 1 to 3 above are proven on hardware.

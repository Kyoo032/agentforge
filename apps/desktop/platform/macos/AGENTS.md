# macOS — shell rules

> **Desktop is frozen at 0.14.27 — maintenance only.** The product continues as a hosted, multi-user web app.
> The mac port stays where it is: the rules below hold for maintenance work, and it gets no new features.
> Decision record: [`web-pivot-2026-09-18.md`](../../../../docs/internal/web-pivot-2026-09-18.md).

Status: **port in progress**. Code for the shell rows landed on 2026-09-08 (merged to main in PR #24, targets 0.14.22). The dmg + zip are **built on the Windows box through Docker** (see "Building without a Mac"); **nothing has been launched on a real Mac yet**. `scripts/macos-app.mjs` launches a built `.app` on a Mac. Read [`../README.md`](../README.md) first for the cross-platform matrix; this file adds what is macOS-specific.

## Hard constraints

- **Two build paths, one rule set.** On a Mac: `pnpm desktop:build:mac` (electron-builder's own dmg via hdiutil). Anywhere else: `pnpm desktop:build:mac:docker`, which runs the Linux container in [`docker/`](docker/) (electron-builder allows the mac target on Linux, not on Windows). Both produce `DPSBuddy-<version>-mac-<arch>.dmg|zip`. Whatever the path, the *rules in this file* apply: the bundle must pass [`docker/verify-bundle.py`](docker/verify-bundle.py) and the smoke list below still needs a Mac. Never build the mac target directly on the Windows host, and Cloud Linux must not run either path.
- **Launching needs a Mac.** `pnpm desktop:mac`, the Keychain prompt, Cmd+Q, and every smoke step below run on macOS only.
- **The application menu is mandatory.** On macOS Cmd+C/V/X/A/Q exist only as Edit/App menu roles. `edit-menu.cjs` installs App + Edit + Window menus; never set the menu to `null` and never remove the Edit roles. A menu change is tested on both Windows and macOS.
- **Window lifecycle is Dock-style.** `lifecycle.cjs` `shouldQuitOnLastWindow("darwin")` is false: closing the window destroys it, the app stays in the Dock, and `activate` recreates the window. Cmd+Q (the `quit` role) is the only quit path. `exitApp()` and its `taskkill` tree walk never run on macOS.
- **Relaunch is the one other exit.** The Dock and Cmd+Q rules above are unchanged, but `app:relaunch` (Settings → Start over) is the only path besides Cmd+Q that ends the process on macOS: `lifecycle.relaunchPlan` → `app.relaunch()` + `app.exit(0)`, with tracked helpers signalled first (`killChildren` is true on every platform). It never runs `exitApp()` and never touches `taskkill`; the relauncher waits for this process to exit, so the single-instance lock is free for the new one. It is refused while an update installs or while the app is already exiting.
- **Helpers die with the app.** `before-quit` calls the host's `killTrackedChildren()` (`packages/host/src/child-processes.ts`); `runFfmpeg` registers every ffmpeg / ffprobe it spawns. Anything else the host spawns in future must go through `trackChild`, or it survives Cmd+Q.
- **Secrets.** keytar stores the wrap key in the login Keychain under service `<productName>` / account `wrap-key`. First access on an unsigned app can show a Keychain prompt; "Always Allow" must work, and denying must fall through to the session-key warning, not a crash. Same `settings.enc` format as Windows.
- **Paths.** userData is `~/Library/Application Support/<productName>`. `doctor.mjs --desktop` reads `host-status.json` there. Logs go to `~/Library/Logs/<productName>` (`updater.log` is not written on macOS because the updater is off).
- **Updater is off until signing exists.** `auto-update.cjs` `updatesEnabled(..., "darwin")` is false; the state carries the message "Updates on macOS are manual for now. Download the new .dmg from GitHub Releases." and the renderer shows it in the Updates panel. Never publish a `latest-mac.yml`.
- **Hardware acceleration stays on.** The win32-only `app.disableHardwareAcceleration()` guard must not widen.

## Building without a Mac (`pnpm desktop:build:mac:docker`)

Step-by-step guide, the failures hit on 2026-09-08 and their fixes, and the proof carried by the artifacts: [`BUILD-DMG-ON-WINDOWS.md`](BUILD-DMG-ON-WINDOWS.md).

`scripts/mac-build-docker.mjs` builds the image from [`docker/Dockerfile`](docker/Dockerfile) and runs [`docker/build-mac.sh`](docker/build-mac.sh) with the checkout mounted read-only at `/src`, `apps/desktop/dist` at `/out`, and a named cache volume. Only **committed** content is built (the container clones HEAD); starter media is copied from the working tree. Per arch the container:

1. `pnpm install` (Linux), web build, `stage-renderer.mjs`, `pack-brand.mjs --restore-public`.
2. Swaps in darwin natives: better-sqlite3 13 ships N-API `prebuilds/darwin-<arch>.node` in its tarball (only that one is kept, `build/` is deleted); keytar's official `napi-v3-darwin-<arch>` prebuild replaces `build/Release/keytar.node`.
3. `electron-builder --mac --dir --<arch> -c.npmRebuild=false` → `dist/mac[-arm64]/DPSBuddy.app`.
4. `rcodesign sign DPSBuddy.app` (ad-hoc, whole bundle). Required: electron-builder rewrites Info.plist after Electron's own ad-hoc signature, and Apple silicon kills binaries whose signature no longer matches.
5. `verify-bundle.py`: every Mach-O is the requested arch, no ELF/PE leaked from the Linux install, darwin natives present, framework symlinks intact, Info.plist, app.asar holds every shell module, ADHOC CodeDirectory on the main binary / framework / helper.
6. `zip -r -y` (symlinks kept) and [`docker/make-dmg.py`](docker/make-dmg.py): `mkfs.hfsplus` volume, populated entry by entry with `hfsplus` from libdmg-hfsplus (symlinks recreated, execute bits carried), `/Applications` link, `dmg build` → zlib-compressed UDIF. Then `verify-bundle.py --dmg --zip` reads both back with 7-Zip / zipinfo and compares files, sizes, symlinks and the execute bit.

What this path cannot prove: that the app launches. Static checks pass; smoke steps 1 to 7 below are still owed on hardware. Known differences from a Mac build: no `.icns` from `iconutil` (electron-builder converts `build/icon.png` itself, same as on a Mac), HFS+ instead of APFS inside the dmg (mounts on every macOS since 10.12), no bundled ffmpeg (Edit uses a PATH ffmpeg, e.g. Homebrew).

## Port checklist (state on 2026-09-08)

| # | Row | Code | Proof |
|---|---|---|---|
| 1 | Child processes on quit | done: `child-processes.ts` registry, `runFfmpeg` tracks, `main.cjs` `before-quit` → `terminateHostChildren()` | pending: smoke step 4 on a Mac |
| 2 | Gatekeeper | n/a | done: right-click → Open / `xattr` step in [`docs/public/0.14.22-notes.md`](../../../../docs/public/0.14.22-notes.md) |
| 3 | Updater | done: `supported: false` + manual-download message on darwin | pending: smoke step 7 |
| 4 | Native modules per arch | electron-builder rebuilds `better-sqlite3` and `keytar` for each arch during `--mac` (`npmRebuild` default). If a build was made with a mismatched ABI, run `npx @electron/rebuild -f -w better-sqlite3 -w keytar` on the Mac and rebuild | pending: both arches launch, `hasOpenai: true` after relaunch |
| 5 | Entitlements / hardened runtime | not added; only needed once signing starts | — |
| 6 | Reopen from the Dock | done: `lifecycle.reopenTarget({ hostReady })` → `createWindow()` loads the renderer directly after boot; `activate` is registered before the host boots | pending: smoke step 3 |
| 7 | Bundled ffmpeg | not bundled in the preview (no LGPL static mac build to ship); Edit falls back to a PATH ffmpeg (`brew install ffmpeg`), which the public notes say. Mac-built path: see [`../../resources/ffmpeg/README.md`](../../resources/ffmpeg/README.md) | pending: `editFfmpeg.found` true in `host-status.json` with Homebrew ffmpeg |
| 8 | Icon | done: `build/icon.png` (1024², 8-bit, rasterized from `branding/agentforge/logo.svg`); electron-builder converts it to `.icns` | pending: Dock shows the mark, not the Electron default |
| 9 | Artifacts | done: `DPSBuddy-<version>-mac-<arch>.dmg` / `.zip` from `pnpm desktop:build:mac:docker` (both arches, static checks green, sha256 manifest in `dist/`) | pending: install from the dmg on a Mac |
| 10 | Ad-hoc signature | done: `rcodesign sign` in the container; verifier requires an ADHOC CodeDirectory on main / framework / helper | pending: app is not "Killed: 9" on Apple silicon at launch |

`pnpm desktop:release` runs on the Windows box (it validates `latest.yml`) and attaches any `DPSBuddy-<version>-mac-<arch>.dmg|zip` it finds in `apps/desktop/dist/` next to the Windows exe (`scripts/release-artifacts.mjs` picks them; `--require-mac` fails when an arch is missing; `latest-mac.yml` and mac blockmaps are never uploaded). `--attach-mac` adds them to an already-published release and refreshes the notes. Mac artifacts go out labelled **preview** until the smoke list is proven; the notes carry the Gatekeeper and Keychain steps.

## Manual smoke on a Mac after any shell change

1. Fresh install, onboarding: paste the key with Cmd+V **and** with right-click Paste. Continue reaches Chat.
2. Chat composer: Cmd+A / Cmd+C / Cmd+V round-trip; Cmd+Z undo in the composer.
3. Close the window with the red button, click the Dock icon: Chat returns with the session intact, no splash.
4. Start a Videos edit that runs ffmpeg, then Cmd+Q mid-job: Activity Monitor shows no `DPSBuddy` or `ffmpeg` left.
5. Relaunch: Keychain does not re-prompt, saved key still decrypts (`hasOpenai: true` in `host-status.json`).
6. `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop` passes with `transport: "ipc"`.
7. Rail footer updates icon: the panel reads "Updates on macOS are manual for now…" and **Check for updates** is disabled.
8. Settings → Start over → Reset to a fresh install → app restarts on onboarding; userData keeps Chromium folders, loses `agentforge.sqlite`, `settings.enc`, `media/`; `host-status.json` shows `hasOpenai: false`. Activity Monitor shows one `DPSBuddy` and no `ffmpeg` left from the old run; the Dock icon stays in place across the restart.
9. Second launch after that reset stays fresh: onboarding again, `hasOpenai: false`, no threads. The legacy folder under `~/Library/Application Support/` is **not** copied back — `legacy-migrated.json` exists in userData and the old desk is untouched on disk.
10. Queued wipe, second thoughts: Settings → Start over → Reset to a fresh install, then **Keep my data** on the banner. `reset-pending.json` is gone from userData and the next launch keeps every thread and the saved key.
11. Model-output link (a research source, a market ticker, the ffmpeg setup notice) opens the default browser. Never a second app window, and the app window itself has not navigated anywhere.

## Do not

- Copy Windows exit semantics (`app.exit`, `taskkill`) to darwin.
- Add Xcode projects, Swift, or iOS Simulator work here; that belongs to [`apps/mobile`](../../../mobile/AGENTS.md).
- Attach a Mac artifact to DPSBuddy before the checklist above is proven on hardware.

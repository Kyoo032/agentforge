# Desktop shell — platform rules

One Electron shell (`apps/desktop/main.cjs`, `preload.cjs`, `edit-menu.cjs`, `auto-update.cjs`) ships to Windows, macOS, and Linux. Anything that differs per OS is listed here and owned by a platform folder:

| Folder | Owns |
|---|---|
| [`windows/`](windows/AGENTS.md) | The shipping product: NSIS installer, updater, Credential Manager, process-tree exit |
| [`macos/`](macos/AGENTS.md) | The port in progress: app menu, Dock lifecycle, Keychain, Gatekeeper, dmg/zip |
| Linux | No folder yet. Follows the Windows rows below except installer (AppImage/deb) and secrets (libsecret via keytar) |

**Rule 0.** Before changing any row in the matrix, read the folder rules for **every** platform in that row, then smoke-test each one that is available on your machine. The 0.14.2 paste bug is the reference case: `Menu.setApplicationMenu(null)` looked harmless on Windows but removed the Edit roles that back Ctrl/Cmd+V, so nobody could paste an API key into onboarding. A menu row change is a two-platform change.

## Platform matrix

| Concern | Windows | macOS | Code |
|---|---|---|---|
| Application menu | Hidden by `autoHideMenuBar`; the Edit menu must still exist so Ctrl+C/V/X/A work. Alt reveals the bar. | App menu + Edit + Window are mandatory. Without them Cmd+C/V/Q do nothing. | `edit-menu.cjs` `applicationMenuTemplate` |
| Right-click | Electron shows nothing by default; the context menu offers Cut/Copy/Paste on editable fields | Same | `edit-menu.cjs` `attachContextMenu` |
| Window close | Closing the window exits the whole process tree (`taskkill /T`) so `ffmpeg` and helpers die | Close destroys the window and the app stays in the Dock; `activate` recreates it straight into the UI once the host booted; Cmd+Q quits via the `quit` role and `before-quit` signals every tracked helper (`killTrackedChildren`) | `lifecycle.cjs`, `main.cjs` `exitApp`, `terminateHostChildren`; `packages/host/src/child-processes.ts` |
| Relaunch (Settings → reset) | `app:relaunch` → sender guard → `lifecycle.relaunchPlan` → `app.relaunch()` + `app.exit(0)`. Never the `taskkill /T` walk: Electron's relauncher is a detached child and would die with the tree. The handler answers `{ ok: false, reason }` and the renderer must show the refusal, never a "restarting" message: `forbidden` (the sender is not `mainWindow.webContents.mainFrame`), `installing-update` (NSIS restarts the app itself), `already-exiting`, plus `unavailable` invented by the renderer on webdev. A `reset` relaunch awaits `clearStorageData()` (3 s cap) **before** it marks itself exiting | Same call, same guard, same refusals; with the Dock rules untouched this is the only path besides Cmd+Q that ends the process. Tracked helpers are signalled first (`killChildren` is true on every platform) | `lifecycle.cjs` `relaunchPlan`, `main.cjs` `relaunchApp` + the `app:relaunch` handler, `preload.cjs` `relaunch`, `apps/web/lib/desktop-bridge.ts` `relaunchDesktopApp` |
| External links & navigation | Deny by default on both hooks: `setWindowOpenHandler` always returns `{ action: "deny" }` and `will-navigate` is prevented unless the url is the renderer's own document. `http(s)` elsewhere goes to the default browser via `shell.openExternal`; `file://` outside `resources/renderer/index.html`, `agentforge://`, `about:`, `data:` and everything else is dropped. Model output is full of `target="_blank"` links, and each one would otherwise become a second, unhardened BrowserWindow | Same rules, same code; the allowed document is the same packaged `file://` index | `navigation.cjs` `rendererOrigin` / `navigationDecision`, `main.cjs` `hardenNavigation` |
| Legacy userData migration | One-shot. `migrateLegacyUserData()` copies the newest older desk (`%APPDATA%\@agentforge\desktop`, `%APPDATA%\Agentforge`) forward only while `userData\legacy-migrated.json` is absent, then writes that marker after **any** decision — copied, nothing to copy, or the desk already had a database. Without it "no `agentforge.sqlite`" also describes a wiped install, so the second launch after a reset restored the forgotten key, threads and media | Same, against `~/Library/Application Support/<legacy name>`; the marker lives in the same userData folder | `lifecycle.cjs` `legacyMigrationPlan`, `main.cjs` `migrateLegacyUserData` |
| Applying a queued wipe | `bootstrapPackaged()` sets `AGENTFORGE_APPLY_PENDING_RESET=1` immediately before `require("./host.cjs")`. That is the **only** place the flag is set: `packages/db` acts on `reset-pending.json` only when it is `"1"`, so no webdev run, test, or stray import of the host can apply a wipe | Same | `main.cjs` `bootstrapPackaged`, `packages/db` |
| Wrap key for `settings.enc` | Credential Manager entry `<productName>` / `wrap-key` via keytar | Keychain item with the same service/account via keytar; first access can prompt the user | `main.cjs` `wrapKey` |
| userData | `%APPDATA%\<productName>` | `~/Library/Application Support/<productName>` | `main.cjs` `applyProductPaths` |
| Hardware acceleration | Disabled (`app.disableHardwareAcceleration()`) | Enabled | `main.cjs` bottom |
| Installer | NSIS x64, `build/installer.nsh`; uninstall kills the exe and deletes userData | dmg + zip per arch (`DPSBuddy-<v>-mac-<arch>`), `identity: null` (unsigned, not notarized); first launch needs the Gatekeeper step from the public notes | `package.json` `build` |
| Updater | electron-updater against `latest.yml` on DPSBuddy; public DPSBuddy flavor only | Off: `updatesEnabled` is false on darwin and the state carries a "download the .dmg" message the renderer shows; no `latest-mac.yml` is published | `auto-update.cjs` `updatesEnabled`, `unsupportedMessage` |
| Native modules | `@electron/rebuild -f -w better-sqlite3 -w keytar` on Windows | Same command on a Mac, per arch | `package.json` `rebuild-natives` |
| Packaged proof | `doctor.mjs --desktop` reads `host-status.json` in userData | Same, after `pnpm desktop:build:mac:dir` + `pnpm desktop:mac` on a Mac. Without a Mac, `pnpm desktop:build:mac:docker` gives static proof only (`macos/docker/verify-bundle.py`) | `.cursor/skills/verify-agentforge/scripts/doctor.mjs`, `macos/docker/` |
| Media | `agentforge://media/<id>` protocol, IPC transport only | Same | `main.cjs` `registerMediaProtocol` |

## Shared rules

- Platform branching lives in `main.cjs` and the modules it requires (`lifecycle.cjs` holds the pure decisions). The renderer (`apps/web`) never reads `process.platform` or `navigator.platform` to change behavior; it only reads `window.agentforge` through `apps/web/lib/desktop-bridge.ts`. When the shell needs the UI to say something platform-specific, it sends the words (see the updater `message`).
- Anything the host spawns goes through `trackChild` in `packages/host/src/child-processes.ts`; that is the only thing standing between Cmd+Q and an orphaned `ffmpeg` on macOS / Linux.
- New platform-only logic goes in a small `.cjs` module with pure, testable functions and a `node:assert` test next to it (see `edit-menu.cjs` / `edit-menu.test.cjs`). Register the test in `apps/desktop/package.json` `test` and add the module to `build.files`, or the packaged app crashes on `require`.
- Do not move `installer.nsh`, entitlements, or brand files without updating the electron-builder paths in `package.json`.
- Every shell change is appended to the current ship list in `docs/internal/` per the root `AGENTS.md`, and is not "shipped" until packed and driven on the installed app for the platform it targets.
- Cloud Linux agents never run `pnpm desktop:build*` or `@electron/rebuild`. This Windows checkout cannot run a `.app`; it can build one only through the container in `macos/docker/` (`pnpm desktop:build:mac:docker`), never with electron-builder directly.

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

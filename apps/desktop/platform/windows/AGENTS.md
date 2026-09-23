# Windows — shell rules

> **Two products, one repo.** **Personal** is the Mac/Windows DPSBuddy app — current cut `0.15.0`, under active development again.
> The facts below describe the shipped Windows build and have to stay true.
> Decision record: [`web-pivot-2026-09-18.md`](../../../../docs/internal/web-pivot-2026-09-18.md).

Windows is the shipping closed-beta product (NSIS x64). Read [`../README.md`](../README.md) first for the cross-platform matrix; this file only adds what is Windows-specific.

## Facts that must stay true

- **Exit kills the tree.** Closing the window calls `exitApp()` in `main.cjs`, which runs `taskkill /F /PID <pid> /T` so `ffmpeg` and any helper processes die with the app. Exception: while an update is installing (`installingUpdate`), exit is plain `app.exit(0)` so the detached NSIS installer survives. Do not replace this with `app.quit()`.
- **Menu bar is hidden, not removed.** `autoHideMenuBar: true` on the window plus a real Edit menu from `edit-menu.cjs`. Alt shows the bar. Never call `Menu.setApplicationMenu(null)` again; it silently breaks paste for anyone whose habit is right-click or Ctrl+V.
- **Secrets.** Wrap key in Credential Manager (`<productName>` / `wrap-key`, keytar). If keytar fails to load, `wrapKey()` falls back to a session key and the saved gateway key will not decrypt on the next launch. Treat a keytar load failure as a packaging bug, not a warning.
- **Paths.** userData is `%APPDATA%\<productName>`; legacy `%APPDATA%\@agentforge\desktop` and the pre-rename `%APPDATA%Agentforge` desk are copied forward once by `migrateLegacyUserData()`; the `Agentforge` wrap key is carried over the same way. Git tracks the DPSBuddy flavor only; Kemenkeu / Metranet branding folders are gitignored and never uploaded.
- **Hardware acceleration is off** on win32. Keep it off unless a rendering regression is proven on real hardware.
- **Updater.** electron-updater reads `latest.yml` + `.blockmap` from the public DPSBuddy release, only for `productName === "DPSBuddy"` and only when packaged. Errors are mapped to short user messages in `auto-update.cjs`; keep the header dump out of the UI.
- **Installer** (`build/installer.nsh`): per-user, one-click off, can change directory. Re-running setup replaces the install and keeps `%APPDATA%\DPSBuddy`. Uninstall (not upgrade) kills `DPSBuddy.exe`, deletes userData, and removes the Credential Manager entry.

## Build and verify (Windows only)

```
npx pnpm@9.15.9 desktop:build            # renderer + host.cjs + NSIS
cd apps/desktop && npx @electron/rebuild -f -w better-sqlite3 -w keytar
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop         # reads %APPDATA%\DPSBuddy\host-status.json, transport "ipc"
```

Do not run these on Cloud Linux. `pnpm desktop:dev` (Electron around webdev `:3000`, no preload) is not packaged proof.

## Manual smoke after any shell change

1. Fresh install, onboarding: paste the key with Ctrl+V **and** with right-click Paste. Continue reaches Chat.
2. Chat composer: Ctrl+A / Ctrl+C / Ctrl+V round-trip.
3. Close the window: no `DPSBuddy.exe` or `ffmpeg.exe` left in Task Manager.
4. Relaunch: saved key still decrypts (`hasOpenai: true` in `host-status.json`).
5. Rail footer updates icon (between the theme toggle and collapse) opens the panel; Check for updates shows a state, never a raw error dump.
6. Settings → Endpoint URL: a remote `http://` value is rejected on Save; the reset link returns to Toko Token; a custom HTTPS value survives relaunch.
7. Settings → Start over → Reset to a fresh install → app restarts on onboarding; userData keeps Chromium folders, loses `agentforge.sqlite`, `settings.enc`, `media/`; `host-status.json` shows `hasOpenai: false`. Task Manager shows exactly one `DPSBuddy.exe` tree and no `ffmpeg.exe` left from the old run.
8. Second launch after that reset stays fresh: onboarding again, `hasOpenai: false`, no threads. The legacy folder (`%APPDATA%\@agentforge\desktop`, `%APPDATA%\Agentforge`) is **not** copied back — `%APPDATA%\DPSBuddy\legacy-migrated.json` exists and the old desk is untouched on disk.
9. Queued wipe, second thoughts: Settings → Start over → Reset to a fresh install, then **Keep my data** on the banner. `reset-pending.json` is gone from userData and the next launch keeps every thread and the saved key.
10. Model-output link (a research source, a market ticker, the ffmpeg setup notice) opens the default browser. Never a second `DPSBuddy.exe` window, never a window with no menu — and the app window itself has not navigated anywhere.

## Do not

- Add a loopback HTTP server, `app-url.txt`, or a bundled `node.exe`. Packaged Windows is IPC only.
- Edit `apps/desktop` for product features. UI lives in `apps/web`.
- Cross-build macOS from this checkout. See [`../macos/AGENTS.md`](../macos/AGENTS.md).

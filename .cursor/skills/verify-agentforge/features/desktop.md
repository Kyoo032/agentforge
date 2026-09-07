# Desktop

Electron is the installed local app. Packaged builds have **no HTTP server**. The renderer talks to the host over IPC. Port 3000 is the **local webdev** (`pnpm dev`) only. Wrap key: keytar uses the product name (`Agentforge` / `Kemenkeu AI` / `AIHub Metranet`) plus account `wrap-key`. SQLite and `host-status.json` live in that product's Electron `userData`. Flavor rail names: [desktop-brands.md](./desktop-brands.md).

## Sub-features

- `desktop-launch` opens the **installed** Agentforge. Windows product path: Start menu / NSIS. macOS/Linux: operator-built dmg/zip or AppImage/deb. Splash then Chat (or onboarding if no key) in the Electron window. Main process loads `host.cjs` in-process and the Vite renderer from extraResources. Status file: `host-status.json` under userData (`transport: "ipc"`).
  - Windows: `%APPDATA%\Agentforge\host-status.json`
  - Linux: `$XDG_CONFIG_HOME/Agentforge/host-status.json` or `~/.config/Agentforge/host-status.json`
  - macOS: `~/Library/Application Support/Agentforge/host-status.json`
- `desktop-onboarding` (packaged, no saved key): endpoint URL locked to Toko Token, API key field, optional “Use offline demo”. Skipped once a key exists. Webdev/Playwright is **not** gated.
- `desktop-splash` shows the splash page until the host is ready, then loads the renderer (`loadFile`, not a loopback URL).
- `desktop-chat` loads Chat in the window (not in Chrome on :3000).
- `desktop-dev` (`pnpm desktop:dev`) is the **local webdev in a window**. It waits for `GET /api/v1/ping` on :3000 and does **not** attach preload. That is not packaged proof.
- `desktop-quit` exits `Agentforge.exe` (whole process tree) on window close. No tray, no hidden window. Threads and the saved key stay. Uninstall wipes userData + Credential Manager wrap key. Upgrade (same `appId`) kills the running app, overwrites Program Files / per-user install, and **keeps** `%APPDATA%\Agentforge`.
- `desktop-updates` (packaged Agentforge only): Settings `app-updates` checks GitHub Releases (`Kyoo032/agentforge`). **Update and restart** downloads `latest.yml` + the Setup exe and relaunches. Flavors have no button. Webdev shows the strip disabled. A release without `latest.yml` is “no update”, not a harness fail.
- No mobile Electron/Capacitor/RN target. See [mobile.md](./mobile.md).

## How to get to it (user POV)

- **Packaged Windows:** install the NSIS exe, then Start menu → Agentforge. No Node/pnpm on PATH. No :3000.
- **Packaged mac/linux:** operator runs `pnpm desktop:build:mac` or `pnpm desktop:build:linux` **on that OS**. Cloud Linux cannot produce or prove the Windows NSIS exe and must not run `pnpm desktop:build`.
- **Webdev window:** from repo root `pnpm dev` then `pnpm desktop:dev`. That still talks HTTP to local webdev on :3000.

## Driving it with the Agentforge harness

Preconditions:

- Packaged proof: Windows — the NSIS app is installed or you launch `win-unpacked\Agentforge.exe` after `desktop:build`. mac/linux — the operator-built app on that OS. Cloud cannot prove packaged Windows. Do **not** treat Chrome/`pnpm dev` on :3000 as desktop.
- Webdev window proof: `pnpm install` done; `pnpm dev` serving; `pnpm desktop:dev`. If :3000 is already serving, record `desktop-dev` reuse — not packaged.
- Do not run Playwright on Windows for this feature.
- Do not use Hermes tools, Hermes dashboard tokens, or Hermes `hermes:api`. Agentforge keys are processed as in the main skill **Keys** section.

- **Packaged launch.** Start the installed app. Splash, then onboarding or Chat in the Electron window (up to ~60s first boot).
- **Doctor.** `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop` exits 0. JSON `surface` is `"desktop"`, `transport` is `"ipc"`, `url` is `"ipc"`. Doctor reads `host-status.json` (Windows also falls back to `%APPDATA%\@agentforge\desktop`). It does **not** GET `:3000` and does **not** require `app-url.txt`.
- **Chat.** In the Electron window: `model-picker` and `composer` visible (same as [chat.md](./chat.md)), after onboarding if needed.
- **Settings.** In the window, rail `settings-link`; `settings-form` visible. Do not paste a key unless the operator asked.
- **Quit.** Close the window. Process exits. `pnpm dev` on :3000, if running, stays up.
- **IDE proof.** Screenshot of the Electron window on Chat under `evidence/desktop/<run-id>/`. Include doctor JSON (`--desktop`).

## Gotchas

- Cloud / Linux VM: cannot run or rebuild that NSIS exe. Do not run `pnpm desktop:build` here. A missing Cloud `.exe` is not a product fail.
- Packaged Electron **must not** `loadURL('http://127.0.0.1:3000')` and **must not** spawn `node.exe`. If doctor `--desktop` reports an HTTP URL or port 3000, that is a fail.
- Icon/splash flavors: [desktop-brands.md](./desktop-brands.md). Webdev is never a flavor.
- `pnpm desktop:dev` is still the local webdev in a Chromium frame. It is allowed to use :3000. Do not sell that as installer proof.
- Schema is created in-process on first SQLite open (`ensureSchema` / committed drizzle migrations).
- keytar may fall back to a session-only wrap key if the OS keychain is unavailable — doctor still works; note it in evidence.
- Never put `AGENTFORGE_SECRETS_KEY` or the gateway key in the renderer or `NEXT_PUBLIC_*`.
- Single-instance: a second launch focuses the existing window.
- Cursor browser overlay can steal clicks; the Electron window itself is the primary proof surface for desktop.
- **Uninstall:** NSIS `customUnInstall` taskkills `Agentforge.exe`, `RMDir` `%APPDATA%\Agentforge`, and `cmdkey /delete:Agentforge/wrap-key` — only when it is **not** an upgrade (`${isUpdated}`). Reinstall after uninstall must show onboarding. Running setup.exe while the app is open kills `Agentforge.exe` then overwrites the existing install.
- **Upgrade:** same `appId` `com.tokotoken.agentforge`. Desk data and the wrap key stay. Do not treat a missing onboarding screen after upgrade as a fail.
- **userData folder:** packaged `package.json` name used to be `@agentforge/desktop`, so Windows Electron wrote `%APPDATA%\@agentforge\desktop`. Product path is `%APPDATA%\Agentforge`. Doctor `--desktop` still falls back to the Windows scoped folder if that is all that exists.
- Native rebuild: on Windows, `npx @electron/rebuild -f -w better-sqlite3 -w keytar` after install. Not a Cloud step.
- **WinApp in Cursor** is editor debug for this Windows box (extension `Microsoft-WinAppCLI.winapp`, F5 `type: winapp`, `debuggerType: node`). Stack is **Electron + NSIS**, not WinUI/WPF. Use SDK channel **none**. Do **not** `winapp init` the product tree (no `Package.appxmanifest`, no `@microsoft/winappcli` postinstall, no WinApp SDK bindings in `apps/` / `packages/`). Point `inputFolder` at `C:\Program Files\Agentforge` or `apps/desktop/dist/win-unpacked`. Launch args `--remote-debugging-port=9222` so the renderer can be driven over CDP. WinApp loose-layout / sparse identity is **not** the NSIS install — doctor `--desktop` + the Electron window still decide packaged proof. Known WinApp sparse-package bug can blank Electron; if that happens, clear debug identity and launch the installed exe directly.
- **macOS packaged launch** is the Mac counterpart of WinApp F5: `pnpm desktop:build:mac:dir` then F5 `Packaged Agentforge (macOS .app unpacked)` or `pnpm desktop:mac`. Apple’s Simulator and `Agentforge.app` require a Mac. Do not run `desktop:build:mac` on this Windows box or on Cloud Linux. iOS Simulator / Expo are not in this repo.
- **Ship vs desk:** a source edit is not 0.14 until `pnpm desktop:build`, the Setup exe is installed, and Program Files greps HIT (`1st try`, `run.probing`, `coerceReasoningEffortForModel`, `readHttpErrorBody`). Ledger: `docs/internal/0.14-changelog.md` `ship-vs-desk`. Do not trust git `0.14.0` in `package.json` alone — HEAD may still be 0.13.5.

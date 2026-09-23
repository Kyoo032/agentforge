---
name: pack-dpsbuddy
description: >-
  Pack and ship DPSBuddy installers on Kyo's Windows desk — isolated NSIS worktree
  plus Docker macOS dmg/zip, then desktop:release to Kyoo032/DPSBuddy. Maps how each
  OS owns copy/paste (Ctrl vs Cmd, right-click), menus, quit, secrets, and updater.
  Use when the user says pack, repack, ship, desktop:build, desktop:release, Windows
  and macOS installers, or cut a 0.14.2x release. Not Cloud. Not webdev :3000.
---

# Pack DPSBuddy (this Windows PC)

> **Two products, one repo.** **Personal** is the Mac/Windows DPSBuddy app — current cut `0.15.0` (published 2026-09-23), under active development again.
> These pack and release routes serve the Personal app only; the Enterprise web app ships through the deploy route.
> Decision record: [`web-pivot-2026-09-18.md`](../../../docs/internal/web-pivot-2026-09-18.md).

Harness, not product. Same class as `verify-agentforge`. Do not vendor into `apps/`, the installer, or the UI.

One Electron shell ships to both OSes. **How it is packed, how the user steers it, and what counts as proof are different.** Canon: [platform/README.md](../../../apps/desktop/platform/README.md), [windows/AGENTS.md](../../../apps/desktop/platform/windows/AGENTS.md), [macos/AGENTS.md](../../../apps/desktop/platform/macos/AGENTS.md). Code: `edit-menu.cjs`, `lifecycle.cjs`. Traps: [traps.md](traps.md).

**Abort** on Cloud. Do not run `desktop:build` or `desktop:build:mac:docker` off this PC.

## How — two pack routes

Never run one command in the other cwd. Never reuse the other route's proof.

```mermaid
flowchart TB
  subgraph shared [Shared prep — agentforge main]
    P[preflight + bump + public notes + commit HEAD]
  end

  subgraph winRoute [Windows route]
    W1["cwd: C:\\Users\\rizky\\agentforge-pack-VERSION"]
    W2["desktop:build → electron-builder --win nsis"]
    W3["env: Windows Node + Python 3.12 + electron/rebuild"]
    W4["out: Setup VERSION.exe + blockmap + latest.yml"]
    W5["proof: launch win-unpacked DPSBuddy.exe then doctor --desktop"]
    W1 --> W2 --> W3 --> W4 --> W5
  end

  subgraph macRoute [macOS route]
    M1["cwd: C:\\Users\\rizky\\agentforge"]
    M2["desktop:build:mac:docker --arch all"]
    M3["env: Docker Linux + darwin prebuilds + rcodesign + make-dmg.py"]
    M4["out: DPSBuddy-VERSION-mac-ARCH.dmg and .zip"]
    M5["proof: verify-bundle.py on .app AND dmg/zip — this PC cannot launch a .app"]
    M1 --> M2 --> M3 --> M4 --> M5
  end

  subgraph ship [Ship]
    S1[copy Windows artifacts into main dist]
    S2["desktop-release --require-mac → Kyoo032/DPSBuddy"]
  end

  P --> winRoute
  P --> macRoute
  W5 --> S1
  M5 --> S1
  S1 --> S2
```

| | Windows | macOS |
|---|---|---|
| Cwd | `C:\Users\rizky\agentforge-pack-<version>` | `C:\Users\rizky\agentforge` |
| Command | `npx pnpm@9.15.9 desktop:build` | `npx pnpm@9.15.9 desktop:build:mac:docker --arch all` |
| Forbidden | `desktop:build:mac`, `electron-builder --mac` | `desktop:build` in this cwd, `doctor --desktop` as mac proof |

## What this Windows PC can prove

This desk is Windows 11 Home + Docker Desktop (Linux engine via WSL Ubuntu). That is enough to **pack** both desktop installers and to **rehearse** the hosted Linux image. It is not enough to **launch** macOS.

| Surface | Route | This PC proves | Still needs someone else's Mac |
|---|---|---|---|
| Hosted Linux web | not pack — `webapp-deploy/compose.yml` from WSL | image builds, healthcheck, Linux natives in the container | Jakarta CVM (SSM, COS, TLS, security group). Not a pack artifact. |
| Windows desktop | worktree `desktop:build` | launch `win-unpacked\DPSBuddy.exe`, `doctor --desktop`, Ctrl+V **and** right-click paste | nothing for launch. Windows Sandbox would need Pro; Home does not have it. |
| macOS desktop | `desktop:build:mac:docker --arch all` | `verify-bundle.py` on `.app` **and** dmg/zip (arch, no ELF/PE, darwin natives, ad-hoc sign, symlinks, execute bits), `mac-<v>.sha256` | **yes — every launch.** Gatekeeper Open Anyway, Keychain Always Allow, Cmd+V / right-click, Dock reopen, Cmd+Q, `doctor --desktop` under `~/Library/Application Support/DPSBuddy`. |

There is no Mac-out on this box. Docker Desktop builds a dmg; it does not boot macOS. Cua Cloud Fleet has no macOS image. Cua Lume needs Apple Silicon. Hyper-V / Windows Sandbox are not on Home and would not run a `.app` anyway.

A Docker exit 0 is **pack proof**, not **Mac proof**. Until a human on a Mac drives [macos/AGENTS.md](../../../apps/desktop/platform/macos/AGENTS.md) smoke steps 1–11, the cut stays labelled **preview**. 0.14.26 had owner hardware smoke; 0.14.27 still owes it. A repack of the same version does not remove that debt — the new dmg still has to be opened on a Mac.

Send the person: the two `DPSBuddy-<v>-mac-{arm64,x64}.dmg` files (Apple silicon vs Intel), the public notes (Gatekeeper + Keychain), and the smoke list. They run `scripts/macos-app.mjs` or drag the dmg to Applications. They do not need the Windows checkout.

## How — one shell, two control planes

The renderer never reads `process.platform`. Menus, quit, and shortcuts live in the shell. The 0.14.2 paste bug is the reference: `Menu.setApplicationMenu(null)` looked fine on Windows and killed **Cmd+V** on Mac (and right-click paste everywhere). A menu row is a two-platform change.

```mermaid
flowchart LR
  subgraph keys [User hands]
    WinKey["Windows: Ctrl + C / V / X / A"]
    MacKey["macOS: Cmd + C / V / X / A / Z / Q"]
    Click["Both: right-click Cut / Copy / Paste on editable fields"]
  end

  subgraph menu [edit-menu.cjs]
    WinMenu["Win: hidden Edit menu autoHideMenuBar — Alt shows it. Roles still exist."]
    MacMenu["Mac: App + Edit + Window menus required. No Edit roles → Cmd shortcuts do nothing."]
    Ctx["attachContextMenu — Electron has no native right-click by itself"]
  end

  subgraph life [lifecycle.cjs]
    WinQuit["Win: close window → exitApp → taskkill /T"]
    MacQuit["Mac: red button hides window, Dock stays. Cmd+Q is the only quit."]
  end

  WinKey --> WinMenu
  MacKey --> MacMenu
  Click --> Ctx
  WinMenu --> WinQuit
  MacMenu --> MacQuit
```

## Feature map — controls

These are what a human actually presses. Pack must not drop `edit-menu.cjs` / `lifecycle.cjs` from `app.asar`. Smoke the Windows column on this PC after NSIS/unpacked launch. Mac column is owed on a Mac; Docker cannot prove it.

| Feature | Windows | macOS | Code |
|---|---|---|---|
| Copy | **Ctrl+C** | **Cmd+C** | Edit role `copy` |
| Paste | **Ctrl+V** and **right-click → Paste** (onboarding key field must take both) | **Cmd+V** and **right-click → Paste** | `paste` role + `attachContextMenu` |
| Cut / select all | **Ctrl+X** / **Ctrl+A** | **Cmd+X** / **Cmd+A** | `cut` / `selectAll` |
| Undo | Ctrl+Z (Edit role) | **Cmd+Z** in composer | `undo` |
| Quit | Close the window (whole tree dies, including ffmpeg) | **Cmd+Q** only. Red button ≠ quit | `exitApp` vs `quit` role |
| Reopen | Relaunch the exe | Click Dock icon; Chat returns, no splash once host booted | `reopenTarget` |
| Menu bar | Hidden. **Alt** shows Edit. Never `setApplicationMenu(null)` | Always visible App + Edit + Window | `applicationMenuTemplate` |
| Secrets | Credential Manager `<productName>` / `wrap-key` | Keychain, first prompt **Always Allow** | `wrapKey` |
| userData | `%APPDATA%\DPSBuddy` | `~/Library/Application Support/DPSBuddy` | `applyProductPaths` |
| Updates | Check for updates → `latest.yml` | Panel says download the `.dmg`; Check disabled. No `latest-mac.yml` | `auto-update.cjs` |
| GPU | Hardware acceleration **off** | **on** | `main.cjs` |
| Install | NSIS `DPSBuddy Setup <v>.exe` | Drag `.dmg` to Applications; Gatekeeper Open Anyway | `package.json` `build` |

Windows smoke after a shell change: [windows/AGENTS.md](../../../apps/desktop/platform/windows/AGENTS.md) (Ctrl+V **and** right-click Paste, composer round-trip, close kills the tree). Mac smoke: [macos/AGENTS.md](../../../apps/desktop/platform/macos/AGENTS.md) (Cmd+V **and** right-click, Dock reopen, Cmd+Q).

## Checklist

```
- [ ] preflight
- [ ] rebase onto origin/main; bump; public notes; commit; push (if Kyo asked to ship)
- [ ] Windows worktree pack + doctor --desktop
- [ ] macOS Docker pack + verify-bundle in that log
- [ ] copy Windows artifacts into main dist; dry-run --require-mac
- [ ] desktop:release --require-mac (only when Kyo asked to ship)
- [ ] Mac hardware smoke on someone else's Mac (Gatekeeper, Keychain, Cmd+V, Dock, Cmd+Q, doctor --desktop). Not this PC. Until then Mac = preview.
- [ ] record in docs/internal; push
```

Both platforms unless Kyo says Windows-only. Mac stays labelled **preview**.

## 0. Preflight

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:PYTHON = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
$env:npm_config_python = $env:PYTHON
node .cursor/skills/pack-dpsbuddy/scripts/preflight.mjs
```

Use `npx pnpm@9.15.9` (corepack EPERM on this box).

## 1. Prep (source stays on agentforge)

1. `git fetch origin` and rebase the bump onto `origin/main`.
2. Ship list: the current `docs/internal/<version>-changelog.md`. Versions are semver: **`0.15.0` is the current cut** (published 2026-09-23); the next maintenance cut would be `0.15.1`. Do not use `0.14.3+`. The old "never `0.15` unless Kyo says so" rule is spent — he said so on 2026-09-23 and 0.15.0 shipped.
3. Bump only `apps/desktop/package.json` `version`.
4. Write `docs/public/<version>-notes.md`. Mac notes use **DPSBuddy** names, Gatekeeper, Keychain, **Cmd** shortcuts, manual updates.
5. Point `AGENTS.md` ship list at that patch.
6. Commit. Docker packs **HEAD**.

## 2. Windows env (worktree only)

```powershell
$v = (Get-Content apps/desktop/package.json | ConvertFrom-Json).version
$pack = "C:\Users\rizky\agentforge-pack-$v"
$sha = git rev-parse HEAD
git worktree add --detach $pack $sha
# copy gitignored media from this checkout into $pack\apps\desktop\resources\...
cd $pack
# PYTHON + npm_config_python + unset ELECTRON_RUN_AS_NODE (same as §0)
npx pnpm@9.15.9 install --frozen-lockfile
npx pnpm@9.15.9 desktop:build
```

**Windows feedback:** exe + blockmap + `latest.yml`; grep `host.cjs`; launch `dist\win-unpacked\DPSBuddy.exe`; `doctor.mjs --desktop` from **main** checkout (`transport: "ipc"`). If a shell/menu file changed: Ctrl+V **and** right-click Paste on the key field. NSIS `/S` hangs — [traps.md](traps.md).

## 3. macOS env (main checkout + Docker Linux only)

Stay in `C:\Users\rizky\agentforge`. Do not pin Windows Python.

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npx pnpm@9.15.9 desktop:build:mac:docker --arch all
```

Never `electron-builder --mac` on this host.

**macOS feedback:** per-arch `verify: all checks passed` for `.app` **and** `--dmg --zip`. Static only. Cmd+C/V and Dock reopen are **not** proven here.

## 4. Combine + release

Copy `DPSBuddy Setup <v>.exe`, `.blockmap`, and `latest.yml` from the **worktree** dist into main `apps/desktop/dist/`.

```powershell
npx pnpm@9.15.9 --filter @agentforge/desktop exec node scripts/release-desktop.mjs --require-mac --dry-run
npx pnpm@9.15.9 --filter @agentforge/desktop exec node scripts/release-desktop.mjs --require-mac
```

Never upload `latest-mac.yml`. Do not `git push` source to DPSBuddy.

## Do not

- Run `desktop:build` and `desktop:build:mac:docker` in the same cwd
- Teach the UI Ctrl vs Cmd in `apps/web` — shortcuts come from Electron **roles**
- `Menu.setApplicationMenu(null)`
- Copy Windows `taskkill` quit onto darwin
- Claim mac launched because Docker exited 0
- Treat Cua Fleet, Lume, or Docker Desktop as a Mac launch path on this PC
- Doctor `:3000` as the installer

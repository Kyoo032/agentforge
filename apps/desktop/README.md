# Agentforge desktop

Operator / agent only. Humans install from [GitHub Releases](https://github.com/Kyoo032/agentforge/releases), not this file.

Electron shell around the local Next UI. **Two modes:**

| Mode | Command / install | Loopback | Data |
|---|---|---|---|
| Local webdev | `pnpm dev` or `pnpm desktop:dev` | **:3000 only** | repo `data/` |
| Packaged app | NSIS / dmg / AppImage (see below) | **ephemeral port ≠ 3000** | Electron `userData` |

Packaged Electron never attaches to whatever is already on :3000. `pnpm desktop:dev` may reuse :3000 — that is the webdev window, not packaged proof.

There is no mobile Electron/Capacitor/RN target. See [`docs/mobile.md`](../../docs/mobile.md).

## userData (`app-url.txt`, SQLite, `settings.enc`)

`app.setName("Agentforge")` + `extraMetadata.name: "agentforge"`:

| OS | userData |
|---|---|
| Windows | `%APPDATA%\Agentforge` (legacy fallback `%APPDATA%\@agentforge\desktop`) |
| Linux | `$XDG_CONFIG_HOME/Agentforge` or `~/.config/Agentforge` |
| macOS | `~/Library/Application Support/Agentforge` |

Packaged launch writes `app-url.txt` there. Doctor `--desktop` reads that file and **fails** if the URL is `:3000`.

## Dev (webdev window)

From repo root:

```
pnpm install
pnpm desktop:dev
```

Electron opens a splash, then loads local webdev at `http://127.0.0.1:3000`. If `pnpm dev` is already serving, it reuses that process. Schema is created in-process on first SQLite open (`ensureSchema` / committed drizzle migrations). Paste a Toko Token gateway key in Settings. No login.

## Web-only (no Electron)

```
pnpm dev
```

Uses repo `data/agentforge.sqlite` and `data/.master-key` when no `AGENTFORGE_SECRETS_KEY` is set.

## Windows installer (the product)

```
pnpm desktop:build
```

Requires **Windows Developer Mode** (Settings > System > For developers > Developer Mode) or an elevated shell. Next standalone tracing recreates pnpm symlinks; `scripts/check-symlink.mjs` fails fast with those instructions if create fails.

Builds Next in standalone mode, copies that server plus the build-machine `node.exe` into `apps/desktop/resources/web` (gitignored), then packages Electron with electron-builder. Output: `apps/desktop/dist/` (NSIS installer, current user).

**Already built on this machine (2026-08-31):** `apps/desktop/dist/Agentforge Setup 0.1.0.exe` (~168 MB, unsigned). Smoke used staged `node.exe` on port **3011** (not 3000): `/chat` 200, `/api/v1/workspaces` created Home.

A fresh install does **not** need Node or pnpm on PATH. On first run:

1. Wrap key in Windows Credential Manager (`Agentforge` / `wrap-key`) via keytar.
2. SQLite, `settings.enc`, `logs/web.log`, and `app-url.txt` under Electron `userData` (`%APPDATA%\Agentforge`).
3. Child process: bundled `node.exe` running Next `server.js` on `127.0.0.1:<ephemeral>`. Schema is created when that process opens the database.

If Setup says **Agentforge cannot be closed**, the previous run is still in Task Manager (window X does not always kill the process). End **Agentforge** there, then Retry. Newer builds force-kill `Agentforge.exe` at install time.

Cloud Linux cannot run or rebuild that NSIS exe. Do not run `pnpm desktop:build` on Cloud (Windows NSIS path).

## macOS and Linux packages (operator builds on that OS)

Builder targets exist. Run them **on the OS you are packaging**. Unsigned is fine. Notarization is not done.

```
pnpm desktop:build:mac
pnpm desktop:build:linux
```

Package scripts (`desktop-build-mac`, `desktop-build-linux`, `desktop-build-linux-dir`) do **not** run `check-symlink.mjs` — that preflight is Windows Developer Mode only.

| Script | electron-builder | Artifacts |
|---|---|---|
| `pnpm desktop:build` | `--win nsis` | NSIS x64 (Windows product path; `check-symlink` first) |
| `pnpm desktop:build:mac` | `--mac` | dmg + zip, x64 + arm64, unsigned |
| `pnpm desktop:build:linux` | `--linux` | AppImage + deb, x64 |

`stage-web.mjs` copies `node.exe` on win32 and `node` otherwise into `resources/web`.

Doctor the packaged app with:

```
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop
```

Never commit `.env`, `data/settings.enc`, or `data/.master-key`.

## Move log

Desktop shell changes are recorded in [`docs/internal/moves.md`](../../docs/internal/moves.md).

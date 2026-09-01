# Agentforge desktop

Electron shell around the local Next UI. **Two modes:**

| Mode | Command / install | Loopback | Data |
|---|---|---|---|
| Webdev prototype | `pnpm dev` or `pnpm desktop:dev` | **:3000 only** | repo `data/` |
| Packaged app | NSIS / Start menu | **ephemeral port ≠ 3000** | `%APPDATA%\Agentforge` |

Packaged Electron never attaches to whatever is already on :3000.

## Dev (webdev window)

From repo root:

```
pnpm install
pnpm desktop:dev
```

Electron opens a splash, then loads the **prototype** at `http://127.0.0.1:3000`. If `pnpm dev` is already serving, it reuses that process. Schema is created in-process on first SQLite open (`ensureSchema` / committed drizzle migrations). Paste a Toko Token gateway key in Settings. No login.

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

Doctor the packaged app with:

```
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop
```

Never commit `.env`, `data/settings.enc`, or `data/.master-key`.

## Move log

Desktop shell changes are recorded in [`docs/moves.md`](../../docs/moves.md).

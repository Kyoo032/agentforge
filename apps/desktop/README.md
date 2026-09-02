# Agentforge desktop

Operator / agent only. Humans install from [GitHub Releases](https://github.com/Kyoo032/agentforge/releases), not this file.

Electron **is** the packaged product. The main process owns SQLite, secrets, and media. The renderer talks over IPC. There is **no** bundled Next.js child, **no** loopback HTTP server, and **no** `app-url.txt`.

| Mode | Command / install | Transport | Data |
|---|---|---|---|
| Local webdev | `pnpm dev` or `pnpm desktop:dev` | HTTP `127.0.0.1:3000` | repo `data/` |
| Packaged app | NSIS / dmg / AppImage | IPC (`window.agentforge`) | Electron `userData` |

`pnpm desktop:dev` loads webdev `:3000` **without** preload (fetch, not IPC). That is not packaged proof.

There is no mobile Electron/Capacitor/RN target. See [`docs/mobile.md`](../../docs/mobile.md).

## userData (`host-status.json`, SQLite, `settings.enc`)

`app.setName("Agentforge")` + `extraMetadata.name: "agentforge"`:

| OS | userData |
|---|---|
| Windows | `%APPDATA%\Agentforge` (legacy fallback `%APPDATA%\@agentforge\desktop`) |
| Linux | `$XDG_CONFIG_HOME/Agentforge` or `~/.config/Agentforge` |
| macOS | `~/Library/Application Support/Agentforge` |

Packaged launch writes `host-status.json` there (`transport: "ipc"`). Doctor `--desktop` reads that file and **fails** if it is missing. It does **not** GET `:3000`.

## Dev (webdev window)

From repo root:

```
pnpm install
pnpm dev          # Vite + Express on 127.0.0.1:3000
pnpm desktop:dev  # optional Electron frame around that URL
```

Schema is created in-process on first SQLite open (`ensureSchema` / committed drizzle migrations). Paste a Toko Token gateway key in Settings. No login.

## Windows installer (the product)

```
pnpm desktop:build
```

Builds the Vite renderer, esbuild-bundles `host.cjs` (externals: `better-sqlite3`, `keytar`), copies drizzle migrations, then packages Electron. Output: `apps/desktop/dist/` (NSIS, current user).

Native modules must be rebuilt for Electron’s Node **on Windows**:

```
cd apps/desktop
npx @electron/rebuild -f -w better-sqlite3 -w keytar
```

Do **not** run `pnpm desktop:build` or `@electron/rebuild` on Cloud Linux.

A fresh install does **not** need Node or pnpm on PATH. On first run:

1. Wrap key in Windows Credential Manager (`Agentforge` / `wrap-key`) via keytar.
2. SQLite, `settings.enc`, and `host-status.json` under Electron `userData`.
3. If no gateway key is saved, onboarding (endpoint locked to Toko Token + API key, or “Use offline demo”).
4. Window close (`X`) exits `Agentforge.exe`. Threads and the saved key stay.

**Uninstall** kills `Agentforge.exe`, deletes `%APPDATA%\Agentforge`, and removes Credential Manager `Agentforge` / `wrap-key`. Reinstall shows onboarding again.

Doctor the packaged app with:

```
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop
```

Never commit `.env`, `data/settings.enc`, or `data/.master-key`.

## macOS and Linux packages (operator builds on that OS)

```
pnpm desktop:build:mac
pnpm desktop:build:linux
```

Unsigned is fine. Notarization is not done.

## Move log

Desktop shell changes are recorded in [`docs/internal/moves.md`](../../docs/internal/moves.md).

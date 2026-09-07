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

`app.setName(productName)` + flavor `brand.json` (`userData` is `%APPDATA%\<productName>`). Git tracks **Agentforge** only (`%APPDATA%\Agentforge`, legacy `%APPDATA%\@agentforge\desktop`). Other Windows flavors are local/gitignored.

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
# default public flavor: AGENTFORGE_BRAND=agentforge pnpm --filter @agentforge/desktop desktop-pack
```

Builds the Vite renderer, esbuild-bundles `host.cjs` (externals: `better-sqlite3`, `keytar`), copies drizzle migrations, then packages Electron. Output: `apps/desktop/dist/` (NSIS, current user). Git has `branding/agentforge/` (Toko Token, `appId` `com.tokotoken.agentforge`). Extra local flavors under `branding/` are gitignored and must not be committed or uploaded.

In-app rail name and logo come from extraResources `brand/brand.json` + `brand/logo.png` via preload (`window.agentforge.brand`). Changing splash/exe names alone is not enough.

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

Window close (`X`) calls `app.exit(0)` so `Agentforge.exe` and Chromium helpers die. Threads and the saved key stay.

Running `Agentforge Setup *.exe` again **replaces** the existing install: it taskkills `Agentforge.exe`, overwrites the app files, and keeps `%APPDATA%\Agentforge`. Uninstall (not upgrade) kills the process, deletes that folder, and removes Credential Manager `Agentforge` / `wrap-key`. Reinstall after uninstall shows onboarding again.

Doctor the packaged app with:

```
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop
```

Never commit `.env`, `data/settings.enc`, or `data/.master-key`.

## In-app updates (Agentforge only)

Packaged Agentforge checks [GitHub Releases](https://github.com/Kyoo032/agentforge/releases) from Settings → **Check for updates**. If a newer version is out, **Update and restart** downloads it and relaunches. Kemenkeu / Metranet builds do not get this button.

`electron-builder` writes `latest.yml` next to the Setup exe when the Agentforge flavor is packed. A GitHub release must include the exe, `latest.yml`, and the nsis blockmap — not just the Setup file. Do not attach flavor exes to the public repo.

## macOS and Linux packages (operator builds on that OS)

```
pnpm desktop:build:mac
pnpm desktop:build:mac:dir
pnpm desktop:mac
pnpm desktop:build:linux
```

`desktop:build:mac:dir` writes an unpacked `.app` (same idea as `win-unpacked`). `pnpm desktop:mac` launches it with CDP `9222`. Both require **macOS**. This Windows checkout cannot run Apple’s Simulator or a `.app` — use WinApp F5 here. iOS Simulator / Expo stay parked.

Unsigned is fine. Notarization is not done.

## Move log

Desktop shell changes are recorded in [`docs/internal/moves.md`](../../docs/internal/moves.md).

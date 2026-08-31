# Agentforge desktop

Electron shell. The product UI is still the Next.js app on **127.0.0.1:3000**. The main process starts Next when the port is empty, injects the wrap key, and points SQLite at the OS user-data dir.

## Dev (one window)

From repo root:

```
pnpm install
pnpm db:push
pnpm desktop:dev
```

Electron opens a splash, waits for loopback `:3000`, then loads Chat. On first launch when Electron spawns Next, it runs `drizzle-kit push` against the OS user-data dir so SQLite tables exist. Paste a Toko Token gateway key in Settings. No login.

If port 3000 is already serving (e.g. `pnpm dev` in another terminal), Electron reuses it and does not spawn a second Next process.

## Web-only dev (no Electron)

```
pnpm dev
```

Uses repo `data/agentforge.sqlite` and `data/.master-key` when no `AGENTFORGE_SECRETS_KEY` is set.

## Windows installer (prototype)

```
pnpm desktop:build
```

Builds Next (`apps/web`) then packages Electron with electron-builder. Output: `apps/desktop/dist/` (NSIS installer, current user).

**Prototype limits:** the installer ships the Electron shell + splash, not a bundled Node runtime or embedded monorepo. First run still expects Node 20 + pnpm on PATH and a built web app if you launch from an installed copy outside a dev checkout. A self-contained bundle is a later pass.

On first run (when spawn works):

1. Wrap key in Windows Credential Manager (`Agentforge` / `wrap-key`) via keytar — same names as the old Tauri shell.
2. SQLite and `settings.enc` under Electron `userData`.
3. Child process: `pnpm --filter @agentforge/web start` (packaged) or `dev` (desktop:dev).

Never commit `.env`, `data/settings.enc`, or `data/.master-key`.

## Move log

Desktop shell changes are recorded in [`docs/moves.md`](../../docs/moves.md).

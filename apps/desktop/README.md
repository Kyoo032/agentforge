# Agentforge desktop

Tauri 2 shell. The product UI is still the Next.js app. This window loads **only** `http://127.0.0.1:3000`.

## Dev

From repo root (Next + window):

```
pnpm install
pnpm db:push
pnpm desktop:dev
```

Paste a Toko Token gateway key in Settings. Chat is ready. No login.

## Windows installer

```
pnpm desktop:build
```

Produces an NSIS installer (`apps/desktop/src-tauri/target/release/bundle/nsis/`). First run:

1. Install (current user).
2. The app stores the wrap key in Windows Credential Manager (`Agentforge` / `wrap-key`) and sets `AGENTFORGE_SECRETS_KEY` for the local Next process.
3. SQLite lives in the OS app-data dir.
4. If port 3000 is empty, the shell runs `pnpm --filter @agentforge/web start` (Node 20 + pnpm on PATH for this prototype). Then paste the gateway key in Settings.

Never commit `.env`, `data/settings.enc`, or `data/.master-key`.

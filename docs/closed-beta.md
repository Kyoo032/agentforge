# Closed beta checklist

For invited testers. Primary surface: **Chrome** at `http://127.0.0.1:3000` (`pnpm dev`), or the packaged Windows installer when you have it.

## Before you start

1. From the repo root: `npx pnpm@9.15.9 install` then `npx pnpm@9.15.9 dev`
2. Open Chrome (not Cursor’s IDE browser — the Next overlay can steal clicks) at `http://127.0.0.1:3000/chat`
3. Paste your Toko Token gateway key in **Settings** when you want live models

Stub mode (no key) still exercises Chat, threads, and most UI offline.

## What to try

- **Chat** — send a message, switch models, open a second thread
- **Settings** — save gateway key, confirm the UI does not echo the raw key back
- **Documents / Research / Images / Videos / Presentation** — one happy-path generate each (live key required for media)
- **Workspaces** — create a desk, switch tabs, return to Home

## Notes

- First visit to a route in webdev can be cold (Next compile). Click through once before a timed walkthrough.
- Packaged Electron uses a different loopback port and its own data dir — do not treat `pnpm desktop:dev` on `:3000` as installer proof. See [`apps/desktop/README.md`](../apps/desktop/README.md).
- There is no mobile app. A phone on the LAN cannot reach Chat by design — [`docs/mobile.md`](mobile.md).

## Secrets

Never paste a production gateway key into a shared Cloud VM, a PR comment, or git. Keep keys on the machine you own.

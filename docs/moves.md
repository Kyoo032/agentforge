# Moves

Chronological log of significant moves: what changed, from where, to where, and why. Append new entries at the top.

## 2026-08-31 — Demo surface is Chrome + `pnpm dev`; desktop shell parked

- **What:** The demo/presentation surface for the product.
- **From:** Desktop shell window (Electron on the Windows working tree; `apps/desktop` in this repo still carries the Tauri prototype).
- **To:** Chrome at `http://127.0.0.1:3000` served by `pnpm dev`. Runbook: [docs/demo.md](demo.md).
- **Why:** The desktop shell had click-death issues (Next dev error overlay + GPU/sandbox input quirks on Windows). Chrome bypasses the shell problem entirely and is the surface the web app is actually built for. The desktop shell stays in the repo, parked — not deleted.
- **Rode along:** Settings Extras now renders its inner fields (provider keys, tool toggles, model/backend selects) only when the `<details>` is open, so a closed Settings page no longer mounts hundreds of hidden nodes. `AppShell` split: the shell chrome is a server component again; only `AppRail` and a tiny `ModeRedirect` stay client.

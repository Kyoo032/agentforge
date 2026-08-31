# Agentforge move log

Append-only record of relocations: commands, packages, product identity, data paths. Agents add a dated entry when something moves so the next session is not guessing.

Format:

```markdown
## YYYY-MM-DD — short title

- **What:** …
- **From:** …
- **To:** …
- **Why:** …
```

---

## 2026-08-31 — Desktop shell: Tauri → Electron

- **What:** Desktop window and local server ownership
- **From:** `apps/desktop/src-tauri/` (Tauri 2 + Rust). Dev: `beforeDevCommand` starts Next; prod: Rust spawns `pnpm --filter @agentforge/web start`, wrap key via `keyring` crate (`Agentforge` / `wrap-key`), data in Tauri app-data dir.
- **To:** `apps/desktop/main.cjs` (Electron main process). Same loopback URL `http://127.0.0.1:3000`. Wrap key via `keytar` (same service/account names). Data in `app.getPath('userData')`. Electron spawns Next if port 3000 is closed; kills child on quit.
- **Why:** Product decision to standardize on Electron. Next.js UI, SQLite, and verify recipes unchanged.
- **Commands unchanged:** root `pnpm desktop:dev` → `@agentforge/desktop desktop-dev`; `pnpm desktop:build` → `desktop-build`.
- **Installer:** electron-builder NSIS (current user), replaces Tauri NSIS output path.
- **Not in this move:** bundled Node in installer; full verify map for Documents/Research; eval harness.
- **Follow-up in same pass:** Electron runs `drizzle-kit push --force` against `userData` before spawning Next when it owns the server (fresh OS data dir has no tables otherwise).

## 2026-08-31 — Demo surface is Chrome + `pnpm dev`; desktop shell parked

- **What:** The demo/presentation surface for the product.
- **From:** Desktop shell window (Electron on the Windows working tree; `apps/desktop` in this repo still carries the Tauri prototype at the time of this entry).
- **To:** Chrome at `http://127.0.0.1:3000` served by `pnpm dev`. Runbook: [docs/demo.md](demo.md).
- **Why:** The desktop shell had click-death issues (Next dev error overlay + GPU/sandbox input quirks on Windows). Chrome bypasses the shell problem entirely and is the surface the web app is actually built for. The desktop shell stays in the repo — now Electron, not deleted.
- **Rode along:** Settings Extras now renders its inner fields (provider keys, tool toggles, model/backend selects) only when the `<details>` is open, so a closed Settings page no longer mounts hundreds of hidden nodes. `AppShell` split: the shell chrome is a server component again; only `AppRail` and a tiny `ModeRedirect` stay client.

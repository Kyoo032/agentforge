# Agentforge

A **local** agents workbench for the **Toko Token** OpenAI-compatible gateway at `https://api.tokotokenai.com/v1`. Same idea as Hermes: the person who installs it owns it. You are not signing up for a campus tenant. You paste a **gateway API key**, keep **workspaces** on disk, and get chat plus agents that are easy to use and easy to build.

This file is the project source of truth for coding agents. Vault memory at `C:\Users\rizky\Documents\Obsidian` is for Kyo, not for this repo’s domain rules.

Product modes (Chat / Agents / Images / Videos / Presentation): see [`docs/product-modes.md`](docs/product-modes.md).

## Product (locked 2026-08-26)

- **Gateway-first.** Agentforge exists because the gateway has no easy agents app. Chat, model picker, and custom agents run on `api.tokotokenai.com/v1` by default. Native Anthropic / Google / Ark and a different base URL are optional extras, not the product identity.
- **No login.** No email, no Better Auth in the product UX, no “join Harbor State.”
- **Single owner on the machine.** Data lives on disk. Everyone who installs it has their own copy.
- **First-run needs:** a gateway API key (and later optional local models such as Ollama). Store keys in the OS keychain / a local secrets file, never in the renderer, never in git, never in `NEXT_PUBLIC_*`.
- **Workspaces** are the user’s own projects (groups of agents, threads, tools) — not an org membership table they must join.
- Chat is ready immediately after a gateway key is saved. Model picker + composer. Building custom agents is optional, not a gate.
- Pack templates (Students first; more later) are optional starters on Build. Default chat never uses a pack template.
- University/Harbor State is an **optional pack of templates**, not the identity of the app. Kernel stays industry-neutral (`student` / `course` do not belong in core schema).
- Do not merge **Toko Token** with **TokenKu** in copy or catalogs.

### Desktop target

Installer (Tauri preferred, Electron acceptable) + **SQLite** in the user data dir. No Docker Postgres for the product. Optional later: on-prem campus server. Do not wrap the current Docker stack in a Chromium window and call it local.

### What to keep from this repo

Agent versions, tool bindings, modality-fail-closed run APIs, chat composer, studio/build flow, pack-based templates. OpenAI-compatible wire (`/v1/chat/completions` + `/v1/responses`) against the gateway.

### What to remove from the product (later)

Harbor State seed as identity leftovers, Docker Postgres (SQLite next), desktop shell. Better Auth is deleted, not upgraded.

## Non-negotiables

- Kernel schema, APIs, and packages must not use `student`, `course`, or campus nouns. Those live in `packages/university` (optional pack).
- Modalities are fail-closed: wrong content type on `/runs/text|image|video` is **400**, never silently dropped. `text` is always on; image/video are optional per agent and per model.
- Never commit `.env`, API keys, or passwords.
- Do not commit or push unless Kyo asks.
- Do not reintroduce login “for later multiplayer” unless Kyo asks. This is a personal local app.
- Local process only: bind `127.0.0.1`. Mutating `/api` accepts localhost Origin only. No email/session package.

## Layout (today’s prototype)

```
apps/web                 Next.js 15 App Router (local owner, no product login)
packages/core            Content parsers, tools, AgentRuntime, AgentService
packages/db              Drizzle schema (Postgres today; SQLite is the product target)
packages/university      Optional templates and mock campus tools
```

pnpm 9.15.9 + Turborepo. If corepack hits EPERM on Windows, use `npx pnpm@9.15.9`.

## How to run (prototype, until local desktop ships)

```
docker compose up -d
npx pnpm@9.15.9 install
npx pnpm@9.15.9 db:push
npx pnpm@9.15.9 db:seed          # optional; first visit also creates the local owner
npx pnpm@9.15.9 dev               # http://localhost:3000 → /chat, no login
```

No account. Workspaces and agents are local. Paste the gateway key in Settings. `AGENTFORGE_RUNTIME=stub` until a key is saved (then live models from the gateway). Env `AGENTFORGE_RUNTIME=ai` still uses `.env` keys.

## Runtime and tools

- `createRuntime()` selects stub vs Vercel AI SDK. Live chat uses the gateway base URL unless the owner pasted a different one.
- Tools: `defineTool` + registry + bindings. Platform: `calculator`, `datetime`, `web_search`, `image_generate`, `video_generate`. Packs add more.
- Gateway key runs chat **and** image/video generation (`POST /v1/images/generations`, `POST /v1/video/generations` + poll). Search still needs Tavily/Brave. FAL is optional BYOK.
- New industry = new pack package, not kernel tables.

## Secrets and prompt security

The user pastes their gateway key into settings. The host process holds it. Runs use it. The UI never gets the raw key back after save. Optional extras: native Google / Anthropic / Ark, plus dedicated tool keys.

- Keys live in an AES-256-GCM secrets file (`data/settings.enc`), wrapped by `AGENTFORGE_SECRETS_KEY` or a gitignored `data/.master-key`. Desktop OS keychain comes with the installer.
- Remote inference URLs must be HTTPS. `http://` is only for loopback (Ollama).
- Agentforge does not log prompts. Message bodies, system prompts, and tool I/O are encrypted at rest. Gateway retention is Toko Token’s policy, not ours.
- OpenRouter’s `provider.zdr: true` is sent only when the saved URL is OpenRouter. Do not send that field to Toko Token.
- Wallet / usage / key-admin on the gateway stay parked until this privacy pass is solid.
- Never commit `.env`, `data/settings.enc`, `data/.master-key`, or API keys.

## Tests

- Unit: Vitest in `packages/core`, `packages/university`, `apps/web`. Local coding agents run these. Do **not** run Playwright locally — `foundation.spec.ts` is a long serial pass (cold Next compile + stub chat + studio).
- E2E: Playwright `apps/web/tests/e2e/foundation.spec.ts` (Chat → Settings → Agents/Build → Images/Videos/Presentation smoke). Owned by **Cursor Cloud Agents**, not the local Windows session. See **Cursor Cloud specific instructions** below.
- Verify UI in the IDE browser when changing layout. Do not block on `pnpm test:e2e` on this machine.

## Cursor Cloud specific instructions

Cloud clones GitHub. Push the branch first; uncommitted local files are not on the VM. Launch from the Cursor **Cloud** agent dropdown, or `/in-cloud` from a local chat.

Boot uses [`.cursor/environment.json`](.cursor/environment.json): `install` → `scripts/cloud-install.sh` (pnpm 9.15.9, Playwright Chromium, **native PostgreSQL 16**). `start` → `scripts/cloud-start.sh` (`pg_ctlcluster 16 main start`, role/db `agentforge`, `pnpm db:push`). Stub runtime only — no gateway key.

This image has **no Docker**. `docker`, `dockerd`, and `sudo service docker start` fail (`docker: unrecognized service`). Do not run `docker compose`. Apt postinst often cannot start Postgres (`policy-rc.d`); `start` must call `pg_ctlcluster`. Default DB: `postgres://agentforge:agentforge@127.0.0.1:5432/agentforge`.

### What a Cloud Agent on this VM can do

- Node 22 + pnpm 9.15.9 (corepack). Workspace `node_modules` after `install`.
- Install/start native PostgreSQL 16 via apt + `pg_ctlcluster` (not Docker Compose).
- Run the stub Playwright suite against `http://127.0.0.1:3000` (`pnpm test:e2e` from repo root also works). Playwright `webServer` starts `pnpm dev` if needed. Do not use a LAN IP.

```
cd apps/web
AGENTFORGE_RUNTIME=stub npx playwright test
```
- Run Vitest unit tests (`pnpm test` / package `vitest run`).
- Browser / computer-use against the local app when those tools are available. Bind is `127.0.0.1:3000`.
- Read GitHub with `gh` (PRs, Actions logs). Do not use `gh` to create PRs — use the Cursor PR tool.
- Edit the repo, commit, push the `cursor/…-e498` branch, open a draft PR.

Proven 2026-08-28 on this Cloud image: `foundation.spec.ts` passed in 29.5s after native Postgres + `pnpm db:push` (`AGENTFORGE_RUNTIME=stub`).

### What a Cloud Agent on this VM cannot do

- Docker Postgres / `docker compose` (not installed).
- Live Toko Token / gateway inference. There is no gateway key. Keep `AGENTFORGE_RUNTIME=stub`. Do not paste keys into the VM or commit `.env`.
- Product login, email, or session. There is none.
- See the operator’s unpushed Windows working tree.
- Merge PRs or enable auto-merge unless Kyo asks.

### GitHub Actions

`.github/workflows/e2e.yml` is **parked** (`echo ok`) after GHA job-startup failures. It does **not** run Playwright. Do not restore the full GHA Playwright job until Cloud `start` (native Postgres) is the default for new agents. Cloud Agents own the real e2e gate.

## Known traps (prototype)

- Next.js overlay in Cursor’s browser can inject `data-cursor-ref` and block clicks. Use Chrome or Playwright.
- Playwright `/studio/**` also matches `/studio/new`. Wait for `/studio/<uuid>`.
- Dev server binds `127.0.0.1`. Playwright and the browser must use `http://127.0.0.1:3000` (not a LAN IP).

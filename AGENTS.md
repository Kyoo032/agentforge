# Agentforge

A **local** Toko Token client at `https://api.tokotokenai.com/v1`. The person who installs it owns it. You paste a **gateway API key**, keep **workspaces** on disk, and work in Chat plus job modes (Documents, Research, Images, Videos, Presentation). Custom-agent Build is parked — not the product identity. Hermes remains the tinkering surface for people who want to build agents.

**Status: closed beta** (not prototype). Public entry point: [`README.md`](README.md).

This file is the project source of truth for coding agents. Vault memory at `C:\Users\rizky\Documents\Obsidian` is for Kyo, not for this repo’s domain rules.

**Harness, not product.** PStack (`how` / `why` mapper, `create-verification-skill` / `maintain-verification-skill` verifier) and `.cursor/skills/verify-agentforge` are agent guardrails, like this file. They are not Agentforge features. Call the original pstack plugin skills from the project verify skill. Do not vendor pstack into `apps/`, `packages/`, the installer, or the UI. Task models stay Cursor explore/worker, not pstack Fable/GPT slugs.

Product modes (Chat / Documents / Research / Images / Videos / Presentation): see [`docs/product-modes.md`](docs/product-modes.md). The left rail follows **workspace** `productModes`. Home has every work tab. Packs are workspace presets, not a custom-agent builder.

## Product (locked 2026-09-02 GTM; closed beta)

- **Gateway-first.** Agentforge exists because buying a key at `api.tokotokenai.com` leaves the question “where do I use this?” Install, paste the key, work. Native Anthropic / Google / Ark stay in the settings store, unexposed.
- **No login.** No email, no Better Auth in the product UX, no “join Harbor State.”
- **Single owner on the machine.** Data lives on disk. Everyone who installs it has their own copy.
- **First-run needs:** a gateway API key (and later optional local models such as Ollama). Store keys in the OS keychain / a local secrets file, never in the renderer, never in git, never in `NEXT_PUBLIC_*`.
- **Workspaces** are the user’s own desks (which tabs they need) — not an org membership table they must join. Home already has every work mode. Creating another desk (Legal, Marketing, Students, or custom checkboxes) is optional.
- Chat is ready immediately. Model picker + composer. Building custom agents is parked, not a gate.
- Pack templates are optional workspace presets. Default Chat never uses a pack template.
- University/Harbor State is an **optional pack of templates**, not the identity of the app. Kernel stays industry-neutral (`student` / `course` do not belong in core schema).
- Do not merge **Toko Token** with **TokenKu** in copy or catalogs.
- Custom agents / Studio stay in the tree and redirect to Chat. Do not add a GTM “hidden Build” door.

### Desktop target

Installer (**Electron**) + **SQLite** in the user data dir. No Docker Postgres. Optional later: on-prem campus server.

### What to keep from this repo

Chat composer, job-mode studios, workspace templates, modality-fail-closed run APIs, OpenAI-compatible wire (`/v1/chat/completions` + `/v1/responses`) against the gateway. Agent tables and Studio files stay for a later “show Build again” pass — they are not GTM surfaces.

### What to remove from the product (later)

Harbor State seed as identity leftovers. Better Auth is deleted, not upgraded. Public rename / UI redesign / customer-only ship is parked until closed beta feedback lands.

## Non-negotiables

- Kernel schema, APIs, and packages must not use `student`, `course`, or campus nouns. Those live in `packages/university` (optional pack).
- Modalities are fail-closed: wrong content type on `/runs/text|image|video` is **400**, never silently dropped. `text` is always on; image/video are optional per agent and per model.
- Never commit `.env`, API keys, or passwords.
- Do not commit or push unless Kyo asks.
- Do not reintroduce login “for later multiplayer” unless Kyo asks. This is a personal local app.
- Local process only. Local webdev binds `127.0.0.1:3000`. Packaged Electron has **no HTTP server** — the renderer talks to the host over IPC (`window.agentforge`). Mutating `/api` on webdev accepts localhost Origin only. No email/session package.

## Layout

```
apps/web                 Vite + React Router renderer; Express on :3000 for webdev (local owner, no product login)
apps/desktop             Electron shell + Windows installer (packaged: IPC host, no loopback HTTP)
packages/host            Local API dispatch (webdev HTTP adapter + Electron IPC)
packages/core            Content parsers, tools, AgentRuntime, AgentService
packages/db              Drizzle schema (SQLite in the user data dir)
packages/university      Optional Students templates and mock campus tools
packages/marketing       Optional Marketing templates
packages/legal           Optional Legal templates
docs/                    Product docs + docs/internal engineering notes
```

pnpm 9.15.9 + Turborepo. If corepack hits EPERM on Windows, use `npx pnpm@9.15.9`.

## How to run

```
npx pnpm@9.15.9 install
npx pnpm@9.15.9 db:seed          # optional; first visit also creates the local owner
npx pnpm@9.15.9 dev               # http://127.0.0.1:3000 → /chat, no login
```

Optional: `npx pnpm@9.15.9 db:push` (`drizzle-kit push` escape hatch). Canonical path is `drizzle-kit generate` in `packages/db` + app-side migrate on SQLite open.

SQLite file: `data/agentforge.sqlite` (or `AGENTFORGE_DATA_DIR`). Do **not** set `DATABASE_URL` to Postgres.

Desktop:

- **Webdev window:** `pnpm desktop:dev` — Electron around local Vite/Express on `:3000` (no preload / no IPC). Not the installed product.
- **Packaged app:** `pnpm desktop:build` → NSIS x64 (Windows product path). Stages the Vite renderer + esbuild `host.cjs` (no Next, no bundled `node.exe`, no loopback port). Native modules (`better-sqlite3`, `keytar`) need `@electron/rebuild` **on Windows** — do not run that on Cloud. On launch the main process loads the renderer from `extraResources` and dispatches APIs over IPC. Writes `host-status.json` under Electron userData. Window close exits the whole process tree. Running setup.exe again replaces the existing install and keeps `%APPDATA%\Agentforge`. Uninstall (not upgrade) kills `Agentforge.exe`, deletes `%APPDATA%\Agentforge`, and removes Credential Manager `Agentforge` / `wrap-key`. mac/linux: `pnpm desktop:build:mac` / `pnpm desktop:build:linux` on that OS (unsigned; notarization is not done). Cloud cannot prove packaged Windows and must not run `pnpm desktop:build`. Move log: [`docs/internal/moves.md`](docs/internal/moves.md).

**Packaged Windows installer exists** (rebuild on Windows after the IPC host rewrite). Cloud Linux must not run `pnpm desktop:build`.

- Artifact: `apps/desktop/dist/Agentforge Setup 0.1.0.exe` (gitignored). Rebuild on Windows after this IPC host rewrite — do not treat the 2026-08-31 Next-child exe as current.
- Packaged proof is an Electron window + `doctor.mjs --desktop` reading `host-status.json` (`transport: "ipc"`). There is no `app-url.txt` and no child `node.exe`.

No account. Workspaces are local. Paste the gateway key in Settings. `AGENTFORGE_RUNTIME=stub` until a key is saved (then live models from the gateway). Env `AGENTFORGE_RUNTIME=ai` still uses `.env` keys.

## Runtime and tools

- `createRuntime()` selects stub vs Vercel AI SDK. Live chat uses the gateway base URL unless the owner pasted a different one.
- Tools: `defineTool` + registry + bindings. Platform: `calculator`, `datetime`, `web_search`, `image_generate`, `video_generate`. Packs add more.
- Gateway key runs chat **and** image/video generation (`POST /v1/images/generations`, `POST /v1/video/generations` + poll). Search still needs Tavily/Brave. FAL is optional BYOK.
- New industry = new pack package, not kernel tables.

## Secrets and prompt security

The user pastes their gateway key into settings. The host process holds it. Runs use it. The UI never gets the raw key back after save (`hasOpenai` only). Optional extras: native Google / Anthropic / Ark, plus dedicated tool keys (Tavily/Brave/FAL) in Settings Extras.

Do not use Hermes tools or Hermes dashboard tokens to process Agentforge keys.

- **Gateway key** → `settings.enc` (AES-256-GCM).
- **Wrap key** → Electron keytar `Agentforge` / `wrap-key` (injected as `AGENTFORGE_SECRETS_KEY`), or webdev `data/.master-key` / env. Never in the renderer, never in git, never in `NEXT_PUBLIC_*`.
- Remote inference URLs must be HTTPS. `http://` is only for loopback (Ollama).
- Agentforge does not log prompts. Message bodies, system prompts, and tool I/O are encrypted at rest. Gateway retention is Toko Token’s policy, not ours.
- OpenRouter’s `provider.zdr: true` is sent only when the saved URL is OpenRouter. Do not send that field to Toko Token.
- Wallet / usage / key-admin on the gateway stay parked until this privacy pass is solid.
- Never commit `.env`, `data/settings.enc`, `data/.master-key`, or API keys.

## Tests

- Unit: Vitest in `packages/core`, `packages/university`, `apps/web`. Local coding agents run these. Do **not** run Playwright locally — `foundation.spec.ts` is a long serial pass (cold Next compile + stub chat + workspaces).
- E2E: Playwright `apps/web/tests/e2e/foundation.spec.ts` (Chat → Settings → job modes → Legal workspace smoke). Owned by **Cursor Cloud Agents**, not the local Windows session. See **Cursor Cloud specific instructions** below.
- Verify UI in the IDE browser when changing layout. Do not block on `pnpm test:e2e` on this machine.

## Cursor Cloud specific instructions

Cloud clones GitHub. Push the branch first; uncommitted local files are not on the VM. Launch from the Cursor **Cloud** agent dropdown, or `/in-cloud` from a local chat.

Boot uses [`.cursor/environment.json`](.cursor/environment.json): `install` → `scripts/cloud-install.sh` (pnpm 9.15.9, Playwright Chromium). `start` → `scripts/cloud-start.sh` (prepares the data dir only; Next creates schema on first open). Stub runtime only — no gateway key.

This image has **no Docker**. `docker`, `dockerd`, and `sudo service docker start` fail (`docker: unrecognized service`). Do not run `docker compose`. Product DB is SQLite. Default file: `data/agentforge.sqlite`.

The Windows closed-beta checkout also uses SQLite (`ensureSchema` migrates on open; `pnpm db:push` is optional). Desktop Electron injects the wrap key from the OS keychain. Packaged uses IPC in-process — no loopback HTTP server.

### What a Cloud Agent on this VM can do

- Node 22 + pnpm 9.15.9 (corepack). Workspace `node_modules` after `install`.
- SQLite via Next/`ensureSchema` on open (not Docker Compose, not required Postgres). `pnpm db:push` is optional.
- Run the stub Playwright suite against `http://127.0.0.1:3000` (`pnpm test:e2e` from repo root also works). That is **webdev**, not the packaged app. Playwright `webServer` starts `pnpm dev` if needed. Do not use a LAN IP.

```
cd apps/web
AGENTFORGE_RUNTIME=stub npx playwright test
```

- Run Vitest unit tests (`pnpm test` / package `vitest run`).
- Browser / computer-use against the local **webdev** app when those tools are available. Bind is `127.0.0.1:3000`. Packaged desktop is not on this VM.
- Read GitHub with `gh` (PRs, Actions logs). Do not use `gh` to create PRs — use the Cursor PR tool.

### What a Cloud Agent on this VM cannot do

- Docker Postgres / `docker compose` (not installed).
- Live Toko Token / gateway inference. There is no gateway key. Keep `AGENTFORGE_RUNTIME=stub`. Do not paste keys into the VM or commit `.env`.
- Product login, email, or session. There is none.
- See the operator’s unpushed Windows working tree.
- Merge PRs or enable auto-merge unless Kyo asks.

GitHub Actions (`.github/workflows/e2e.yml`) runs the same stub Playwright suite on push/PR to `main`. No gateway key. Cloud Agents also own that suite on this VM. Do not park the GHA job.

## Known traps

- Cursor’s browser can inject `data-cursor-ref` and block clicks. Use Chrome or Playwright.
- Playwright `/studio/**` redirects to Chat (Build is parked).
- Dev server binds `127.0.0.1:3000` (webdev only: Vite + Express + `@agentforge/host`). Playwright and the IDE browser must use `http://127.0.0.1:3000` (not a LAN IP). Packaged Agentforge has no HTTP port; `doctor.mjs --desktop` reads Electron userData `host-status.json` (Windows `%APPDATA%\Agentforge`, Linux `$XDG_CONFIG_HOME/Agentforge` or `~/.config/Agentforge`, macOS `~/Library/Application Support/Agentforge`). A phone on a LAN `:3000` is not a product surface — see [`docs/mobile.md`](docs/mobile.md).

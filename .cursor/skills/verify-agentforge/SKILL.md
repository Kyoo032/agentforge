---
name: verify-agentforge
description: Drives Agentforge the way a user does — webdev Vite/Express on 127.0.0.1:3000, packaged Electron over IPC (no loopback HTTP), data-testid handles, stub runtime, SQLite in the data dir. Launch, doctor, walk Chat/Settings/Workspaces/Images/Videos, keep evidence. Use after UI or product-mode work, when refusing done from a compile, or before claiming a settings/chat/workspace change works.
---

# Verify Agentforge

Agent guardrail, same class as `AGENTS.md`. Not part of the Agentforge app.

- **Product** is `apps/`, `packages/`, the NSIS installer, Chat / Settings / Workspaces / job modes.
- **This directory** is how agents map and prove *this* repo (where to press, how to doctor, what counts as proof).
- Original pstack skills stay in the Cursor pstack plugin. Call them. Do not copy them into product code or the desktop bundle.
- **Map:** this `features/` map, then pstack `how` for how a subsystem works and where to fix.
- **Verify:** Launch / Doctor / Drive below (from pstack `create-verification-skill`). Map rot → pstack `/maintain-verification-skill` (edits only this directory).
- Keep Cursor explore/worker Task models. Do not adopt pstack Fable/GPT slugs.

A cold agent reads this mid-task. Drive the real app. A green `tsc` or worker summary is not proof.

**Surfaces.** Two products share UI code; they do **not** share a port.

| Surface | How to reach it | Doctor | Port |
|---|---|---|---|
| **Local webdev** | `pnpm dev` → Chrome / IDE browser | `node .cursor/skills/verify-agentforge/scripts/doctor.mjs` | **3000 only** (`tsx server.ts` → Express + Vite on `127.0.0.1:3000`) |
| **Packaged desktop** | Installed Agentforge, or local Kemenkeu AI / AIHub Metranet (Windows NSIS; mac/linux operator-built) | `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop` | **None.** IPC only. Status in userData `host-status.json` (Windows `%APPDATA%\Agentforge` or `%APPDATA%\Kemenkeu AI` / `%APPDATA%\AIHub Metranet`; Linux `$XDG_CONFIG_HOME/Agentforge` or `~/.config/Agentforge`; macOS `~/Library/Application Support/Agentforge`) |

`pnpm desktop:dev` is the local webdev inside an Electron window (may reuse :3000). That is not packaged proof. APIs exist under `/api/v1/*` but proof is the user path, not an internal setter.

Do **not** use Hermes CLI, Hermes dashboard session tokens, or Hermes `hermes:api`. Agentforge key handling is in **Keys** below.

**Who runs which harness**

| Machine | Harness | Do not |
|---|---|---|
| This Windows session | `cursor-ide-browser` + `scripts/doctor.mjs`; Electron for desktop changes | `pnpm test:e2e`, `playwright test` |
| Cursor Cloud + GHA | Playwright `apps/web/tests/e2e/foundation.spec.ts` | Paste a gateway key; start Docker |

Cloud and `.github/workflows/e2e.yml` own the serial stub smoke. Local coding agents do not run Playwright here (long serial pass). Cloud may use a secret gateway key for live Enhance / Finance / Data proof after doctor `ai`; GHA stays stub.

**Delegation.** Explore with Composer 2.5 (`explore` / `composer-2.5-fast`). Implementation workers are Grok 4.5 (`worker` / `cursor-grok-4.5-high`). Do not use pstack Fable/GPT Task slugs. Fan-out stays at 2.

Read [features/README.md](features/README.md) before driving. The map is the source of which entry points exist. Proving one convenient path is incomplete when the map lists others.

## Launch

Ready signal (webdev): `GET http://127.0.0.1:3000/chat` returns 200, or the turbo line `@agentforge/web:dev:` is serving. Bind is `127.0.0.1:3000` only. Drive `127.0.0.1`, not a LAN IP.

Ready signal (packaged desktop): Electron window on Chat (or onboarding if no key), and `doctor.mjs --desktop` exits 0 against `host-status.json` (`transport: "ipc"`). **Not** :3000. **Not** `app-url.txt`.

**If port 3000 already answers** — that is the **webdev** instance. Doctor that instance for Chat/Settings in the browser. Do not start a second `pnpm dev`. Do not call that the installed app.

**If nothing is listening** (fresh Cloud VM or a stopped local checkout):

```bash
# from repo root; Windows may need npx pnpm@9.15.9
unset DATABASE_URL
export AGENTFORGE_RUNTIME=stub
export AGENTFORGE_DATA_DIR="${AGENTFORGE_DATA_DIR:-$PWD/data}"
# optional; ensureSchema migrates on SQLite open
# pnpm db:push
pnpm dev
```

SQLite file: `$AGENTFORGE_DATA_DIR/agentforge.sqlite` (default `data/agentforge.sqlite`). First visit creates the local owner. Optional `pnpm db:seed` is not required for Chat.

**Cloud boot** already runs `scripts/cloud-start.sh` (data-dir prep only: `mkdir data`, unset `DATABASE_URL`). Then `pnpm dev`. Playwright `webServer` in `apps/web/playwright.config.ts` starts `pnpm dev` with `AGENTFORGE_RUNTIME=stub` and `AGENTFORGE_DATA_DIR` resolved to repo `data/`. `reuseExistingServer` is on unless `CI`.

**Stub vs live.** `AGENTFORGE_RUNTIME=stub` until a gateway (or other provider) key is saved. A saved key makes `GET /api/v1/settings` report `runtime: "ai"`. GHA stays stub with no key. Cursor Cloud may have a secret `OPENAI_API_KEY` for live loop proof — doctor `runtime: "ai"` and `hasOpenai: true` before a live send; if the env is missing, stay stub. This Windows machine may already be live — doctor first. Never echo the key.

**Teardown.** Only if this run started `pnpm dev`: stop that PID (Ctrl+C / kill the shell job). Never `taskkill` by image name. Never stop a server you did not start.

## Doctor

Run this first whenever anything looks off, and before every drive:

```bash
# local webdev
node .cursor/skills/verify-agentforge/scripts/doctor.mjs

# packaged desktop (reads OS userData host-status.json — not :3000, not HTTP)
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop
```

It is read-only. Default GETs `/chat`, `/api/v1/settings`, `/api/v1/models`, and `GET /api/v1/edit/doctor` on `http://127.0.0.1:3000`. `--desktop` reads `host-status.json` (IPC; no HTTP). Override webdev with `AGENTFORGE_VERIFY_URL` (still must be loopback). Exit `0` prints JSON. Webdev: `url`, `surface`, `chatStatus`, `runtime`, `hasOpenai`, `keyFingerprint`, `modeKeys`, `chatCount`, `curation`, `knowledge`, `gatewayName`, `dataDir`, `edit` (`ffmpeg` / `asr`, or `{ available: false }` when the endpoint is missing). Desktop: `url: "ipc"`, `transport: "ipc"`, `pid`, `dataDir`, `productName`, `gatewayName`, `gatewayBaseUrl`, `edit.ffmpeg` from `host-status.json` `editFfmpeg` when present. Desktop `curation` / `modeKeys` / `chatCount` stay empty — no HTTP models probe. Exit `1` means do not drive. A missing edit endpoint is a note, not a fail. `keyFingerprint` is `true` only on webdev when a gateway key is saved and `openaiKeyFingerprint` is a non-empty `sha256:` string. Cloud/GHA have no key — expect `false`, do not fail. `gatewayName` is Toko Token on public webdev. Webdev `knowledge: true` means `GET /api/v1/knowledge` returned 200; `false` is not a doctor fail — skip the Knowledge drive if it is false.

Refuse to drive when:

- The URL is not loopback
- `/chat` does not connect or returns 4xx/5xx
- Settings JSON is missing
- You were about to start a second process on :3000 (webdev)
- You were about to treat :3000 as the packaged desktop app
- `--desktop` is missing `host-status.json`, or `transport` is not `"ipc"`

`runtime: "stub"` — Chat send is a local stub reply. `runtime: "ai"` — Chat send and studio generate hit the live gateway. Do not call that stub proof. Do not paste or save keys during verification.

## Keys (Agentforge only — do not use Hermes tools)

The verify harness is this skill + `doctor.mjs`. Do not call Hermes CLI, mint Hermes dashboard session tokens, or talk to `hermes:api`.

How each Agentforge secret is processed:

| Secret | Entered | After save | Unlocks |
|---|---|---|---|
| Gateway key (`openai-key`) | Settings | Host process writes AES-256-GCM `settings.enc`. GET `/api/v1/settings` returns `hasOpenai: true`, never the raw key. Input shows “Saved — paste to replace”. | Chat + image/video on Toko Token (`/v1/chat/completions`, `/v1/images/generations`, `/v1/video/generations`) |
| Wrap key | Never in UI | Electron: Windows Credential Manager `Agentforge` / `wrap-key` (keytar) injected as `AGENTFORGE_SECRETS_KEY` into the child. Webdev: gitignored `data/.master-key` or env `AGENTFORGE_SECRETS_KEY`. | Decrypts `settings.enc` |
| Native extras (Google, Anthropic, Ark/Volcengine) | Not in GTM Settings UI (store still holds them) | Same `settings.enc`; UI booleans `hasGoogle` / `hasAnthropic` / `hasVolcengine` only | Optional non-gateway providers |
| Tool keys (Tavily, Brave, FAL, …) | Not in GTM Settings UI | Same file, `hasToolKeys` map | Search / FAL generate |

Do not type into `openai-key` on the operator’s desk unless they asked. GHA stays stub (`AGENTFORGE_RUNTIME=stub`) and has no key. Cursor Cloud Agents may have a provisioned `OPENAI_API_KEY` secret for live Enhance / Finance / Data proof on that VM only — save it into Settings / `settings.enc` or set `AGENTFORGE_RUNTIME=ai` after doctoring; never print, commit, or screenshot the key. If the env is missing, stay fail-closed on stub. Never paste the Cloud secret on the Windows desk.

## Drive

Stable handles are `data-testid` values from `apps/web`. Prefer those over CSS, coordinates, or tab order. Canonical walk is `apps/web/tests/e2e/foundation.spec.ts`.

**Windows (IDE browser)**

1. `browser_tabs` list. Navigate `http://127.0.0.1:3000/<route>` (omit `position` if you must keep focus).
2. `browser_lock` then `browser_snapshot`.
3. Click / type using snapshot refs. If a ref is missing, `browser_cdp` `Runtime.evaluate` to query `[data-testid="…"]` — do not fall back to clicking by CSS class.
4. Wait on the named testid or URL, not a fixed sleep. Composer send is done when `composer-send` reads `Send` again (up to 30s).
5. Unlock when the whole drive is finished.

**Cloud / GHA (Playwright)**

```bash
cd apps/web
AGENTFORGE_RUNTIME=stub npx playwright test
# or from repo root: pnpm test:e2e
```

Use `page.getByTestId("<id>")` exactly as the spec.

**Shared handles**

| testid | Surface |
|---|---|
| `mode-chat`, `mode-documents`, `mode-research`, `mode-finance`, `mode-data`, `mode-images`, `mode-videos`, `mode-presentations`, `mode-edit` | Left rail work modes (Default has all of these). `mode-edit` is Phase 1 |
| `mode-knowledge` | Account rail → Knowledge Base (`/knowledge`). Always visible; not a product mode |
| `product-brand`, `product-logo` | Rail product name and mark. Packaged flavors must not stay Agentforge — [desktop-brands.md](features/desktop-brands.md) |
| `mode-agents` | Parked. Count 0. `/agents` and `/studio` redirect to Chat |
| `workspaces-switcher`, `workspaces-link`, `open-workspace`, `create-new-workspace`, `workspace-template-picker`, `workspace-mode-picker`, `create-workspace`, `edit-workspace-modes`, `workspace-edit-name`, `save-workspace-modes`, `delete-workspace`, `delete-workspace-confirm-name`, `delete-workspace-confirm-submit` | Workspaces |
| `settings-link` | Rail → Settings |
| `usage-link`, `usage-open`, `usage-range`, `usage-range-chart` | Rail / Settings → Usage (`/usage`); range toggle + stacked chart |
| `model-picker`, `composer`, `composer-text`, `composer-send`, `composer-enhance` | Chat |
| `chat-usage`, `chat-context` | Chat header chips (wallet spend; ring + `left`/`used`) |
| `chat-empty`, `message-list`, `message-output`, `thread-list`, `thread-item`, `new-chat`, `chat-error`, `composer-error` | Threads + assistant markdown output; live contact fail after 3 tries |
| `settings-form`, `settings-endpoint`, `settings-endpoint-reset`, `openai-key`, `key-fingerprint`, `runtime-status`, `privacy-note`, `usage-this-key` | Settings (endpoint + key; Open Usage) |
| `rail-footer`, `theme-toggle`, `app-updates-toggle`, `app-updates-badge`, `app-updates-panel`, `app-updates-status`, `app-updates-check`, `app-updates-install`, `app-updates-close` | Rail footer: theme icon, updates icon (Agentforge only), collapse |
| `usage-range-empty`, `usage-desk-range`, `usage-by-model`, `usage-key-meter` | Usage page (by-model + desk range; empty chart copy) |
| `images-studio`, `images-studio-needs-key`, `videos-studio`, `videos-studio-needs-key` | Generate studios |
| `edit-studio`, `edit-timeline`, `edit-preview`, `edit-agent-panel`, `edit-composer`, `edit-card`, `edit-card-keep`, `edit-card-undo`, `edit-card-tweak`, `edit-export`, `edit-needs-ffmpeg`, `edit-needs-key` | Edit studio (Phase 1) |
| `finance-studio`, `finance-starters`, `finance-download`, `finance-generate` | Finance job |
| `data-studio`, `data-csv`, `data-starter`, `data-download`, `data-generate` | Data job |
| `knowledge-page`, `knowledge-tabs`, `knowledge-models`, `knowledge-sources`, `knowledge-paste`, `knowledge-soul-save`, `knowledge-memory-add`, `knowledge-model-embedding`, `knowledge-model-brain`, `knowledge-model-verifier`, `knowledge-tab-map`, `knowledge-map-panel`, `knowledge-map-run`, `knowledge-map` | Knowledge Base |
| `documents-studio-model`, `research-studio-model`, `presentations-studio-model` | Job generate-bar model dropdowns |
| `documents-section`, `research-preview`, `research-note` | Job preview bodies (markdown via `FormattedText`) |
| `documents-regen-panel`, `presentations-regen-panel`, `*-regen-prompt`, `*-regen-model`, `*-regen-attach`, `*-regen-submit` | Section/slide regen composer |

Rail testids are `mode-${href.slice(1)}` (`/chat` → `mode-chat`). Default already shows every work mode. A Legal desk has Chat + Documents + Research + Presentation and `mode-images` count 0.

Recipes: [features/chat.md](features/chat.md), [features/settings.md](features/settings.md), [features/usage.md](features/usage.md), [features/workspaces.md](features/workspaces.md), [features/documents.md](features/documents.md), [features/research.md](features/research.md), [features/finance.md](features/finance.md), [features/data.md](features/data.md), [features/knowledge.md](features/knowledge.md), [features/images.md](features/images.md), [features/videos.md](features/videos.md), [features/edit.md](features/edit.md), [features/desktop.md](features/desktop.md), [features/desktop-brands.md](features/desktop-brands.md), [features/mobile.md](features/mobile.md). Build and Studio advanced are parked.

## Evidence

Write under `.cursor/skills/verify-agentforge/evidence/<feature>/<run-id>/`. That directory is gitignored except `evidence/README.md`. Cleanup must not delete it.

A proof includes:

1. **Action** — what the user did (testid + value), not an internal API poke
2. **Result** — the named end state from the feature file (URL, visible testid, text)
3. **Capture** — IDE screenshot + accessibility snapshot, or Playwright trace on Cloud retry
4. **Doctor JSON** from this run
5. **Side effect** when the feature mutates: thread title in `thread-list`, new workspace name in `workspace-list`. Settings save is out of bounds unless the operator asked to change keys.

Standards:

- Walk the real composer / form / rail click. Do not POST `/api/v1/chat` or `/api/v1/settings` as a substitute for the UI.
- Capture before and after for mutations (empty chat → prompt in `message-list`).
- Stub is the product's own test mode (`resolveRuntimeMode`). It is not a mock you invented. Live generate stays on this machine with the operator's key — never on Cloud.
- A screenshot of the final screen with no action record is not proof.
- Cursor’s browser overlay can inject `data-cursor-ref` and steal clicks. If clicks no-op, say so and use Chrome or Cloud Playwright — do not invent a CSS workaround.

## Cleanup

- Stop only the `pnpm dev` this run started.
- Do not delete `data/agentforge.sqlite`, `data/settings.enc`, or the operator's threads.
- Do not delete evidence.
- A Chat send on the shared Windows instance leaves a real thread. Leave it unless the operator wants it removed (`thread-delete`).
- Do not create a custom agent on the operator's desk. Default already has job modes. Cloud Playwright no longer creates an Assistant.

## Helpers

`scripts/doctor.mjs` is the only helper. Webdev: no args. Packaged: `--desktop`. Do not reverse-engineer it — it prints the fields you need.

## Isolate

Two **webdev** instances cannot share port 3000. The packaged app has **no HTTP port** and a different data dir (Electron userData: `%APPDATA%\Agentforge` / `~/.config/Agentforge` / `~/Library/Application Support/Agentforge`), so it can run while `pnpm dev` is up. Playwright’s data dir is the same repo `data/` as the Windows local webdev. Isolation for E2E is the Cloud/GHA VM, not a second local port. Do not double-drive the operator’s live window while Cloud Playwright is also pointed at this checkout. If you need a disposable tree, set `AGENTFORGE_DATA_DIR` to a new directory (optional `pnpm db:push`; `ensureSchema` migrates on SQLite open), and optionally `AGENTFORGE_SETTINGS_PATH` so you do not touch the operator’s `data/settings.enc`.

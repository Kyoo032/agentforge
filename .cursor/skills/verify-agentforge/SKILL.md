---
name: verify-agentforge
description: Drives DPSBuddy the way a user does — webdev Vite/Express on 127.0.0.1:3000, packaged Electron over IPC (no loopback HTTP), data-testid handles, stub runtime, SQLite in the data dir. Launch, doctor, walk Chat/Settings/Workspaces/Images/Videos, keep evidence. Use after UI or product-mode work, when refusing done from a compile, or before claiming a settings/chat/workspace change works.
---

# Verify DPSBuddy

Agent guardrail, same class as `AGENTS.md`. Not part of the DPSBuddy app.

- **Product** is `apps/`, `packages/`, Chat / Settings / Workspaces / job modes — served as a hosted, multi-user web app. The NSIS installer is the frozen desktop shell (0.14.27, maintenance only); see [`web-pivot-2026-09-18.md`](../../../docs/internal/web-pivot-2026-09-18.md).
- **This directory** is how agents map and prove *this* repo (where to press, how to doctor, what counts as proof).
- Original pstack skills stay in the Cursor pstack plugin. Call them. Do not copy them into product code or the desktop bundle.
- **Map:** this `features/` map, then pstack `how` for how a subsystem works and where to fix.
- **Verify:** Launch / Doctor / Drive below (from pstack `create-verification-skill`). Map rot → pstack `/maintain-verification-skill` (edits only this directory).
- Keep the host's own task models (Cursor explore/worker; Claude Code explorers on Sonnet, workers on Opus). Do not adopt pstack Fable/GPT slugs.

A cold agent reads this mid-task. Drive the real app. A green `tsc` or worker summary is not proof.

**Surfaces.** Two surfaces share UI code; they do **not** share a port. The **web** proof path is webdev `:3000` today, and the hosted environment once it exists. `--desktop` stays the proof path for the **frozen** Electron build (0.14.27, maintenance only) — it is not the default surface any more, and it is still the only thing that proves a packaged shell change.

| Surface | How to reach it | Doctor | Port |
|---|---|---|---|
| **Local webdev** | `pnpm dev` → Chrome / IDE browser | `node .cursor/skills/verify-agentforge/scripts/doctor.mjs` | **3000 only** (`tsx server.ts` → Express + Vite on `127.0.0.1:3000`) |
| **Packaged desktop (frozen)** | Installed DPSBuddy, or local Kemenkeu AI / AIHub Metranet (Windows NSIS; mac/linux operator-built) | `node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop` | **None.** IPC only. Status in userData `host-status.json` (Windows `%APPDATA%\DPSBuddy` or `%APPDATA%\Kemenkeu AI` / `%APPDATA%\AIHub Metranet`; Linux `$XDG_CONFIG_HOME/DPSBuddy` or `~/.config/DPSBuddy`; macOS `~/Library/Application Support/DPSBuddy`) |

`pnpm desktop:dev` is the local webdev inside an Electron window (may reuse :3000). That is not packaged proof. APIs exist under `/api/v1/*` but proof is the user path, not an internal setter.

Do **not** use Hermes CLI, Hermes dashboard session tokens, or Hermes `hermes:api`. DPSBuddy key handling is in **Keys** below.

**Who runs which harness**

| Machine | Harness | Do not |
|---|---|---|
| This Windows session (Cursor) | `cursor-ide-browser` + `scripts/doctor.mjs`; Electron for desktop changes | `pnpm test:e2e`, `playwright test` |
| This Windows session (Claude Code) | **`http://127.0.0.1:3000` is the owner's isolated webdev — drive it**: throwaway data, no real gateway key, locale switches and mutating steps allowed. Doctor first (`scripts/doctor.mjs`), then a short scratch Playwright script. Clean up every thread, desk, dataset, matter and file you create; evidence is never deleted. `tsx server.ts` has **no watcher**, so a host or core edit made today is only live on a process started after it — an agent here cannot kill node, so say "restart :3000" and let the owner do it, rather than starting a rival. Start a second instance on a free port only when :3000 does **not** answer, or when you need a state :3000 cannot reach (a closed gate needs `AGENTFORGE_RUNTIME=ai` and its own `AGENTFORGE_DATA_DIR`), and stop it yourself. | Start a second instance while :3000 answers; press `settings-reset*`; type a real gateway key; leave a drive script in `scripts/`; `pnpm test:e2e` |
| Cursor Cloud + GHA | Playwright `apps/web/tests/e2e/foundation.spec.ts` | Paste a gateway key; start Docker |
| Pack / ship (this PC only) | [pack-dpsbuddy](../pack-dpsbuddy/SKILL.md) | Cloud `desktop:build`; `electron-builder --mac` on Windows |

Cloud and `.github/workflows/e2e.yml` own the serial stub smoke. Local coding agents do not run Playwright here (long serial pass). Cloud may use a secret gateway key for live Enhance / Finance / Data proof after doctor `ai`; GHA stays stub.

**Delegation.** Cursor sessions: explore with Composer 2.5 (`explore` / `composer-2.5-fast`), implementation workers are Grok 4.5 (`worker` / `cursor-grok-4.5-high`), fan-out stays at 2. Claude Code sessions: explorers on Sonnet, implementation and review workers on Opus, and the orchestrator verifies every result itself before reporting. Neither adopts pstack's own Fable/GPT Task slugs.

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
# local webdev on :3000 (the operator's instance)
node .cursor/skills/verify-agentforge/scripts/doctor.mjs

# an isolated webdev instance you started yourself on another port
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --base http://127.0.0.1:3200

# packaged desktop (reads OS userData host-status.json — not :3000, not HTTP)
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --desktop
```

It is read-only. Default GETs `/chat`, `/api/v1/settings`, `/api/v1/models`, and `GET /api/v1/edit/doctor` on `http://127.0.0.1:3000`. `--desktop` reads `host-status.json` (IPC; no HTTP). Override the webdev base with `--base http://127.0.0.1:<port>` (or `--base=…`), `AGENTFORGE_VERIFY_URL`, or `PORT`, in that order of precedence — still loopback only, and ignored with `--desktop`. Exit `0` prints JSON. Webdev: `url`, `surface`, `chatStatus`, `runtime`, `hasOpenai`, `keyFingerprint`, `modeKeys`, `chatCount`, `curation`, `knowledge`, `gatewayName`, `dataDirThisShell`, `edit` (`ffmpeg` / `asr`, or `{ available: false }` when the endpoint is missing). Desktop: `url: "ipc"`, `transport: "ipc"`, `pid`, `dataDir`, `productName`, `gatewayName`, `gatewayBaseUrl`, `edit.ffmpeg` from `host-status.json` `editFfmpeg` when present. Desktop `curation` / `modeKeys` / `chatCount` stay empty — no HTTP models probe. Exit `1` means do not drive. A missing edit endpoint is a note, not a fail. `keyFingerprint` is `true` only on webdev when a gateway key is saved and `openaiKeyFingerprint` is a non-empty `sha256:` string. Cloud/GHA have no key — expect `false`, do not fail. `gatewayName` is Toko Token on public webdev. `dataDirThisShell` is **this shell's** `AGENTFORGE_DATA_DIR`, not the server's — the host does not expose its data dir over HTTP, so on an isolated drive it says nothing about the instance you are doctoring. Webdev `knowledge: true` means `GET /api/v1/knowledge` returned 200; `false` is not a doctor fail — skip the Knowledge drive if it is false.

Refuse to drive when:

- The URL is not loopback
- `/chat` does not connect or returns 4xx/5xx
- Settings JSON is missing
- You were about to start a second process on :3000 (webdev)
- You were about to treat :3000 as the packaged desktop app
- `--desktop` is missing `host-status.json`, or `transport` is not `"ipc"`

`runtime: "stub"` — Chat send is a local stub reply. `runtime: "ai"` — Chat send and studio generate hit the live gateway. Do not call that stub proof. Do not paste or save keys during verification.

## Keys (DPSBuddy only — do not use Hermes tools)

The verify harness is this skill + `doctor.mjs`. Do not call Hermes CLI, mint Hermes dashboard session tokens, or talk to `hermes:api`.

How each DPSBuddy secret is processed:

| Secret | Entered | After save | Unlocks |
|---|---|---|---|
| Gateway key (`openai-key`) | Settings | Host process writes AES-256-GCM `settings.enc`. GET `/api/v1/settings` returns `hasOpenai: true`, never the raw key. Input shows “Saved — paste to replace”. | Chat + image/video on Toko Token. Probe is `GET /v1/models` (Bearer). Host auto-routes Chat: GPT-5/GPT-6/o → `/v1/responses`, Claude 5 / Opus 4.7/4.8 / Sonnet 4.6 → `/v1/messages` (`x-api-key` + `anthropic-version`), Gemini chat → generateContent, else `/v1/chat/completions`. Same key. |
| Wrap key | Never in UI | Electron: Windows Credential Manager `DPSBuddy` / `wrap-key` (keytar) injected as `AGENTFORGE_SECRETS_KEY` into the child. Webdev: gitignored `data/.master-key` or env `AGENTFORGE_SECRETS_KEY`. | Decrypts `settings.enc` |
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

**Windows (Claude Code — no IDE browser)**

A Claude Code session has no `browser_*` tool, so it drives with a throwaway Playwright script written to a scratch directory (`playwright` already resolves from `apps/web`). The script is deleted with the run — it never lands in `scripts/`. **Drive `http://127.0.0.1:3000`**: that instance is itself an isolated webdev (throwaway data, no real gateway key), so locale switches and mutating steps belong there, and you clean up what you create. Start your **own** webdev on a free port with its own `AGENTFORGE_DATA_DIR` only when :3000 does not answer, or when the drive needs a state :3000 cannot reach (a closed gate needs `AGENTFORGE_RUNTIME=ai`) — then doctor it with `--base` and stop it yourself. Everything else is unchanged: real composer / form / rail clicks, testid waits, evidence under `evidence/<feature>/<run-id>/`.

```bash
cd apps/web
PORT=3200 AGENTFORGE_DATA_DIR=<throwaway> npx pnpm@9.15.9 --filter @agentforge/web dev &
node .cursor/skills/verify-agentforge/scripts/doctor.mjs --base http://127.0.0.1:3200
```

Stop only the PID listening on your own port at the end (`Get-NetTCPConnection -LocalPort <port>` → `Stop-Process`), never by image name, and never the operator's :3000 / :3100.

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
| `mode-chat`, `mode-documents`, `mode-research`, `mode-finance`, `mode-data`, `mode-images`, `mode-videos`, `mode-music`, `mode-presentations`, `mode-edit` | Left rail work modes (Default has all of these). `mode-edit` shipped in 0.14.22 |
| `rail-market-mode`, `rail-market-specialists-toggle`, `rail-market-specialists-branch`, `rail-market-specialists`, `rail-market-specialist-<id>` (eleven: `saham`, `forex`, `gold`, `crypto`, `commodities`, `indices`, `sector-rotation`, `scanner`, `summary`, `elliott-wave`, `news`) | Market desks under the rail's Market row. Expanded rail **and** `/market` only — count 0 on a collapsed rail and on every other route, the chevron is `disabled` there, and nothing about the open state is stored (no rail-prefs key). The chosen desk rides in `?specialist=<id>`; the studio reports it as `market-specialist-current` / `-hint` / `-sources`, and the old `market-specialist` select is count 0 — [rail.md](features/rail.md), [market.md](features/market.md) |
| `mode-knowledge` | Account rail → Knowledge Base (`/knowledge`). Always visible; not a product mode |
| `channels-link`, `channels-page`, `channels-bot-token`, `channels-bot-connect`, `channels-bot-status`, `channels-bot-fingerprint`, `channels-bot-disconnect`, `channels-sandbox-note`, `channels-add-target`, `channels-add-submit`, `channels-item`, `channels-remove`, `channels-selected`, `channels-composer-text`, `channels-send`, `channels-needs-bot`, `channels-poll`, `channels-notice`, `channels-message` | Account rail → Channels (`/channels`). Always visible; not a product mode, so `mode-channels` is count 0 — [channels.md](features/channels.md) |
| `product-brand`, `product-logo` | Rail product name and mark. Packaged flavors must not stay DPSBuddy — [desktop-brands.md](features/desktop-brands.md) |
| `mode-agents` | Parked. Count 0. `/agents` and `/studio` redirect to Chat |
| `workspaces-switcher`, `workspaces-link`, `open-workspace`, `workspace-new-link`, `create-new-workspace`, `workspace-create-form`, `workspace-template-picker`, `workspace-template-blank` / `-<pack>`, `workspace-mode-picker`, `workspace-mode-<id>`, `workspace-name`, `create-workspace`, `cancel-create-workspace`, `workspace-list`, `edit-workspace-modes`, `workspace-edit-name`, `workspace-edit-modes`, `workspace-edit-mode-<id>`, `save-workspace-modes`, `cancel-workspace-modes`, `delete-workspace`, `delete-workspace-confirm`, `delete-workspace-confirm-name`, `delete-workspace-confirm-submit`, `delete-workspace-cancel` | Workspaces |
| `settings-link` | Rail → Settings |
| `usage-link`, `usage-open`, `usage-panel`, `usage-page`, `usage-range`, `usage-range-day` / `-week` / `-month`, `usage-range-chart` | Rail / Settings → Usage (`/usage`); range toggle + stacked chart |
| `model-picker`, `model-picker-panel`, `model-group-recommended`, `model-best-for`, `model-thinking-badge`, `composer`, `composer-text`, `composer-send`, `composer-enhance` | Chat. The picker panel is portalled to `document.body`; options are `[role="option"]` with no per-row testid |
| `reasoning-effort` | Chat Thinking: Off / Light / Normal / Deep / Extra / Max / Ultra (values `none` / `low` / `medium` / `high` / `xhigh` / `max` / `ultra`). Host snaps silently per model. No `chat-wire`. |
| `chat-usage`, `chat-context` | Chat header chips (wallet spend; ring + `left`/`used`) |
| `chat-empty`, `message-list`, `message-output`, `rail-thread-list`, `thread-item`, `rail-thread-error`, `new-chat`, `chat-error`, `composer-error` | Threads + assistant markdown output; `rail-thread-error` is the only symptom of a failed list load or a refused delete; live contact fail after 3 tries |
| `settings-form`, `openai-key`, `settings-edit-turn-cap`, `key-fingerprint`, `runtime-status`, `privacy-note`, `usage-this-key` | Settings (gateway key + Edit turn cap; Open Usage). Since 2026-09-17 `settings-endpoint`, `settings-endpoint-reset` and `openai-base-url` must all have count 0 — the endpoint is pinned and hidden, and the host name survives only in the intro and privacy prose |
| `settings-gateway-status`, `settings-gateway-recheck`, `settings-gateway-grace`, `settings-gateway-reason` | Settings gateway status row — [gateway-gate.md](features/gateway-gate.md) |
| `settings-locale`, `settings-locale-restart`, `settings-locale-restart-button` | Settings language row + restart banner — [locale.md](features/locale.md) |
| `settings-reset`, `settings-reset-key`, `settings-reset-key-confirm`, `settings-reset-key-submit`, `settings-reset-all`, `settings-reset-all-confirm-name`, `settings-reset-all-submit`, `settings-reset-cancel`, `settings-reset-pending` | Start over card. **Never press these on a desk you do not own** |
| `onboarding-form`, `onboarding-gateway-host`, `onboarding-key`, `onboarding-continue`, `onboarding-gate-reason`, `onboarding-recheck`, `onboarding-setup-check` | First-run / gate-closed screen. `onboarding-gate-reason` + `onboarding-recheck` appear only when the host reported a reason. Since 2026-09-17 `onboarding-endpoint` must have count 0 — `onboarding-gateway-host` is a muted text line, not a field |
| `rail-footer`, `theme-toggle`, `app-updates`, `app-updates-toggle`, `app-updates-badge`, `app-updates-panel`, `app-updates-status`, `app-updates-check`, `app-updates-install`, `app-updates-close`, `rail-collapse` / `rail-expand` (one button, testid flips by state), `rail-resize` (expanded only) | Rail footer: theme icon, updates icon (DPSBuddy only), collapse, resize — [rail.md](features/rail.md) |
| `usage-range-empty`, `usage-desk-range`, `usage-by-model`, `usage-key-meter` | Usage page (by-model + desk range; empty chart copy) |
| `images-studio`, `images-studio-needs-key`, `videos-studio`, `videos-studio-needs-key` | Generate studios |
| `music-studio`, `music-studio-needs-key`, `music-studio-mode`, `music-studio-lyrics`, `music-studio-style`, `music-studio-title`, `music-studio-instrumental`, `music-studio-draft-lyrics`, `music-studio-submit`, `music-studio-estimate`, `music-studio-takes-note`, `music-studio-voice-unavailable`, `music-studio-track`, `music-studio-download` | Music studio. One generate adds **two** `music-studio-track` rows (two takes, one charge), and voice-over is a reported reason, not a control — [music.md](features/music.md) |
| `edit-studio`, `edit-timeline`, `edit-preview`, `edit-agent-panel`, `edit-composer`, `edit-card`, `edit-card-keep`, `edit-card-undo`, `edit-card-tweak`, `edit-export`, `edit-needs-ffmpeg`, `edit-needs-key` | Edit studio. Storyboard generate is still a Phase 3 placeholder — [edit.md](features/edit.md) |
| `finance-studio`, `finance-figures-input`, `finance-parse`, `finance-prompt`, `finance-generate`, `finance-auto-parsed`, `finance-download-docx` (DOCX, studio header) / `finance-download` (Markdown, shared artifact bar) | Finance job. No starter cards — they were removed in 0.14.22 |
| `data-studio`, `data-source`, `data-upload`, `data-file-input`, `data-csv`, `data-use-pasted`, `data-saved`, `data-dataset`, `data-profile`, `data-preview-toggle`, `data-preview`, `data-starter`, `data-prompt`, `data-generate`, `data-progress`, `data-error` | Data job (shell + dataset, no key). `data-analysis`, `data-actions`, `data-download` need a live key |
| `knowledge-page`, `knowledge-tabs`, `knowledge-models`, `knowledge-sources`, `knowledge-paste`, `knowledge-soul-save`, `knowledge-memory-add`, `knowledge-model-embedding`, `knowledge-model-brain`, `knowledge-model-verifier`, `knowledge-tab-map`, `knowledge-map-panel`, `knowledge-map-run`, `knowledge-map` | Knowledge Base |
| `knowledge-loop`, `knowledge-loop-cycle`, `knowledge-loop-stage-<Stage>`, `knowledge-loop-summary`, `knowledge-loop-work`, `knowledge-loop-count-<Type>`, `knowledge-loop-empty`, `knowledge-loop-verify`, `knowledge-loop-verified`, `knowledge-loop-verify-error`, `knowledge-source-type` | Knowledge loop, six stages incl. Graph + Verified (Sources tab) — [knowledge-ingest.md](features/knowledge-ingest.md), [knowledge.md](features/knowledge.md) |
| `knowledge-graph-panel`, `knowledge-graph-toggle`, `knowledge-graph-counts`, `knowledge-graph-svg`, `knowledge-graph-node-<id>`, `knowledge-graph-legend`, `knowledge-graph-shown`, `knowledge-graph-empty`, `knowledge-graph-error`, `knowledge-graph-retry`, `knowledge-graph-clear-focus` | Knowledge graph panel (under the loop chart) — [knowledge.md](features/knowledge.md) |
| `documents-studio-model`, `research-studio-model`, `presentations-studio-model` | Job generate-bar model dropdowns |
| `documents-section`, `research-preview`, `research-note` | Job preview bodies (markdown via `FormattedText`) |
| `documents-regen-panel`, `presentations-regen-panel`, `*-regen-prompt`, `*-regen-model`, `*-regen-attach`, `*-regen-submit` | Section/slide regen composer |

Rail testids are `mode-${href.slice(1)}` (`/chat` → `mode-chat`). Default already shows every work mode. A Legal desk has Chat + Documents + Research + **Legal** + Presentation (`packages/core/src/templates/library.ts:699-703`) and `mode-images` count 0.

Recipes: [features/chat.md](features/chat.md), [features/rail.md](features/rail.md), [features/settings.md](features/settings.md), [features/gateway-gate.md](features/gateway-gate.md), [features/locale.md](features/locale.md), [features/channels.md](features/channels.md), [features/usage.md](features/usage.md), [features/workspaces.md](features/workspaces.md), [features/documents.md](features/documents.md), [features/research.md](features/research.md), [features/finance.md](features/finance.md), [features/data.md](features/data.md), [features/legal.md](features/legal.md), [features/knowledge.md](features/knowledge.md), [features/knowledge-phases.md](features/knowledge-phases.md), [features/knowledge-ingest.md](features/knowledge-ingest.md), [features/knowledge-graph.md](features/knowledge-graph.md), [features/images.md](features/images.md), [features/videos.md](features/videos.md), [features/edit.md](features/edit.md), [features/desktop.md](features/desktop.md), [features/desktop-brands.md](features/desktop-brands.md), [features/mobile.md](features/mobile.md). Build and Studio advanced are parked.

## Harness-wide gotchas

Five traps that cost a driver a drive each on 2026-09-17, in more than one mode. They live **here**, once. A feature file names only its own route or testid and points back at the letter — never restates the rule.

**G1 — Settle before you press a submit button.** A click that lands before React hydrates a real `<form>` is a **native** form submit: the browser reloads the page and the prompt, the rows and any error banner vanish with no request fired and nothing raised — which reads exactly like a swallowed error. Two drives were misread this way (`finance-generate` is `type="submit"` in a real form, `apps/web/components/finance-steps/finance-prompt-bar.tsx:37`, `:67`). Settle after every `goto` / `reload`, or assert the prompt still holds your text after the click, before concluding anything. The same wait covers the model dropdowns: `useJobModel` leaves every `*-studio-model` empty and `disabled` for roughly a second (`apps/web/lib/use-job-model.ts:74-100`; `model-select.tsx:63`), so wait for a non-empty option list, not for the testid.

**G2 — A failed job on a `/stream` route is HTTP 200.** `streamJob` flushes the SSE headers before the job runs and returns `{type:"stream", status:200}` unconditionally (`packages/host/src/job-stream.ts:57-59`, `:85`); a rejection becomes a single `event: job.error` frame carrying the real code and status. **Assert the error testid, never the HTTP status**, on `/api/v1/{research,finance,data,market}/stream` and `/api/v1/legal/matters/:id/run/stream`. Two exceptions: Documents and Presentations post the plain routes and *do* answer a real HTTP 503; and a **closed gate** is a real HTTP 403 `gateway_blocked` thrown before the stream opens, with a **flat** body (`{"error":"gateway_blocked","status":…,"message":…}`), not the nested envelope.

**G3 — A visited studio stays mounted.** `WorkModeKeepAlive` hides an inactive work mode instead of unmounting it (`apps/web/components/work-mode-keep-alive.tsx:34-42`, `:46-77`). After one visit, that studio's testid still has **count 1** on every other route, with `isVisible()` false, and its inputs keep their values. So: assert `isVisible()`, never count, for "this mode is not showing"; scope shared testids (`example-gallery`, `example-card`) to the studio's own root or use `.first()`, or Playwright raises a strict-mode violation; and remember a hidden mode's studio is in the DOM even after a `productModes` redirect — assert the **rail** testid for "this desk cannot reach that mode".

**G4 — Playwright hides scrollbars by default.** Headless chromium launches with `--hide-scrollbars`, so any screenshot meant to prove scrollbar styling, gutter width or overflow shows nothing. Launch with `chromium.launch({ headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] })` for those shots only, and say in the evidence that you did.

**G5 — `page.route` takes a predicate, and an un-awaited handler hangs the drive.** The deterministic repro for the thread-fork race (`page.route("**/api/v1/threads/<id>", async (r) => { await delay(4000); await r.continue(); })`) only works when the pattern matches the **full** URL including the id — a bare `**/threads` also swallows the list request and the rail never paints. Always `await route.continue()` (or `fulfill`), always unroute in a `finally`, and never leave a delayed route installed across navigations.

## Evidence

Write under `.cursor/skills/verify-agentforge/evidence/<feature>/<run-id>/`. That directory is gitignored except `evidence/README.md`. Cleanup must not delete it.

A proof includes:

1. **Action** — what the user did (testid + value), not an internal API poke
2. **Result** — the named end state from the feature file (URL, visible testid, text)
3. **Capture** — IDE screenshot + accessibility snapshot, or Playwright trace on Cloud retry
4. **Doctor JSON** from this run
5. **Side effect** when the feature mutates: thread title in `rail-thread-list`, new workspace name in `workspace-list`. Settings save is out of bounds unless the operator asked to change keys.

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

`scripts/doctor.mjs` is the only helper, and `scripts/desktop-app-url.mjs` exists solely because doctor imports it. Nothing else lives in `scripts/`.

| Invocation | What it doctors |
|---|---|
| `node .cursor/skills/verify-agentforge/scripts/doctor.mjs` | webdev on `:3000` |
| `… doctor.mjs --base http://127.0.0.1:<port>` | an isolated webdev instance on another port (`--base=…`, `AGENTFORGE_VERIFY_URL` and `PORT` do the same) |
| `… doctor.mjs --desktop` | the packaged app via `host-status.json` |

Do not reverse-engineer it — it prints the fields you need. **A one-off drive script is not a helper.** Write it in a scratch directory, delete it with the run, and never leave it in `scripts/`: fifteen `drive-*` / `loop-*` / `poll-*` / `probe-*` / `reverify-*` files accumulated that way, none of them referenced by any recipe, two of them able to save a real key or decrypt `settings.enc`. They were deleted on 2026-09-15. If a recipe genuinely needs a helper, it goes in this table first.

## Isolate

Two **webdev** instances cannot share port 3000. The packaged app has **no HTTP port** and a different data dir (Electron userData: `%APPDATA%\DPSBuddy` / `~/.config/DPSBuddy` / `~/Library/Application Support/DPSBuddy`), so it can run while `pnpm dev` is up. Playwright’s data dir is the same repo `data/` as the Windows local webdev. Isolation for E2E is the Cloud/GHA VM, not a second local port. Do not double-drive the operator’s live window while Cloud Playwright is also pointed at this checkout. If you need a disposable tree, set `AGENTFORGE_DATA_DIR` to a new directory (optional `pnpm db:push`; `ensureSchema` migrates on SQLite open), and optionally `AGENTFORGE_SETTINGS_PATH` so you do not touch the operator’s `data/settings.enc`.

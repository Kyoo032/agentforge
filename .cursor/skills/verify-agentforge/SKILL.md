---
name: verify-agentforge
description: Drives Agentforge the way a user does — Next.js on 127.0.0.1:3000, data-testid handles, stub runtime, SQLite in the data dir. Launch, doctor, walk Chat/Settings/Build/Images/Videos, keep evidence. Use after UI or product-mode work, when refusing done from a compile, or before claiming a studio/settings/chat change works.
---

# Verify Agentforge

A cold agent reads this mid-task. Drive the real app. A green `tsc` or worker summary is not proof.

**Surfaces.** Primary: Next.js web app (`apps/web`) at `http://127.0.0.1:3000`. Secondary: Electron desktop (`pnpm desktop:dev`) — starts Next when `:3000` is empty, wrap key via keytar, data in OS userData. APIs exist under `/api/v1/*` but proof is the user path, not an internal setter.

**Who runs which harness**

| Machine | Harness | Do not |
|---|---|---|
| This Windows session | `cursor-ide-browser` + `scripts/doctor.mjs`; Electron for desktop changes | `pnpm test:e2e`, `playwright test` |
| Cursor Cloud + GHA | Playwright `apps/web/tests/e2e/foundation.spec.ts` | Paste a gateway key; start Docker |

Cloud and `.github/workflows/e2e.yml` own the serial stub smoke. Local coding agents do not run Playwright here (cold Next compile + long serial pass).

**Delegation.** Explore with Composer 2.5 (`explore` / `composer-2.5-fast`). Implementation workers are Grok 4.5 (`worker` / `cursor-grok-4.5-high`). Do not use pstack Fable/GPT Task slugs. Fan-out stays at 2.

Read [features/README.md](features/README.md) before driving. The map is the source of which entry points exist. Proving one convenient path is incomplete when the map lists others.

## Launch

Ready signal: `GET http://127.0.0.1:3000/chat` returns 200, or the turbo line `@agentforge/web:dev:` is serving. Bind is `127.0.0.1:3000` only (`apps/web` script `next dev --hostname 127.0.0.1 --port 3000`). Drive `127.0.0.1`, not a LAN IP. `localhost` usually works but is not what Playwright and the Next bind use.

**If port 3000 already answers** — doctor that instance. Do not start a second Next process. Port 3000 is exclusive.

**If nothing is listening** (fresh Cloud VM or a stopped local checkout):

```bash
# from repo root; Windows may need npx pnpm@9.15.9
unset DATABASE_URL
export AGENTFORGE_RUNTIME=stub
export AGENTFORGE_DATA_DIR="${AGENTFORGE_DATA_DIR:-$PWD/data}"
pnpm db:push
pnpm dev
```

SQLite file: `$AGENTFORGE_DATA_DIR/agentforge.sqlite` (default `data/agentforge.sqlite`). First visit creates the local owner. Optional `pnpm db:seed` is not required for Chat.

**Cloud boot** already runs `scripts/cloud-start.sh` (`mkdir data`, unset `DATABASE_URL`, `pnpm db:push`). Then `pnpm dev`. Playwright `webServer` in `apps/web/playwright.config.ts` starts `pnpm dev` with `AGENTFORGE_RUNTIME=stub` and `AGENTFORGE_DATA_DIR` resolved to repo `data/`. `reuseExistingServer` is on unless `CI`.

**Stub vs live.** `AGENTFORGE_RUNTIME=stub` until a gateway (or other provider) key is saved. A saved key makes `GET /api/v1/settings` report `runtime: "ai"`. Cloud and GHA force stub and have no key. This Windows machine may already be live — doctor first.

**Teardown.** Only if this run started `pnpm dev`: stop that PID (Ctrl+C / kill the shell job). Never `taskkill` by image name. Never stop a server you did not start.

## Doctor

Run this first whenever anything looks off, and before every drive:

```bash
node .cursor/skills/verify-agentforge/scripts/doctor.mjs
```

It is read-only. It GETs `/chat` and `/api/v1/settings` on `http://127.0.0.1:3000` (override with `AGENTFORGE_VERIFY_URL`, still must be loopback). Exit `0` prints JSON: `url`, `chatStatus`, `runtime`, `hasOpenai`, `dataDir`. Exit `1` means do not drive.

Refuse to drive when:

- The URL is not loopback
- `/chat` does not connect or returns 4xx/5xx
- Settings JSON is missing
- You were about to start a second process on :3000

`runtime: "stub"` — Chat send is a local stub reply. `runtime: "ai"` — Chat send and studio generate hit the live gateway. Do not call that stub proof. Do not paste or save keys during verification.

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

Use `page.getByTestId("<id>")` exactly as the spec. Wait for `/studio/<uuid>`, not `/studio/new`, after create.

**Shared handles**

| testid | Surface |
|---|---|
| `mode-chat`, `mode-agents`, `mode-images`, `mode-videos`, `mode-presentations` | Left rail (only modes the workspace has unlocked) |
| `mode-documents`, `mode-research` | Not in the default rail; count 0 until a pack/agent unlocks them |
| `settings-link` | Rail → Settings |
| `model-picker`, `composer`, `composer-text`, `composer-send` | Chat |
| `chat-empty`, `message-list`, `thread-list`, `thread-item`, `new-chat` | Threads |
| `settings-form`, `openai-base-url`, `openai-key`, `runtime-status`, `privacy-note` | Settings |
| `create-agent`, `template-blank`, `template-default`, `template-students`, `template-marketing`, `template-legal`, `studio-agent-name` | Build |
| `images-studio`, `images-studio-needs-key`, `videos-studio`, `videos-studio-needs-key` | Studios |

Rail testids are `mode-${href.slice(1)}` (`/chat` → `mode-chat`). Images/Videos/Presentation tabs appear only after a custom agent unlocks those surfaces (Default template = original five). A Chat-only desk has `mode-images` count 0.

Recipes: [features/chat.md](features/chat.md), [features/settings.md](features/settings.md), [features/build.md](features/build.md), [features/images.md](features/images.md), [features/videos.md](features/videos.md), [features/desktop.md](features/desktop.md).

## Evidence

Write under `.cursor/skills/verify-agentforge/evidence/<feature>/<run-id>/`. That directory is gitignored except `evidence/README.md`. Cleanup must not delete it.

A proof includes:

1. **Action** — what the user did (testid + value), not an internal API poke
2. **Result** — the named end state from the feature file (URL, visible testid, text)
3. **Capture** — IDE screenshot + accessibility snapshot, or Playwright trace on Cloud retry
4. **Doctor JSON** from this run
5. **Side effect** when the feature mutates: thread title in `thread-list`, studio UUID in the URL, `visibility` text. Settings save is out of bounds unless the operator asked to change keys.

Standards:

- Walk the real composer / form / rail click. Do not POST `/api/v1/chat` or `/api/v1/settings` as a substitute for the UI.
- Capture before and after for mutations (empty chat → prompt in `message-list`).
- Stub is the product's own test mode (`resolveRuntimeMode`). It is not a mock you invented. Live generate stays on this machine with the operator's key — never on Cloud.
- A screenshot of the final screen with no action record is not proof.
- Next.js overlay in the Cursor browser can inject `data-cursor-ref` and steal clicks. If clicks no-op, say so and use Chrome or Cloud Playwright — do not invent a CSS workaround.

## Cleanup

- Stop only the `pnpm dev` this run started.
- Do not delete `data/agentforge.sqlite`, `data/settings.enc`, or the operator's threads.
- Do not delete evidence.
- A Chat send on the shared Windows instance leaves a real thread. Leave it unless the operator wants it removed (`thread-delete`).
- Do not create a second agent "just to unlock Images" on the operator's desk without saying so. Cloud Playwright already creates one Assistant in its own pass.

## Helpers

`scripts/doctor.mjs` is the only helper. Invoke it as shown under Doctor. Do not reverse-engineer it — it prints the fields you need.

## Isolate

Two product instances cannot share port 3000. Playwright's data dir is the same repo `data/` as the Windows prototype. Isolation for E2E is the Cloud/GHA VM, not a second local port. Do not double-drive the operator's live window while Cloud Playwright is also pointed at this checkout. If you need a disposable tree, set `AGENTFORGE_DATA_DIR` to a new directory, `pnpm db:push` there, and optionally `AGENTFORGE_SETTINGS_PATH` so you do not touch the operator's `data/settings.enc`.

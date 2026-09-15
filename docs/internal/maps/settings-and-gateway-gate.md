# Map — Settings, the gateway gate, and Start over

Last verified: 2026-09-15 at b9f931a

## Overview

Three things that share one surface. **Settings per desk** is where the gateway key and per-workspace preferences live, on disk, encrypted, keyed by workspace id. **The gateway gate** is the host's judgement about whether that key currently works, cached as a verdict file and answered to the renderer as one boolean. **Start over** is the two-scope escape hatch: forget the key, or wipe the desk back to a fresh install.

The rule that ties them together: **the host decides, the renderer displays.** `allowed` is the only thing the renderer branches on; it never re-derives a decision from `hasOpenai` or from key shape.

## How it works

### Settings per desk

Despite the name, there is **one encrypted file**, not a directory per desk: `<localDataDir()>/settings.enc`, holding `{ version: 2, locale, workspaces: { [workspaceId]: StoredSecrets } }` (`packages/host/src/settings-store.ts:26-28`, `:119-123`). "Per desk" is a key in that map.

`loadSettings(workspaceId?)` / `saveSettings(patch, workspaceId?)` (`packages/host/src/settings-store.ts:329-346`) resolve the desk through `resolveSettingsWorkspaceId` (`:187-193`): explicit id → `readSelectedWorkspaceId()` → the literal `__default__`. `sliceFor()` (`:195-204`) picks that desk's slice, falling through to the `__legacy__` slice **only** when the resolved id is literally `__default__`.

**`workspace-id.txt`** (`<localDataDir()>/workspace-id.txt`, `packages/host/src/workspace.ts:8-24`) is the stamp that stops a request from landing in `__default__`. `getTenant(preferredWorkspaceId)` (`packages/host/src/tenant.ts:26-41`) calls `adoptLegacySettings(home.id)` on every call, and — only when the caller named no desk and nothing was on disk — writes the resolved desk id (`:37-39`). A desk named by the per-request `WORKSPACE_COOKIE` is **never** promoted into the file (`:14-16`), pinned by `packages/host/src/tenant.test.ts:49-55`.

**The `__default__` trap.** The literal appears in exactly three places, all in `packages/host/src/settings-store.ts` (`:24`, `:192`, `:200`). If a request resolves to it — e.g. a bare `loadSettings()` before the stamp exists — it reads an orphan slice no real desk ever sees, so a key saved on the real desk looks absent and the desk reports `runtime_stub`. The defence is a **source-grep test**: `packages/host/src/settings-desk-scope.test.ts:18-88` fails the suite if any file under `packages/host/src`, `apps/desktop` or `apps/web/server.ts` calls `loadSettings` with `()`/`undefined`/`null`/`""`, outside two named exceptions (`studio-generate.ts`, `handlers/jobs.ts`).

**`settingsPayload()`** (`packages/host/src/handlers/settings.ts:83-120`) is what the renderer sees. Keys are never in it: `maskSecrets` (`packages/core/src/secrets.ts:232-258`) emits booleans (`hasOpenai`, …) and fingerprints (`sha256:` + the first 12 hex chars of SHA-256 over the trimmed secret, `packages/core/src/security/fingerprint.ts:9-15`). `openaiBaseUrl` in the payload is always `resolvedGatewayBaseUrl()`, never a stored value (`packages/core/src/secrets.ts:242-243`).

**Key resolution.** `resolveProviderKeys(settings, env)` (`packages/core/src/secrets.ts:278-309`), today:

```
openai        = settings.openaiApiKey || env.OPENAI_API_KEY
openaiBaseUrl = resolvedGatewayBaseUrl()          // pinned, settings and env ignored
google        = settings.googleApiKey || env.GOOGLE_GENERATIVE_AI_API_KEY || reuseOpenAI("google")
anthropic     = settings.anthropicApiKey || env.ANTHROPIC_API_KEY || reuseOpenAI("anthropic")
volcengine    = settings.volcengineApiKey || env.ARK_API_KEY || env.VOLCENGINE_API_KEY || reuseOpenAI("volcengine")
```

`reuseOpenAI(dialect)` hands the OpenAI-slot key to another provider's slot when `guessDialectFromKey` says it actually belongs there — i.e. someone pasted an Anthropic key into the one key field. Stub vs live is a separate call, `resolveRuntimeMode({ settingsHasKey, envRuntime })` (`packages/core/src/secrets.ts:271-276`).

**Endpoint pinning.** `PINNED_GATEWAY_BASE_URL = "https://api.tokotokenai.com/v1"` (`packages/core/src/gateway/pinned.ts:8`), with a SHA-256 of the literal checked by `packages/core/src/gateway/pinned.test.ts`. The `AGENTFORGE_GATEWAY_URL` override needs `gatewayUrlOverrideAllowed()` (`packages/core/src/gateway/pinned.ts:24-36`): not packaged **and** `NODE_ENV !== "production"`. The **gateway-pin test** (`packages/host/src/gateway-pin.test.ts`) enforces this by grep: the `ALLOWLIST` of permanent exceptions must stay empty; no file under `packages/host/src` or `packages/core/src` may read `settings.openaiBaseUrl` outside `secrets.ts`/`settings-store.ts`; and `handlers/settings.ts` must not match `/body\.openaiBaseUrl/`, so the settings POST cannot accept an endpoint override at all.

### The gateway gate

Contract: `packages/core/src/gateway/gate-types.ts` — `{ status, allowed, grace, endpoint, endpointLocked: true, checkedAt, lastOkAt, message? }`, `status` in `stub | needs_key | ok | invalid_key | unreachable | error`.

`reportGatewayGate(settings)` (`packages/host/src/gateway-gate.ts:337-350`) resolves the key to judge, fingerprints it, loads the verdict from `<dataDir>/gateway-gate.json` (**the verdict is keyed by fingerprint; the key itself is never written**), and hands both to the pure `deriveGatewayGate` (`:250-297`), which applies in order:

| Condition | Result |
|---|---|
| `envRuntime === "stub"` | `{status:"stub", allowed:true, grace:false}` (`:262-264`) |
| no key | `{status:"needs_key", allowed:false}` (`:265-267`) |
| no verdict, or verdict for a different fingerprint | `{status:"ok", allowed:true, grace:true, message:"Not checked yet."}` — **opened on trust** (`:275-279`) |
| verdict `ok`, fresh (< `GATEWAY_OK_TTL_MS`) | `allowed:true, grace:false` |
| verdict `ok`, stale | `allowed = withinGrace(lastOkAt, …)`, `grace:true` (`:281-288`) |
| verdict `invalid_key` | `allowed:false, grace:false` — **no grace, ever** (`:290-292`) |
| verdict `unreachable` / `error` | `allowed = withinGrace(…)` (`:293-295`) |
| persisted `stub` / `needs_key` verdict | treated as never-checked (`:296`) |

Constants (`packages/host/src/gateway-gate.ts`): `GATEWAY_GRACE_MS = 7 * 86_400_000` (`:33`), `GATEWAY_CHECK_TIMEOUT_MS = 3_000` (`:36`), `GATEWAY_OK_TTL_MS = 86_400_000` (`:42`), `GATEWAY_REFRESH_THROTTLE_MS = 600_000` (`:45`). The grace boundary is inclusive — exactly 7 days still counts (`withinGrace`, `:227-230`, pinned at `packages/host/src/gateway-gate.test.ts:146-155`).

**The live check** is `checkGatewayLive` (`packages/host/src/gateway-gate.ts:298-320`): `GET {baseUrl}/models` with `Authorization: Bearer <key>` under `AbortSignal.timeout(3_000)`, after `assertAllowedEndpointUrl` rejects plain-HTTP remotes. 2xx → `ok`; 401/403 → `invalid_key` (message is `HTTP {status}`, the key is never echoed); other non-OK → `error`; thrown/timeout → `unreachable`. It runs on a key save (`refreshGatewayCheckAfterSave` → `runGatewayCheck`, `packages/host/src/handlers/settings.ts:237-251`) and on `POST /api/v1/settings/gateway/check` (`packages/host/src/handlers/settings.ts:254-262`, route at `packages/host/src/router.ts:177`). Separately, `maybeRefreshGateway` (`packages/host/src/gateway-gate.ts:494-524`) fires an un-awaited check at most once per key per 10 minutes from `handleGetSettings` — that is what turns "opened on trust" into a real verdict over time.

**Enforcement.** `requireGatewayAllowed(settings)` (`packages/host/src/gateway-gate.ts:411-417`) throws `GatewayBlockedError` when `!gate.allowed`, and `jsonError` flattens it (`packages/host/src/errors.ts:20-25`) to `403 { error: "gateway_blocked", status, message }` — a flat body, deliberately not the usual `{error:{code,message}}` envelope, so `parseGatewayBlocked` can read it without unwrapping. Call sites: `handlers/runs.ts:31`; `handlers/jobs.ts:64, 102, 114, 125, 152, 163, 191, 203, 216, 228`; `handlers/knowledge.ts:149, 166, 182, 231, 266, 288, 348, 381`; `handlers/finance.ts:16, 28, 42, 53`; `handlers/market.ts:30, 42, 56`; `handlers/edit.ts:326, 546`; `handlers/enhance-prompt.ts:49`; `handlers/legal.ts:115`.

Deliberately **open**: settings, workspaces, threads, artifacts, media, usage, model refresh — proved by the absence of the import in those handler files and directly by `packages/host/src/handlers/settings.test.ts:186-192` ("does not gate settings, usage or threads"). A closed gate must always be recoverable.

**Renderer.** `parseGatewayGate` (`apps/web/lib/gateway-gate.ts`) requires a known `status` and a boolean `allowed` or returns `null`; `MISSING_GATEWAY_GATE` fails closed. `resolveGate(payload, isElectron)` (`:80-86`) obeys a reported gate as-is, and on a missing or malformed one falls closed **only under Electron** — webdev and Playwright keep working before the host answers. `App.tsx:74-121` holds the state, listens for `GATE_EVENT = "agentforge-gate"` (`apps/web/lib/gateway-gate.ts:96`), and renders `OnboardingScreen` when `gate === "onboarding"`. Reason copy maps through `REASON_KEYS` (`:112-116`) to `onboarding.gate.invalidKey / unreachable / error`.

### Start over

Card `settings-reset` (`apps/web/components/settings-reset-card.tsx:159`), mounted at `apps/web/components/settings-page.tsx:433`, fed by `resetPending` on the settings payload.

**Sign out (`scope: "key"`)** — no typed confirmation, fully synchronous. `resetGatewayKey` (`packages/host/src/handlers/settings.ts:285-298`) calls `clearGatewayKeyEverywhere()` (`packages/host/src/settings-store.ts:375-390` — **machine-wide**, because "a key left on a second desk would keep the gate open after 'forget my key'"), then `clearGateState()`, `clearThisKeyCache()`, `resetEmbedCircuit()`. Returns `relaunch: false`. Threads, desks and media are untouched. The card navigates to `/chat` and calls `announceGate(result.gateway)`, which dispatches `GATE_EVENT` and drops the shell to onboarding.

**Fresh install (`scope: "all"`)** — typed `RESET` required. The button is disabled until `typed.trim() === RESET_CONFIRM_WORD`, but what travels is **what the owner actually typed** (`apps/web/components/settings-reset-card.tsx:134-136`), and the host re-checks it independently (`packages/host/src/handlers/settings.ts:301-302`, 400 otherwise). Then `requestDataReset(localDataDir(), [...HOST_RESET_ENTRIES])` writes the marker — nothing is deleted yet, because "the database is open and ffmpeg may still be writing" (`:304`) — followed by `killTrackedChildren()`, and the answer is `{ relaunch: true, resetPending: true }`.

The marker is `reset-pending.json` (`RESET_MARKER_FILE`, `packages/db/src/reset.ts:26`), written temp-file-then-`renameSync` so a crash cannot leave a half-written marker that parses.

**The wipe list is named entries, never the directory** (`packages/host/src/handlers/settings.ts:270-283`), because in the packaged app that same folder is Electron's userData / Chromium profile:

```
settings.enc  settings.json  .master-key  gateway-gate.json  media
workspace-id.txt  desk-usage.json  datasets  edit  legal
models-cache.json  models-dev-cache.json
```

plus, always, `SQLITE_ENTRIES` — `agentforge.sqlite`, `-wal`, `-shm` (`packages/db/src/reset.ts:29`, unioned at `:270`) and, when `DATABASE_URL` points out of tree, that trio by absolute path (`:193-242`). Pinned exactly by `packages/host/src/handlers/settings.test.ts:345-358`, which also asserts `host-status.json` and anything containing "storage" never appear. Preserved: `host-status.json`, `Local Storage/`, every other Chromium artifact, and `legacy-migrated.json`.

**Applied at boot, before SQLite opens.** `packages/db/src/client.ts:35-37` — when `AGENTFORGE_APPLY_PENDING_RESET === "1"` and no connection exists, `applyPendingDataReset(localDataDir())` runs at module top level, two lines before `new SqliteDatabase(file)`. That env flag is set in exactly two places: `apps/web/server-env.ts:14` (webdev) and `apps/desktop/main.cjs:631` inside `bootstrapPackaged()`, before `require("./host.cjs")` — so a test or script that imports `@agentforge/db` can never trigger a wipe as a side effect.

**Relaunch.** `relaunchDesktopApp({reset:true})` → preload `relaunch` → `ipcMain.handle("app:relaunch", …)` (`apps/desktop/main.cjs:533`), which first checks `isTrustedSender(event, mainWindow)` (`apps/desktop/navigation.cjs:109`) and refuses a non-main-frame sender with `{ok:false, reason:"forbidden"}`. `relaunchApp(true)` (`apps/desktop/main.cjs:212-241`) consults `lifecycle.relaunchPlan()` (refuses while installing an update or already exiting), races `clearRendererState()` — `clearStorageData` + `clearCache` + `clearAuthCache` + `clearCodeCaches` (`:181-193`) — against `CLEAR_STORAGE_TIMEOUT_MS = 3000`, then `app.relaunch()` and `app.exit(0)`.

### Failure modes

| Case | Behaviour |
|---|---|
| `gateway-gate.json` missing, unreadable, or not JSON | `loadGateState` returns `null` (`packages/host/src/gateway-gate.ts:134-140`) → opens on trust |
| Verdict cannot be written | `saveGateState` warns and returns `{persisted:false}` (`:170-190`); `runGatewayCheck` reports `status:"error"` but leaves `allowed` as derived — "an unwritable data dir must not close a desk" |
| Live check throws / times out | mapped to `unreachable` (`:406-410`), never thrown |
| Background re-check throws | swallowed (`:517-521`) |
| Reset queued, app killed before reboot | `reset-pending.json` persists; the wipe applies on the next boot regardless of how the process died |
| Reset while runs are in flight | only *tracked* ffmpeg/ffprobe children are signalled (`packages/host/src/child-processes.ts:42-55`); an in-flight chat turn or embed job is simply cut off at exit. No coverage |
| Partial removal | per-entry errors are warned and skipped, and `dropMarker()` still runs (`packages/db/src/reset.ts:281`) — no retry, and the result still says applied |
| Reset on webdev | `relaunchDesktopApp` returns `{ok:false, reason:"unavailable"}`; the card shows `settings-reset-restart-needed`; the wipe lands when the dev server next restarts |

## Where things live

| File | Role |
|---|---|
| `packages/host/src/settings-store.ts` | The one encrypted store; `resolveSettingsWorkspaceId`, `sliceFor`, `clearGatewayKeyEverywhere`, `loadOwnerLocale` |
| `packages/host/src/workspace.ts` | `workspace-id.txt` read/write |
| `packages/host/src/tenant.ts` | `getTenant` — desk resolution, stamping, legacy adoption |
| `packages/host/src/handlers/settings.ts` | `settingsPayload`, GET/POST settings, gateway check, reset, cancel; `HOST_RESET_ENTRIES` |
| `packages/core/src/gateway/gate-types.ts` | The gate contract |
| `packages/host/src/gateway-gate.ts` | Derivation, verdict file, live check, `requireGatewayAllowed` |
| `packages/core/src/gateway/pinned.ts` | The pinned URL, its integrity hash, the dev-only override rule |
| `packages/core/src/secrets.ts` | `resolveProviderKeys`, `maskSecrets`, `resolveRuntimeMode` |
| `packages/core/src/security/fingerprint.ts` | `keyFingerprint` |
| `packages/db/src/reset.ts` | Marker write/validate, boot-time apply, symlink-safe removal |
| `packages/db/src/client.ts` | The one place the queued wipe is applied |
| `apps/web/lib/gateway-gate.ts` | Parse, `resolveGate`, `GATE_EVENT`, reason keys |
| `apps/web/src/App.tsx` | Holds gate state, listens for `GATE_EVENT` |
| `apps/web/components/settings-page.tsx`, `settings-reset-card.tsx` | The surface |
| `apps/desktop/main.cjs`, `lifecycle.cjs`, `navigation.cjs` | Relaunch, storage clear, sender trust |

## Gotchas

- **AGENTS.md's `resolveProviderKeys` precedence is Phase 1 design, not shipped code.** `AGENTS.md:70` describes "explicit workspace key (unless `allow_byo_key` is `false`) → live session access token → stub". At this sha there is no session token, no `StoredSession`, and no `allow_byo_key` anywhere in `packages/` or `apps/` — grep returns nothing outside `docs/internal/portal/` and `AGENTS.md` itself. Read the function, not the roadmap.
- **A "never checked yet" gate reports `status: "ok"`.** The upgrade branch and a persisted `stub`/`needs_key` verdict both derive as `ok` + `grace:true`; only `message: "Not checked yet."` and `checkedAt === null` reveal there is no real verdict. Do not read `status` alone as "we asked and it worked".
- **`invalid_key` is the only status with zero grace**, however recently the key worked. A rejection is an answer; unreachable is not.
- **Per-desk settings are one file.** Anything that reasons about "the desk's settings directory" is wrong.
- **`getTenant` reads and compares the settings file on every single request** because `adoptLegacySettings` is unconditional (`packages/host/src/tenant.ts:33`). It is a no-op once the legacy slice is gone, but it is not free.
- **A pasted key can quietly fill other providers' slots.** `reuseOpenAI` + `guessDialectFromKey` means one key field can populate the Anthropic, Google or Volcengine slot when the key *looks* like theirs.
- **`requireGatewayAllowed` re-derives from disk on every gated request** — there is no cached in-process decision.
- **The legacy-migration marker must survive a reset.** `legacy-migrated.json` is not in `HOST_RESET_ENTRIES` and this is load-bearing: `migrateLegacyUserData` (`apps/desktop/main.cjs:744-765`) treats "userData has no `agentforge.sqlite`" as a signal to copy an older install forward — exactly the state a fresh-install reset produces. Without the marker, the boot after "reset to a fresh install" would silently restore the forgotten key, every thread and all media.
- **`app.relaunch()` / `app.exit(0)`, not the Windows `taskkill /T` path**, because Electron's relauncher is a detached child that the tree-walk would kill (`apps/desktop/main.cjs:203-207`).
- **`POST /api/v1/settings/reset` also requires the transport header.** It is in `TRANSPORT_REQUIRED_PATHS` (`packages/host/src/http-adapter.ts:12`) on top of the loopback `Host` and `Origin` checks, so a cross-site HTML form POST cannot reach it.

## Verify

`.cursor/skills/verify-agentforge/features/settings.md` (Settings, keys, the reset card) plus `features/gateway-gate.md` once the verify-skill pass lands it. The recipe explicitly forbids clicking either reset submit on a real desk — drive it on webdev with a throwaway data dir.

Testids: `settings-gateway-status`, `settings-gateway-recheck`, `settings-gateway-grace`, `settings-gateway-reason` (`apps/web/components/settings-page.tsx:353`, `:362`, `:368`, `:373`); `key-fingerprint` (`:409`), `runtime-status` (`:292`), `settings-endpoint` (`:346`), `save-settings` (`:420`); the whole `settings-reset-*` family (`apps/web/components/settings-reset-card.tsx:159-303`), notably `settings-reset-key-submit`, `settings-reset-all-confirm-name`, `settings-reset-all-submit`, `settings-reset-pending`, `settings-reset-restart-needed`.

Unit tests that pin it: `packages/host/src/gateway-gate.test.ts` (every derivation branch, the 7-day boundary, key never leaked, endpoint pinned against an attacker-supplied `openaiBaseUrl`, throttle and TTL); `packages/host/src/handlers/settings.test.ts` (403 shape, ungated routes, the exact reset entry list); `packages/db/src/reset.test.ts` (marker validation, symlink/junction defences, `Local Storage/` preserved, atomic write); `packages/host/src/gateway-pin.test.ts`; `packages/host/src/settings-desk-scope.test.ts`; `packages/host/src/tenant.test.ts`; `apps/web/lib/reset-app.test.ts`; `apps/web/lib/gateway-gate.test.ts`.

## Why

**Why the gate is advisory and every rule fails open.** `[Direct]` `AGENTS.md:65`, written in the same commit that shipped the gate (`8831bc4`): "`allowed` is a UX signal — it decides what the desk shows and which local handlers answer `403 gateway_blocked`. It is not an entitlement check and must never be read as one. … the whole file is plain JSON in a directory the owner can edit, delete or replace. Anyone who wants past it can delete one file. That is the right trade for a local-first desk that has to keep working offline — and it is exactly why **the 20-seat entitlement, plan limits and any spend cap have to be enforced server-side, by the gateway and the licence service, against the bearer on the request.** … If a limit can be defeated by editing a local file, it was never enforced."

`[Supported]` The code agrees at every branch: missing or unreadable verdict opens (`packages/host/src/gateway-gate.ts:134-140`), an unwritable data dir costs a cached decision and nothing else (`:170-190`), the background re-check swallows its own failures (`:517-521`), and the stub runtime is always open (`:262-264`). **Confidence: high.** The design record is prose in `AGENTS.md`, not a commit body — `git log --oneline -20 -- packages/host/src/gateway-gate.ts packages/core/src/gateway/gate-types.ts` returns only `8831bc4` and `4db009a`, and `4db009a`'s message is about locale and layout, not the gate.

**Why sign-out clears the key on every desk rather than the current one.** `[Direct]` the comment at `packages/host/src/settings-store.ts:369-375`: a key left on a second desk would keep the gate open after "forget my key". **Confidence: high.**

**Why the fresh-install wipe is a named list and deferred to boot.** `[Direct]` two comments: `packages/host/src/handlers/settings.ts:270` — "Deliberately a named list, never the directory: in the packaged app this same folder is Electron's userData / Chromium profile, so `host-status.json`, `Local Storage/`, caches and cookies are not ours to delete"; and `:304` — "the database is open and ffmpeg may still be writing, so the wipe is queued for the next boot". `[Supported]` `packages/host/src/handlers/settings.test.ts:345-358` pins the list and asserts `host-status.json` is never in it. **Confidence: high.**

**Why the endpoint is pinned three ways at once.** `[Supported]` `resolvedGatewayBaseUrl()` ignores stored settings and `OPENAI_BASE_URL`; `gatewayUrlOverrideAllowed()` additionally requires non-packaged and non-production (`packages/core/src/gateway/pinned.ts:24-36`); `packages/core/src/gateway/pinned.test.ts` recomputes a SHA-256 of the literal to catch tampering; and `packages/host/src/gateway-pin.test.ts` bans raw reads repo-wide. `[Inferred]` the layering reads as defence in depth against three different failure shapes — a user-edited setting, a packaged build with a leftover dev env var, and a source edit — since each guard alone would miss one of them. No single source states this rationale. **Confidence: high for the mechanism, medium for the reading.**

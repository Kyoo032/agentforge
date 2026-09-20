# Map — Settings, the gateway gate, and Start over

> **Desktop is frozen at 0.14.27 — maintenance only.** The product continues as a hosted, multi-user web app.
> The host-decides/renderer-displays rule below is unchanged; the Electron-only transport and wipe details are frozen desktop behaviour.
> Decision record: [`web-pivot-2026-09-18.md`](../web-pivot-2026-09-18.md).

Last verified: 2026-09-20 at 69afca9

> The 2026-09-17 "hide the endpoint" change was verified in the working tree when this page was
> first written; it is committed as of `b482611`. `apps/web/components/settings-page.tsx`,
> `apps/web/components/onboarding-screen.tsx` and `apps/web/locales/{en,id}/{settings,onboarding}.json`
> all carry it. Every cite on this page is committed code.

## Overview

Three things that share one surface. **Settings per desk** is where the gateway key and per-workspace
preferences live, on disk, encrypted, keyed by workspace id. **The gateway gate** is the host's judgement
about whether that key currently works, cached as a verdict file and answered to the renderer as one
boolean. **Start over** is the two-scope escape hatch: forget the key, or wipe the desk back to a fresh
install.

The rule that ties them together: **the host decides, the renderer displays.** `allowed` is the only thing
the renderer branches on; it never re-derives a decision from `hasOpenai` or from key shape.

## How it works

### Settings per desk

Despite the name, there is **one encrypted file**, not a directory per desk: `<localDataDir()>/settings.enc`,
holding `{ version: 2, locale, workspaces: { [workspaceId]: StoredSecrets } }` — the type is `SettingsFileV2`
(`packages/host/src/settings-store.ts:117-121`). "Per desk" is a key in that map.

`loadSettings(workspaceId?)` / `saveSettings(patch, workspaceId?)` (`packages/host/src/settings-store.ts:325-342`)
resolve the desk through `resolveSettingsWorkspaceId` (`:185-191`): explicit id → `readSelectedWorkspaceId()`
→ `FALLBACK_SETTINGS_WORKSPACE`. `sliceFor()` (`:193-202`) picks that desk's slice, falling through to the
`LEGACY_SETTINGS_WORKSPACE` slice **only** when the resolved id is the fallback (`:198-199`).

The two sentinels are string constants, not magic literals scattered around:
`LEGACY_SETTINGS_WORKSPACE = "__legacy__"` (`:23`) and `FALLBACK_SETTINGS_WORKSPACE = "__default__"` (`:25`).
The literal `"__default__"` appears exactly once in the repo, at `:25`.

**`workspace-id.txt`** (`<localDataDir()>/workspace-id.txt`, `packages/host/src/workspace.ts:8-24`) is the
stamp that stops a request from landing in the fallback slice. `getTenant(preferredWorkspaceId)`
(`packages/host/src/tenant.ts:35-50`) calls `adoptLegacySettings(home.id)` on every call (`:42`), and — only
when the caller named no desk and nothing was on disk — writes the resolved desk id (`:46-48`). A desk named
by the per-request `WORKSPACE_COOKIE` is **never** promoted into the file (comment at `:15-17`), pinned by
`packages/host/src/tenant.test.ts:47-55`.

**The fallback-slice trap.** If a request resolves to `__default__` — e.g. a bare `loadSettings()` before the
stamp exists — it reads an orphan slice no real desk ever sees, so a key saved on the real desk looks absent
and the desk reports stub. The defence is a **source-grep test**:
`packages/host/src/settings-desk-scope.test.ts:18-88` fails the suite if any file under `packages/host/src`,
`apps/desktop` or `apps/web/server.ts` calls `loadSettings` with `()`/`undefined`/`null`/`""`, outside two
named exceptions (`studio-generate.ts`, `handlers/jobs.ts`, listed at `:22-23`).

**`settingsPayload()`** (`packages/host/src/handlers/settings.ts:85-122`) is what the renderer sees. Keys are
never in it: `maskSecrets` (`packages/core/src/secrets.ts:232-258`) emits booleans (`hasOpenai`, …) and
fingerprints (`sha256:` + the first 12 hex chars of SHA-256 over the trimmed secret,
`packages/core/src/security/fingerprint.ts:9-15`). `openaiBaseUrl` in the payload is always
`resolvedGatewayBaseUrl()`, never a stored value (`packages/core/src/secrets.ts:242-243`).

**What the owner can actually change on this page.** Two fields, and the POST body says so: the settings form
submits exactly `{ openaiApiKey, editTurnCapUsd }` (`apps/web/components/settings-page.tsx:189-197`, with the
comment "The endpoint is pinned by the host; never send it back"). The language `<select>` is a separate POST
of `{ locale }` (`:219-229`) — see [`locale-boot-and-run-harness.md`](locale-boot-and-run-harness.md). The Edit
turn cap (`settings-edit-turn-cap`, `:396`) is a number input clamped to 0.5–50 on the way in and again on the
way out (`:162-166`, `:388-395`), default 2.

**Key resolution.** `resolveProviderKeys(settings, env)` (`packages/core/src/secrets.ts:278-309`), today:

```
openai        = settings.openaiApiKey || env.OPENAI_API_KEY
openaiBaseUrl = resolvedGatewayBaseUrl()          // pinned, settings and env ignored
google        = settings.googleApiKey || env.GOOGLE_GENERATIVE_AI_API_KEY || reuseOpenAI("google")
anthropic     = settings.anthropicApiKey || env.ANTHROPIC_API_KEY || reuseOpenAI("anthropic")
volcengine    = settings.volcengineApiKey || env.ARK_API_KEY || env.VOLCENGINE_API_KEY || reuseOpenAI("volcengine")
```

`reuseOpenAI(dialect)` hands the OpenAI-slot key to another provider's slot when `guessDialectFromKey` says it
actually belongs there — i.e. someone pasted an Anthropic key into the one key field. Stub vs live is a separate
call, `resolveRuntimeMode({ settingsHasKey, envRuntime })` (`packages/core/src/secrets.ts:271-276`).

**Endpoint pinning.** `PINNED_GATEWAY_BASE_URL = "https://api.tokotokenai.com/v1"`
(`packages/core/src/gateway/pinned.ts:8`), with a SHA-256 of the literal checked by
`packages/core/src/gateway/pinned.test.ts`. The `AGENTFORGE_GATEWAY_URL` override needs
`gatewayUrlOverrideAllowed()` (`packages/core/src/gateway/pinned.ts:24-36`): not packaged **and**
`NODE_ENV !== "production"`. The **gateway-pin test** (`packages/host/src/gateway-pin.test.ts`) enforces this by
grep: the `ALLOWLIST` of permanent exceptions must stay empty; no file under `packages/host/src` or
`packages/core/src` may read `settings.openaiBaseUrl` outside `secrets.ts`/`settings-store.ts`; and
`handlers/settings.ts` must not match `/body\.openaiBaseUrl/`, so the settings POST cannot accept an endpoint
override at all.

**2026-09-17 — the endpoint is hidden, not merely read-only.** The Settings row (`settings-endpoint`, an
eight-line read-only block) and the onboarding field (`onboarding-endpoint`, a `readOnly` input) were deleted
from the renderer, together with the `settings.endpointLabel` / `settings.endpointLocked` /
`onboarding.endpointLabel` / `onboarding.endpointLocked` copy keys in both locales. What replaced them:

- Onboarding renders one muted line, `onboarding-gateway-host` → `onboarding.gatewayHost` = `"Gateway: {host}"`
  (`apps/web/components/onboarding-screen.tsx:130-132`), so the screen now has exactly one input — the key.
- Settings names the host in two places, both prose: the intro sentence
  (`settings.intro` … "Paste your {gatewayName} API key from {gatewayHost}", `settings-page.tsx:283-287`) and
  the privacy note (`settings.privacy` … "Prompts leave this machine only over HTTPS to {gatewayHost}",
  `:419-421`). The privacy string used to say "to the saved endpoint"; today it names
  `api.tokotokenai.com` out loud.
- Both call `gatewayHostLabel(gatewayEndpoint)` (`apps/web/lib/product-brand.tsx:25-31`) — `new URL(url).host`,
  falling back to the raw string — so the path and scheme never reach the screen.
- Guard: `apps/web/lib/gateway-endpoint-hidden.test.ts`, six cases — no `settings-endpoint`, no
  `onboarding-endpoint`, neither component hardcodes `tokotokenai` outside comments, neither references the
  retired copy keys, onboarding uses `onboarding.gatewayHost` and never `value={endpoint}`, and both locale
  catalogs carry `gatewayHost` with a `{host}` placeholder and no `endpointLabel`/`endpointLocked`.

Host and core logic are unchanged. This is a fourth, presentation-only layer on top of the three real pins.

**What a save does besides saving.** `handlePostSettings` (`packages/host/src/handlers/settings.ts:138-204`)
runs `saveSettings(patch, tenant.workspaceId)` and then four side effects, in order, so a corrected key or URL
takes effect on the next request instead of after a breaker expires:

| Call | Why |
|---|---|
| `clearThisKeyCache()` (`:165`) | the per-key usage strip is keyed on the old credential |
| `resetEmbedCircuit()` (`:168`) | the embeddings breaker holds a workspace down for five minutes |
| `resetJobModelCircuit()` (`:169`) | **added 2026-09-17** — the job-model fallback breaker skips a model for the same five minutes (`JOB_MODEL_DOWN_MS`, `packages/host/src/job-model-fallback.ts:25`), so a save that fixes the key must clear it too or the desk keeps routing around a model that now works |
| `revokeKnowledgeGatewayModel(...)` (`:170-173`) | the retrieval sidecar holds a *copy* of the key inside the model row it embeds with; a key changed here but left in that row has not been rotated |

`resetGatewayKey` runs the same two breaker resets on sign-out — see **Start over** below.

### The gateway gate

Contract: `packages/core/src/gateway/gate-types.ts` —
`{ status, allowed, grace, endpoint, endpointLocked: true, checkedAt, lastOkAt, message? }`, `status` in
`stub | needs_key | ok | invalid_key | unreachable | error`.

`reportGatewayGate(settings)` (`packages/host/src/gateway-gate.ts:384-398`) resolves the key to judge
(`keyFor`, `:371-381`), fingerprints it, loads the verdict from `<dataDir>/gateway-gate.json` (**the verdict is
keyed by fingerprint; the key itself is never written**), and hands both to the pure `deriveGatewayGate`
(`:270-319`), which applies in order:

| Condition | Result | Line |
|---|---|---|
| `envRuntime === "stub"`, off server mode | `{status:"stub", allowed:true, grace:false}` | `:278-280` |
| no key | `{status:"needs_key", allowed:false}` | `:281-283` |
| no verdict, or verdict for a different fingerprint | `{status:"ok", allowed:true, grace:true, message:"Not checked yet."}` — **opened on trust** (hosted server mode instead answers `error` / `allowed:false`) | `:296-298` |
| verdict `ok`, fresh (< `GATEWAY_OK_TTL_MS`) | `allowed:true, grace:false` | `:300-305` |
| verdict `ok`, stale | `allowed = withinGrace(lastOkAt, …)`, `grace:true` | `:306-307` |
| verdict `invalid_key` | `allowed:false, grace:false` — **no grace, ever** | `:310-312` |
| verdict `unreachable` / `error` | `allowed = withinGrace(…)`, and `grace` mirrors `allowed` | `:313-316` |
| persisted `stub` / `needs_key` verdict | treated as never-checked | `:317-318` |

Constants (`packages/host/src/gateway-gate.ts`): `GATEWAY_GRACE_MS = 7 * 86_400_000` (`:35`),
`GATEWAY_CHECK_TIMEOUT_MS = 3_000` (`:38`), `GATEWAY_OK_TTL_MS = 86_400_000` (`:44`),
`GATEWAY_REFRESH_THROTTLE_MS = 600_000` (`:47`), `GATEWAY_UNCHECKED_MESSAGE = "Not checked yet."` (`:50`),
`GATEWAY_VERDICT_UNWRITABLE_MESSAGE` (`:64`). The grace boundary is inclusive — exactly 7 days still counts
(`withinGrace`, `:248-251`, pinned at `packages/host/src/gateway-gate.test.ts:146-155`); the TTL check is
`withinOkTtl` (`:254-257`).

**The live check** is `checkGatewayLive` (`packages/host/src/gateway-gate.ts:334-364`): `GET {baseUrl}/models`
with `Authorization: Bearer <key>` under `AbortSignal.timeout(3_000)`, after `assertAllowedEndpointUrl` rejects
plain-HTTP remotes. 2xx → `ok`; 401/403 → `invalid_key` (message is `HTTP {status}`, the key is never echoed);
other non-OK → `error`; thrown/timeout → `unreachable`. `runGatewayCheck` (`:448-493`) wraps it: it
short-circuits on stub or no key (`:454-457`), maps a throw to `unreachable` (`:469-473`), carries `lastOkAt`
forward only for the same fingerprint (`:475`), persists, and — when the verdict could **not** be written —
answers `status: "error"` with `allowed` untouched (`:488-492`).

It runs on a key save (`refreshGatewayGateAfterSave` → `runGatewayCheck`,
`packages/host/src/handlers/settings.ts:241-256`, with `gateVerdictFor` at `:230-239` deciding which verdict the
save response carries) and on `POST /api/v1/settings/gateway/check` (`handleGatewayCheck`, `:258-266`, route at
`packages/host/src/router.ts:188`). Separately, `maybeRefreshGateway` (`packages/host/src/gateway-gate.ts:527-557`)
fires an un-awaited check at most once per key per 10 minutes from `handleGetSettings` — that is what turns
"opened on trust" into a real verdict over time.

**Enforcement.** `requireGatewayAllowed(settings)` (`packages/host/src/gateway-gate.ts:435-441`) throws
`GatewayBlockedError` when `!gate.allowed`, and `jsonError` flattens it (`packages/host/src/errors.ts:17-26`) to
`403 { error: "gateway_blocked", status, message }` — a flat body, deliberately not the usual
`{error:{code,message}}` envelope, so `parseGatewayBlocked` can read it without unwrapping. Call sites, all
verified at this sha: `handlers/runs.ts:31`; `handlers/jobs.ts:64, 102, 114, 125, 152, 163, 191, 203, 216, 228`;
`handlers/knowledge.ts:177, 194, 210, 259, 294, 316, 376, 409`; `handlers/finance.ts:18, 33, 53, 65, 76`;
`handlers/market.ts:30, 42, 56`; `handlers/edit.ts:326, 546`; `handlers/enhance-prompt.ts:49`;
`handlers/legal.ts:115`.

Deliberately **open**: settings, workspaces, threads, artifacts, media, usage, model refresh — proved by the
absence of the import in those handler files and directly by
`packages/host/src/handlers/settings.test.ts:186-192` ("does not gate settings, usage or threads"). A closed gate
must always be recoverable.

**What a closed gate actually looks like** (driven 2026-09-17 on an isolated desk started with
`AGENTFORGE_RUNTIME=ai` and no key; evidence in `evidence/gateway-gate/2026-09-17-cc-map/`):

- `GET /api/v1/settings` → `gateway: { status: "needs_key", allowed: false, grace: false, checkedAt: null }`.
- **Every** route of the SPA renders the onboarding screen, not just `/chat`: `/settings` answers with
  `onboarding-form` present and `settings-form` count 0. The only ways back are a key that validates, a re-check
  that succeeds, or deleting `gateway-gate.json` by hand.
- `POST /api/v1/finance/parse` → `403 {"error":"gateway_blocked","status":"needs_key","message":"No gateway key is saved on this machine."}`.
- After saving a deliberately invalid key: `status: "invalid_key"`, `allowed: false`, payload `message: "HTTP 401"`,
  and the same route answers `403 {… "status":"invalid_key","message":"The gateway rejected the saved key. HTTP 401"}`.
- Open routes with the gate closed, all `200`: `/api/v1/settings`, `/api/v1/threads`, `/api/v1/workspaces`,
  `/api/v1/usage`, `/api/v1/models`.

**Renderer.** `parseGatewayGate` (`apps/web/lib/gateway-gate.ts:56-75`) requires a known `status` and a boolean
`allowed` or returns `null`; `MISSING_GATEWAY_GATE` fails closed. `resolveGate(payload, isElectron, hosted)` (`:94-100`)
obeys a reported gate as-is, and on a missing or malformed one falls closed **under Electron and on a hosted build** — webdev and
Playwright keep working before the host answers. `App.tsx` holds `gate` / `gateway` / `localeEpoch` state
(`apps/web/src/App.tsx:76-78`), listens for `GATE_EVENT = "agentforge-gate"`
(`apps/web/lib/gateway-gate.ts:108`, listener at `App.tsx:89-97`), re-fetches settings and re-resolves on every
locale epoch (`:99-122`), and renders `OnboardingScreen` when `gate === "onboarding"` (`:139-140`). Reason copy
maps through `REASON_KEYS` (`apps/web/lib/gateway-gate.ts:123-127`) to
`onboarding.gate.invalidKey / unreachable / error`; the Settings status word maps through `gatewayStatusKey`
(`:135-137`) to `settings.gateway.status.<status>`.

### Start over

Card `settings-reset` (`apps/web/components/settings-reset-card.tsx:159`), mounted at
`apps/web/components/settings-page.tsx:424`, fed by `resetPending` on the settings payload.

**Sign out (`scope: "key"`)** — no typed confirmation, fully synchronous. `resetGatewayKey`
(`packages/host/src/handlers/settings.ts:309`) calls `clearGatewayKeyEverywhere()`
(`packages/host/src/settings-store.ts:371-386` — **machine-wide**, because "a key left on a second desk would
keep the gate open after 'forget my key'"), then `clearGateState()`, `clearThisKeyCache()`,
`resetEmbedCircuit()` and — added 2026-09-17 — `resetJobModelCircuit()` (`packages/host/src/handlers/settings.ts:318`). Returns `relaunch: false`. Threads, desks and media are untouched. The card navigates to
`/chat` and calls `announceGate(result.gateway)`, which dispatches `GATE_EVENT` and drops the shell to
onboarding.

**Fresh install (`scope: "all"`)** — typed `RESET` required. The button is disabled until
`typed.trim() === RESET_CONFIRM_WORD`, but what travels is **what the owner actually typed**
(`apps/web/components/settings-reset-card.tsx:134-136`), and the host re-checks it independently
(`packages/host/src/handlers/settings.ts:338-340`, 400 otherwise). Then
`requestDataReset(localDataDir(), [...HOST_RESET_ENTRIES])` (`:342`) writes the marker — nothing is deleted yet,
because "the database is open and ffmpeg may still be writing" (`:341`) — followed by `killTrackedChildren()`,
and the answer is `{ relaunch: true, resetPending: true }`.

The marker is `reset-pending.json` (`RESET_MARKER_FILE`, `packages/db/src/reset.ts:26`), written
temp-file-then-`renameSync` so a crash cannot leave a half-written marker that parses.

**The wipe list is named entries, never the directory** (`packages/host/src/handlers/settings.ts:274-293`),
because in the packaged app that same folder is Electron's userData / Chromium profile:

```
settings.enc  settings.json  .master-key  gateway-gate.json  media
workspace-id.txt  desk-usage.json  datasets  edit  legal
models-cache.json  models-dev-cache.json  components  logs
```

plus, always, `SQLITE_ENTRIES` — `agentforge.sqlite`, `-wal`, `-shm` (`packages/db/src/reset.ts:29`), which
`applyPendingDataReset` unions onto the marker's own list at `packages/db/src/reset.ts:270` ("the SQLite trio is
added by `applyPendingDataReset`, because `@agentforge/db` owns it",
`packages/host/src/handlers/settings.ts:271-272`), and, when `DATABASE_URL` points out of tree, that trio by
absolute path (`packages/db/src/reset.ts:188-242`). Pinned exactly by
`packages/host/src/handlers/settings.test.ts:365-382`, which also asserts `host-status.json` and anything
containing "storage" never appear (`:384-385`). Preserved: `host-status.json`, `Local Storage/`, every other
Chromium artifact, and `legacy-migrated.json`.

**Applied at boot, before SQLite opens.** `packages/db/src/client.ts:35-37` — when
`AGENTFORGE_APPLY_PENDING_RESET === "1"` and no connection exists, `applyPendingDataReset(localDataDir())` runs
at module top level, two lines before `new SqliteDatabase(file)`. That env flag is set in exactly two places:
`apps/web/server-env.ts:14` (webdev) and `apps/desktop/main.cjs:631` inside `bootstrapPackaged()`, before
`require("./host.cjs")` — so a test or script that imports `@agentforge/db` can never trigger a wipe as a side
effect.

**Relaunch.** `relaunchDesktopApp({reset:true})` → preload `relaunch` → `ipcMain.handle("app:relaunch", …)`
(`apps/desktop/main.cjs:533`), which first checks `isTrustedSender(event, mainWindow)`
(`apps/desktop/navigation.cjs:109`) and refuses a non-main-frame sender with `{ok:false, reason:"forbidden"}`.
`relaunchApp(true)` (`apps/desktop/main.cjs:212-241`) consults `lifecycle.relaunchPlan()` (refuses while
installing an update or already exiting), races `clearRendererState()` — `clearStorageData` + `clearCache` +
`clearAuthCache` + `clearCodeCaches` (`:181-193`) — against `CLEAR_STORAGE_TIMEOUT_MS = 3000`, then
`app.relaunch()` and `app.exit(0)`.

### Failure modes

| Case | Behaviour |
|---|---|
| `gateway-gate.json` missing, unreadable, or not JSON | `loadGateState` returns `null` (`packages/host/src/gateway-gate.ts:138-162`) → opens on trust |
| Verdict cannot be written | `saveGateState` warns and returns `{persisted:false}` (`:173-197`, warn at `:184-196`); `runGatewayCheck` then answers `status:"error"` with `allowed` as derived (`:488-492`) — "an unwritable data dir must not close a desk" |
| Live check throws / times out | mapped to `unreachable` (`:469-473`), never thrown |
| Background re-check throws | swallowed (`:549-555`); the un-awaited promise also carries its own `.catch` (`:552`) |
| Save with an empty key string | `clearGateState()` and no check at all (`packages/host/src/handlers/settings.ts:248-251`) |
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
| `packages/host/src/handlers/settings.ts` | `settingsPayload`, GET/POST settings, `gateVerdictFor`, `refreshGatewayGateAfterSave`, `handleGatewayCheck`, reset, cancel; `HOST_RESET_ENTRIES` |
| `packages/core/src/gateway/gate-types.ts` | The gate contract |
| `packages/host/src/gateway-gate.ts` | Derivation, verdict file, live check, `requireGatewayAllowed`, background refresh |
| `packages/core/src/gateway/pinned.ts` | The pinned URL, its integrity hash, the dev-only override rule |
| `packages/core/src/secrets.ts` | `resolveProviderKeys`, `maskSecrets`, `resolveRuntimeMode` |
| `packages/core/src/security/fingerprint.ts` | `keyFingerprint` |
| `packages/db/src/reset.ts` | Marker write/validate, boot-time apply, symlink-safe removal |
| `packages/db/src/client.ts` | The one place the queued wipe is applied |
| `apps/web/lib/gateway-gate.ts` | Parse, `resolveGate`, `GATE_EVENT`, reason and status keys, `parseGatewayBlocked`, `formatGateTimestamp` |
| `apps/web/lib/product-brand.tsx` | `gatewayHostLabel` — the pinned URL reduced to a host for display |
| `apps/web/src/App.tsx` | Holds gate state, listens for `GATE_EVENT`, renders onboarding |
| `apps/web/components/settings-page.tsx`, `settings-reset-card.tsx`, `onboarding-screen.tsx` | The surface |
| `apps/desktop/main.cjs`, `lifecycle.cjs`, `navigation.cjs` | Relaunch, storage clear, sender trust |

## Gotchas

- **AGENTS.md's `resolveProviderKeys` precedence is Phase 1 design, not shipped code.** `AGENTS.md:77`
  describes "explicit workspace key (unless `allow_byo_key` is `false`) → live session access token → stub". At
  this sha there is no session token, no `StoredSession`, and no `allow_byo_key` anywhere in `packages/` or
  `apps/` — grep returns nothing outside `docs/internal/portal/` and `AGENTS.md` itself. Read the function, not
  the roadmap.
- **A "never checked yet" gate reports `status: "ok"`.** The upgrade branch and a persisted `stub`/`needs_key`
  verdict both derive as `ok` + `grace:true`; only `message: "Not checked yet."` and `checkedAt === null` reveal
  there is no real verdict. Do not read `status` alone as "we asked and it worked".
- **A stub desk's status row carries no timestamp.** `settings-gateway-status` renders the status word, then
  `Last checked` **only when `checkedAt` is non-null** (`apps/web/components/settings-page.tsx:344-357`). On
  `stub`, `needs_key` and never-checked desks the row is just the word and the Re-check link — driven on the
  owner's desk on 2026-09-17, where it read "Demo luring · Periksa ulang".
- **`invalid_key` is the only status with zero grace**, however recently the key worked. A rejection is an
  answer; unreachable is not.
- **Per-desk settings are one file.** Anything that reasons about "the desk's settings directory" is wrong.
- **`getTenant` reads and compares the settings file on every single request** because `adoptLegacySettings` is
  unconditional (`packages/host/src/tenant.ts:42`). It is a no-op once the legacy slice is gone, but it is not
  free.
- **A pasted key can quietly fill other providers' slots.** `reuseOpenAI` + `guessDialectFromKey` means one key
  field can populate the Anthropic, Google or Volcengine slot when the key *looks* like theirs.
- **`requireGatewayAllowed` re-derives from disk on every gated request** — there is no cached in-process
  decision.
- **Not every gated route checks the gate first.** `handlers/enhance-prompt.ts:49` validates the body before it
  calls `requireGatewayAllowed`, so an empty-body probe of that route answers `400 empty_input` even on a fully
  closed desk. Use a route that gates on entry (`finance/parse`, `runs/text`) when you want to prove the 403.
- **This checkout pins stub.** Both `.env` and `apps/web/.env.local` set `AGENTFORGE_RUNTIME=stub`, and the first
  branch of `deriveGatewayGate` short-circuits on it, so **no** locally started webdev can show a closed gate
  unless it is started with an explicit `AGENTFORGE_RUNTIME=ai` (and no key, for `needs_key`).
- **A closed gate hides Settings too.** `App.tsx` swaps the whole router for `OnboardingScreen`, so there is no
  route to the key field, the reset card or the status row while `allowed` is false. Recovery is onboarding's
  own key input, its Re-check, or deleting `gateway-gate.json`.
- **The legacy-migration marker must survive a reset.** `legacy-migrated.json` is not in `HOST_RESET_ENTRIES`
  and this is load-bearing: `migrateLegacyUserData` (`apps/desktop/main.cjs:744-765`) treats "userData has no
  `agentforge.sqlite`" as a signal to copy an older install forward — exactly the state a fresh-install reset
  produces. Without the marker, the boot after "reset to a fresh install" would silently restore the forgotten
  key, every thread and all media.
- **`app.relaunch()` / `app.exit(0)`, not the Windows `taskkill /T` path**, because Electron's relauncher is a
  detached child that the tree-walk would kill (`apps/desktop/main.cjs:203-207`).
- **`POST /api/v1/settings/reset` also requires the transport header.** It is in `TRANSPORT_REQUIRED_PATHS`
  (`packages/host/src/http-adapter.ts:24`) on top of the loopback `Host` and `Origin` checks, so a cross-site
  HTML form POST cannot reach it. The IPC-only transport and the loopback-only `Host` / `Origin` allowlist are
  **(desktop, frozen)**: on the hosted web app the same host gate runs behind the HTTP adapter
  (`packages/host/src/http-adapter.ts:516-544`). The loopback check **became** a trusted-origin allowlist plus a
  double-submit CSRF token in Phase 1 ([PR #56](https://github.com/Kyoo032/agentforge/pull/56), commit
  `6ae177a`): `isAllowedWebOrigin` / `isAllowedWebHostHeader` (`local-request.ts:99,113`) and
  `packages/host/src/csrf.ts`, reached only under `isServerMode()`.

## Verify

`.cursor/skills/verify-agentforge/features/settings.md` (Settings, keys, the Edit turn cap, the reset card) and
`.cursor/skills/verify-agentforge/features/gateway-gate.md` (the gate itself), plus
`features/security.md` for `key-fingerprint` and `privacy-note`. The recipes forbid typing into `openai-key` or
clicking either reset submit on a desk you do not own — drive the closed gate and the wipe on your own webdev
with a throwaway `AGENTFORGE_DATA_DIR`.

Testids and their lines (`apps/web/components/settings-page.tsx` unless noted):
`runtime-status` `:290`, `settings-locale` `:313`, `settings-locale-restart` `:321`,
`settings-locale-restart-button` `:326`, `settings-form` `:336`, `settings-gateway-status` `:344`,
`settings-gateway-recheck` `:353`, `settings-gateway-grace` `:359`, `settings-gateway-reason` `:364`,
`openai-key` `:377`, `settings-edit-turn-cap` `:396`, `key-fingerprint` `:400`, `save-settings` `:411`,
`privacy-note` `:419`; the whole `settings-reset-*` family in
`apps/web/components/settings-reset-card.tsx:159-303`, notably `settings-reset-key-submit` `:215`,
`settings-reset-all-confirm-name` `:258`, `settings-reset-all-submit` `:265`, `settings-reset-pending` `:167`,
`settings-reset-restart-needed` `:296`; onboarding in `apps/web/components/onboarding-screen.tsx`:
`onboarding-setup-check` `:115`, `onboarding-form` `:129`, `onboarding-gateway-host` `:130`,
`onboarding-gate-reason` `:134`, `onboarding-key` `:147`, `onboarding-continue` `:156`, `onboarding-recheck`
`:166`. **`settings-endpoint`, `settings-endpoint-reset`, `openai-base-url` and `onboarding-endpoint` must all
have count 0**; finding any of them is a regression.

Unit tests that pin it: `packages/host/src/gateway-gate.test.ts` (every derivation branch, the 7-day boundary,
key never leaked, endpoint pinned against an attacker-supplied `openaiBaseUrl`, throttle and TTL);
`packages/host/src/handlers/settings.test.ts` (403 shape, ungated routes, the exact reset entry list);
`packages/db/src/reset.test.ts` (marker validation, symlink/junction defences, `Local Storage/` preserved,
atomic write); `packages/host/src/gateway-pin.test.ts`; `apps/web/lib/gateway-endpoint-hidden.test.ts`;
`packages/host/src/settings-desk-scope.test.ts`; `packages/host/src/tenant.test.ts`;
`apps/web/lib/reset-app.test.ts`; `apps/web/lib/gateway-gate.test.ts`.

## Why

**Why the gate is advisory and every rule fails open.** `[Direct]` `AGENTS.md:72`, written in the same commit
that shipped the gate (`8831bc4`): "`allowed` is a UX signal — it decides what the desk shows and which local
handlers answer `403 gateway_blocked`. It is not an entitlement check and must never be read as one. … the whole
file is plain JSON in a directory the owner can edit, delete or replace. Anyone who wants past it can delete one
file. That is the right trade for a local-first desk that has to keep working offline — and it is exactly why
**the 20-seat entitlement, plan limits and any spend cap have to be enforced server-side, by the gateway and the
licence service, against the bearer on the request.** … If a limit can be defeated by editing a local file, it
was never enforced."

`[Supported]` The code agrees at every branch: missing or unreadable verdict opens
(`packages/host/src/gateway-gate.ts:138-162`), an unwritable data dir costs a cached decision and nothing else
(`:173-197`, `:488-492`), the background re-check swallows its own failures (`:549-555`), and the stub runtime is
always open (`:278-280`). **Confidence: high.** The design record is prose in `AGENTS.md`, not a commit body —
`git log --oneline -20 -- packages/host/src/gateway-gate.ts packages/core/src/gateway/gate-types.ts` returns only
`8831bc4` and `4db009a`, and `4db009a`'s message is about locale and layout, not the gate.

**Why sign-out clears the key on every desk rather than the current one.** `[Direct]` the comment at
`packages/host/src/settings-store.ts:369-375`: a key left on a second desk would keep the gate open after "forget
my key". **Confidence: high.**

**Why the fresh-install wipe is a named list and deferred to boot.** `[Direct]` two comments:
`packages/host/src/handlers/settings.ts:268-273` — "Deliberately a named list, never the directory: in the packaged
app this same folder is Electron's userData / Chromium profile, so `host-status.json`, `Local Storage/`, caches
and cookies are not ours to delete"; and `:341` — "the database is open and ffmpeg may still be writing, so the
wipe is queued for the next boot". `[Supported]` `packages/host/src/handlers/settings.test.ts:365-385` pins the
list and asserts `host-status.json` is never in it. **Confidence: high.**

**Why the endpoint is pinned three ways at once, and hidden as a fourth.** `[Supported]`
`resolvedGatewayBaseUrl()` ignores stored settings and `OPENAI_BASE_URL`; `gatewayUrlOverrideAllowed()`
additionally requires non-packaged and non-production (`packages/core/src/gateway/pinned.ts:24-36`);
`packages/core/src/gateway/pinned.test.ts` recomputes a SHA-256 of the literal to catch tampering; and
`packages/host/src/gateway-pin.test.ts` bans raw reads repo-wide. `[Inferred]` the layering reads as defence in
depth against three different failure shapes — a user-edited setting, a packaged build with a leftover dev env
var, and a source edit — since each guard alone would miss one of them. No single source states this rationale.
**Confidence: high for the mechanism, medium for the reading.** `[Direct]` **2026-09-17** adds a fourth, weaker
layer that is presentation rather than enforcement: the endpoint row is hidden from Settings and onboarding, and
the guard test says why in its own header — "hidden from the UI entirely: neither Settings nor onboarding renders
it, and no field may look editable. This is a grep rather than a render test because the renderer has no DOM test
setup — what matters is that a future edit cannot quietly put the URL back on screen"
(`apps/web/lib/gateway-endpoint-hidden.test.ts:6-11`). It stops a support question, not an attack — the three
real guards are unchanged.

# Map — Settings, the gateway gate, and Start over

> **Two products, one repo.** **Personal** is the Mac/Windows DPSBuddy app (current cut `0.15.0`); **Enterprise** is the hosted web app.
> The host-decides/renderer-displays rule below is unchanged and applies to both; the Electron-only transport and wipe details are the Personal app's.
> Decision record: [`web-pivot-2026-09-18.md`](../web-pivot-2026-09-18.md).

Last verified: 2026-09-23 at d4561b8 + uncommitted tree for Start over (a wipe that fails part-way is now
retried, and the boot log line), the Settings page's load / save / language failures, and every
`settings-page.tsx` line cited on this page. Not driven: the reset change is in `@agentforge/db`, which only a
restart of `:3000` or a packed app picks up.

Before that: 2026-09-23 at 775d16f + working tree (finding 1 of the 0.15.0 verify pass). Changed here: a new desk starts with a copy of the creating desk's gateway key (`inheritGatewayKey`, `packages/host/src/handlers/workspaces.ts:33-39`), and the onboarding screen lists the other desks (`onboarding-desks`) so a keyless desk is never a dead end — see "Settings per desk" below. The gate's derivation is untouched.

Before that: 2026-09-23 at 0774681 + working tree (the 0.15.0 design pass). Changed there: `settings.kicker` is deleted, `settings.runtimeStub` and `settings.gateway.status.stub` no longer claim "Offline demo" (stub means *no key saved*, not a demo), and `settings.intro` was trimmed. The gate's derivation, `resolveGate`, the reset scopes and the endpoint-hiding rule are all untouched. **The sign-out → onboarding behaviour is verified in the packaged personal app, not on webdev**: `deriveGatewayGate` short-circuits `envRuntime === "stub"` to `allowed: true` before it looks at whether a key exists (`packages/host/src/gateway-gate.ts:293-296`), and both `.env` and `apps/web/.env.local` pin `stub` on a dev machine — `apps/desktop/main.cjs` never sets it, so a packaged app derives `needs_key` and sign-out does drop to onboarding.

Supersedes the 2026-09-22 note, which recorded the opposite `stub` copy: `chat-key-status` used to read "Model key connected (offline demo)" on a keyless desk. That string is gone from both catalogs; `stub` now reads as a missing key.

Last verified before that projection: 2026-09-20 at a053245 + the Phase 4 branch `feat/web-phase4-tenant-secrets-rcbu9c` (through e37b3a1)

> The 2026-09-17 "hide the endpoint" change was verified in the working tree when this page was
> first written; it is committed as of `b482611`. `apps/web/components/settings-page.tsx`,
> `apps/web/components/onboarding-screen.tsx` and `apps/web/locales/{en,id}/{settings,onboarding}.json`
> all carry it. Every cite on this page is committed code.

## Overview

Three things that share one surface. **Settings per desk** is where the gateway key and per-workspace
preferences live, encrypted, keyed by workspace id inside a payload keyed by tenant — on disk on a desk,
in a `tenant_state` row on the hosted server ([`tenant-secrets-backend.md`](tenant-secrets-backend.md)). **The gateway gate** is the host's judgement
about whether that key currently works, cached as a verdict file and answered to the renderer as one
boolean. **Start over** is the two-scope escape hatch: forget the key, or wipe the desk back to a fresh
install.

The rule that ties them together: **the host decides, the renderer displays.** `allowed` is the only thing
the renderer branches on; it never re-derives a decision from `hasOpenai` or from key shape.

## How it works

### Settings per desk

**One sealed payload per tenant, one slice per desk inside it.** Phase 3 lane D split the payload per
tenant; Phase 4 moved it behind a backend. The payload itself is unchanged in either: an AES-256-GCM
envelope holding `{ version: 2, locale, users, workspaces: { [workspaceId]: StoredSecrets } }` — the type is
`SettingsFileV2` (`packages/host/src/settings-store.ts:186-197`). "Per desk" is a key in `workspaces`;
"per tenant" is which payload.

**Where that payload lives is decided by mode, never by tenant** — `tenantStateBackend()`
(`packages/host/src/tenant-state-store.ts:281-283`). Off server mode it is lane D's file, at exactly lane D's
path: `<localDataDir()>/settings.enc` for `local-tenant` and `<localDataDir()>/tenants/<tenantId>/settings.enc`
for anyone else (`TENANT_STATE_FILENAMES`, `packages/host/src/tenant-state-store.ts:48-51`; see
[`tenant-storage.md`](tenant-storage.md) for why the local tenant keeps the bare path). In server mode it is a
`tenant_state` row and no file is written at all. The whole of that story is
[`tenant-secrets-backend.md`](tenant-secrets-backend.md); this page assumes it and carries on.

`loadSettings(scope?)` / `saveSettings(patch, scope?)` (`packages/host/src/settings-store.ts:469-487`) take a
`SettingsScope` (`:41`): a `TenantContext`, or a bare desk id. `resolveSettingsScope` (`:45-58`) turns either
into `{ tenantId, workspaceId }` — and a bare desk id **throws `tenant_required` in server mode**, because a
hosted call that cannot name its tenant must not fall back to the local tenant's payload. The desk half still
goes through `resolveSettingsWorkspaceId` (`:293-299`): explicit id → `readSelectedWorkspaceId()` →
`FALLBACK_SETTINGS_WORKSPACE`. `sliceFor()` (`:301-310`) picks that desk's slice, falling through to the
`LEGACY_SETTINGS_WORKSPACE` slice **only** when the resolved id is the fallback (`:306-307`).

The two sentinels are string constants, not magic literals scattered around:
`LEGACY_SETTINGS_WORKSPACE = "__legacy__"` (`:28`) and `FALLBACK_SETTINGS_WORKSPACE = "__default__"` (`:30`).
The literal `"__default__"` appears exactly once in the repo, at `:30`.

**The UI locale is not in a desk slice and is not the tenant's either.** Phase 4 made it per *user*:
`loadUserLocale(scope)` / `saveUserLocale(scope, locale)` (`:582-592`, `:598-616`) take a `UserScope` —
tenant, desk **and** user — and read or write `users[userId].locale` inside the same sealed payload.
`loadOwnerLocale` / `saveOwnerLocale` (`:564-566`, `:568-572`) remain the *install's* locale, which is what
`getBootLocale()` freezes. See [`locale-boot-and-run-harness.md`](locale-boot-and-run-harness.md).

**A new desk inherits the gateway key.** Keys stay per desk, but `handlePostWorkspaces` copies the creating desk's `openaiApiKey` into the new desk's slice before it selects the new desk (`packages/host/src/handlers/workspaces.ts:33-39`, `:99-100`). Without it, creating a desk on a keyed install selected an empty slice, the gate derived `needs_key` / `allowed: false`, and `App` replaced the shell with the key form everywhere (finding 1 of the 0.15.0 verify pass). No verdict is copied because none needs to be: the verdict is the tenant's and keyed by fingerprint. Only the gateway key moves — extras stay empty — and `clearGatewayKeyEverywhere` still clears the copy. Pinned by `packages/host/src/handlers/workspaces.test.ts`. The renderer's guard for desks that are still keyless: `OnboardingDesks` under the key form (`apps/web/components/onboarding-screen.tsx:196`), which selects another desk on the host and applies the gate the host reports for it (`apps/web/lib/onboarding-desks.ts:60-68`). The host still decides; the renderer only offers the desks.

**`workspace-id.txt`** (`<localDataDir()>/workspace-id.txt`, `packages/host/src/workspace.ts:19-41`) is the
stamp that stops a request from landing in the fallback slice. `getTenant(preferredWorkspaceId)`
(`packages/host/src/tenant.ts:88-103`) reaches `resolveLocalOwner` (`:117-132`) off the hosted path, which calls `adoptLegacySettings(home.id)` on every call (`:124`), and — only
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
never in it: `maskSecrets` (`packages/core/src/secrets.ts:251-280`) emits booleans (`hasOpenai`, …) and
fingerprints (`sha256:` + the first 12 hex chars of SHA-256 over the trimmed secret,
`packages/core/src/security/fingerprint.ts:9-15`). `openaiBaseUrl` in the payload is always
`resolvedGatewayBaseUrl()`, never a stored value (`packages/core/src/secrets.ts:263-264`).

**What the owner can actually change on this page.** Two fields, and the POST body says so: the settings form
submits exactly `{ openaiApiKey, editTurnCapUsd }` (`apps/web/components/settings-page.tsx:261-273`, with the
comment "The endpoint is pinned by the host; never send it back"). The language `<select>` is a separate POST
of `{ locale }` (`:302-312`) — see [`locale-boot-and-run-harness.md`](locale-boot-and-run-harness.md). The Edit
turn cap (`settings-edit-turn-cap`, `:496`) is a number input clamped to 0.5–50 on the way in and again on the
way out (`:214-215`, `:494`), default 2.

**Every settings request says when it did not land (2026-09-23).** All four — the first load, Save, the
language select and the Restart apply — go through `readSettingsAnswer` (`settings-page.tsx:99`), which never
throws: a request that did not come back, a non-JSON error page and an error body all become a sentence (the
host's own message when it sent one, the catalog's otherwise), and a closed gate becomes its reason. A failed
first load used to leave the page's defaults on screen as though they were this desk's settings; it now shows
`settings-load-error` (`:379`). A failed Save shows `settings-error` (`:505`). A failed language change used to
leave the select on the new language as if it had been saved; it now reverts the select and shows
`settings-locale-error` (`:416`), and the select is disabled while the change is in flight.

**Key resolution.** `resolveProviderKeys(settings, env)` (`packages/core/src/secrets.ts:307-319` for the signature, the body through `:345`), today — where `env` is not the process environment directly but `providerEnv(env)` (`packages/core/src/server-mode.ts:43-45`, with the rule written out at `:22-42`), which is `env` unchanged on a desk and a **frozen empty object** in server mode. That is Phase 4's change, and it is shared: the same helper backs the tool secret scope (`packages/core/src/tools/credentials.ts:308-312`), the runtime's per-provider fallback (`packages/core/src/runtime/ai-sdk-runtime.ts:163-174`), the tool scope a run executes in (`getSecret`, `packages/core/src/tools/secret-scope.ts:36-44` — the fallback every platform tool uses when its scope lacks a key, and the one a named sweep cannot see because its index is a variable) and, indirectly, Edit's off-request transcription (`packages/host/src/edit/asr.ts:79-87`, which asks `resolveProviderKeys` rather than the environment). `packages/core/src/provider-env-sweep.test.ts` fails the build if any other shipped source reads one of these variables off `process.env`, indexes it dynamically without an allowlisted exception, or destructures a credential out of it:

```
openai        = settings.openaiApiKey || env.OPENAI_API_KEY
openaiBaseUrl = resolvedGatewayBaseUrl()          // pinned, settings and env ignored
google        = settings.googleApiKey || env.GOOGLE_GENERATIVE_AI_API_KEY || reuseOpenAI("google")
anthropic     = settings.anthropicApiKey || env.ANTHROPIC_API_KEY || reuseOpenAI("anthropic")
volcengine    = settings.volcengineApiKey || env.ARK_API_KEY || env.VOLCENGINE_API_KEY || reuseOpenAI("volcengine")
```

`reuseOpenAI(dialect)` hands the OpenAI-slot key to another provider's slot when `guessDialectFromKey` says it
actually belongs there — i.e. someone pasted an Anthropic key into the one key field. Stub vs live is a separate
call, `resolveRuntimeMode({ settingsHasKey, envRuntime })` (`packages/core/src/secrets.ts:293-298`).

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
  (`settings.intro` … "Paste your {gatewayName} API key from {gatewayHost}", `settings-page.tsx:371-375`) and
  the privacy note (`settings.privacy` … "Prompts leave this machine only over HTTPS to {gatewayHost}",
  `:523-525`). The privacy string used to say "to the saved endpoint"; today it names
  `api.tokotokenai.com` out loud.
- Both call `gatewayHostLabel(gatewayEndpoint)` (`apps/web/lib/product-brand.tsx:25-31`) — `new URL(url).host`,
  falling back to the raw string — so the path and scheme never reach the screen.
- Guard: `apps/web/lib/gateway-endpoint-hidden.test.ts`, six cases — no `settings-endpoint`, no
  `onboarding-endpoint`, neither component hardcodes `tokotokenai` outside comments, neither references the
  retired copy keys, onboarding uses `onboarding.gatewayHost` and never `value={endpoint}`, and both locale
  catalogs carry `gatewayHost` with a `{host}` placeholder and no `endpointLabel`/`endpointLocked`.

Host and core logic are unchanged. This is a fourth, presentation-only layer on top of the three real pins.

**What a save does besides saving.** `handlePostSettings` (`packages/host/src/handlers/settings.ts:207-281`)
runs `saveSettings(patch, tenant)` and then four side effects, in order, so a corrected key or URL
takes effect on the next request instead of after a breaker expires:

| Call | Why |
|---|---|
| `clearThisKeyCache()` (`:244`) | the per-key usage strip is keyed on the old credential |
| `resetEmbedCircuit()` (`:247`) | the embeddings breaker holds a workspace down for five minutes |
| `resetJobModelCircuit()` (`:248`) | **added 2026-09-17** — the job-model fallback breaker skips a model for the same five minutes (`JOB_MODEL_DOWN_MS`, `packages/host/src/job-model-fallback.ts:25`), so a save that fixes the key must clear it too or the desk keeps routing around a model that now works |
| `revokeKnowledgeGatewayModel(...)` (`:252`) | the retrieval sidecar holds a *copy* of the key inside the model row it embeds with; a key changed here but left in that row has not been rotated |

`resetGatewayKey` runs the same two breaker resets on sign-out — see **Start over** below.

### The gateway gate

Contract: `packages/core/src/gateway/gate-types.ts` —
`{ status, allowed, grace, endpoint, endpointLocked: true, checkedAt, lastOkAt, message? }`, `status` in
`stub | needs_key | ok | invalid_key | unreachable | error`.

`reportGatewayGate(settings)` (`packages/host/src/gateway-gate.ts:410-424`) resolves the key to judge
(`keyFor`, `:395-405`), fingerprints it, loads that tenant's verdict (`loadGateState`, `:157-187` — **the
verdict is keyed by fingerprint; the key itself is never written**), and hands both to the pure
`deriveGatewayGate` (`:283-332`), which applies in order:

| Condition | Result | Line |
|---|---|---|
| `envRuntime === "stub"`, off server mode | `{status:"stub", allowed:true, grace:false}` | `:291-293` |
| no key, or `stub` runtime on the server | `{status:"needs_key", allowed:false}` | `:294-296` |
| no verdict, or verdict for a different fingerprint | `{status:"ok", allowed:true, grace:true, message:"Not checked yet."}` — **opened on trust** (hosted server mode instead answers `error` / `allowed:false`, `:301-303`) | `:309-311` |
| verdict `ok`, fresh (< `GATEWAY_OK_TTL_MS`) | `allowed:true, grace:false` | `:313-318` |
| verdict `ok`, stale | `allowed = withinGrace(lastOkAt, …)`, `grace:true` | `:319-320` |
| verdict `invalid_key` | `allowed:false, grace:false` — **no grace, ever** | `:323-325` |
| verdict `unreachable` / `error` | `allowed = withinGrace(…)`, and `grace` mirrors `allowed` | `:326-329` |
| persisted `stub` / `needs_key` verdict | treated as never-checked | `:330-331` |

**Phase 4 changed two things here, both about the hosted server rather than the desk.**

- **The verdict moved behind a backend.** `statePath(tenantId)` is gone. `loadGateState`, `saveGateState`
  and `clearGateState` (`:157-187`, `:198-213`, `:215-221`) go through `tenantStateBackend()`
  (`packages/host/src/tenant-state-store.ts:319-321`) under the key
  `gateway_gate` (`packages/core/src/tenancy/state-keys.ts:14`). On a desk that resolves
  to exactly lane D's file — `<dataDir>/gateway-gate.json` for `local-tenant`, under `tenants/<tenantId>/`
  otherwise, which is what stops two tenants overwriting each other's verdict — because the file backend
  maps the key back through `TENANT_STATE_FILENAMES` (`:48-51`), the one place in the host that may spell
  those filenames. On the server it is a row in `tenant_state`. See
  [`tenant-secrets-backend.md`](tenant-secrets-backend.md).
- **`keyFor` refuses the process environment in server mode** (`:395-405`). A saved key is still the key.
  But with none saved, an `OPENAI_API_KEY` in the host's own environment belongs to the **operator**, and
  handing it to a tenant who has saved nothing is residual A01-3. The gate now answers `needs_key` there,
  which is what `resolveProviderKeys` does on the call path (`packages/core/src/secrets.ts:307-319`,
  the fallback taken from `providerEnv` at `:306`), so the verdict and the call agree about
  whether this tenant has a key at all. Off server mode nothing moved: a
  desk running `AGENTFORGE_RUNTIME=ai` with a key in its environment still works exactly as before.
  The gate is only half of it, though: it can only protect work that happens **inside a request**.
  Edit's auto-captions run on the timeline worker afterwards, where there is no request to answer
  `403` to, which is why `edit/asr.ts` resolving its own bearer mattered rather than being tidiness
  — see [`tenant-secrets-backend.md`](tenant-secrets-backend.md).

Constants (`packages/host/src/gateway-gate.ts`): `GATEWAY_GRACE_MS = 7 * 86_400_000` (`:40`),
`GATEWAY_CHECK_TIMEOUT_MS = 3_000` (`:43`), `GATEWAY_OK_TTL_MS = 86_400_000` (`:49`),
`GATEWAY_REFRESH_THROTTLE_MS = 600_000` (`:52`), `GATEWAY_UNCHECKED_MESSAGE = "Not checked yet."` (`:55`),
`GATEWAY_UNVERIFIED_MESSAGE` (`:62`), `GATEWAY_VERDICT_UNWRITABLE_MESSAGE` (`:69`). The grace boundary is
inclusive — exactly 7 days still counts (`withinGrace`, `:254-257`, pinned at
`packages/host/src/gateway-gate.test.ts:146-155`); the TTL check is `withinOkTtl` (`:267-270`).

**The live check** is `checkGatewayLive` (`packages/host/src/gateway-gate.ts:348-383`): `GET {baseUrl}/models`
with `Authorization: Bearer <key>` under `AbortSignal.timeout(3_000)`, after `assertAllowedEndpointUrl` rejects
plain-HTTP remotes. 2xx → `ok`; 401/403 → `invalid_key` (message is `HTTP {status}`, the key is never echoed);
other non-OK → `error`; thrown/timeout → `unreachable`. `runGatewayCheck` (`:484-530`) wraps it: it
short-circuits on stub or no key (`:491-493`), maps a throw to `unreachable` (`:506-510`), carries `lastOkAt`
forward only for the same fingerprint (`:512`), persists, and — when the verdict could **not** be written —
answers `status: "error"` with `allowed` untouched (`:522-529`).

It runs on a key save (`refreshGatewayGateAfterSave` → `runGatewayCheck`,
`packages/host/src/handlers/settings.ts:320-336`), and which verdict the save response carries is decided by
`gateVerdictFor` (`packages/host/src/handlers/settings.ts:309-318`). It also runs on
`POST /api/v1/settings/gateway/check` (`handleGatewayCheck`,
`packages/host/src/handlers/settings.ts:338-346`, route at `packages/host/src/router.ts:263`). Separately, `maybeRefreshGateway` (`packages/host/src/gateway-gate.ts:593-614`)
fires an un-awaited check at most once per key per 10 minutes from `handleGetSettings` — that is what turns
"opened on trust" into a real verdict over time.

**Enforcement.** `requireGatewayAllowed(settings)` (`packages/host/src/gateway-gate.ts:476-483`) throws
`GatewayBlockedError` when `!gate.allowed`, and `jsonError` flattens it (`packages/host/src/errors.ts:17-26`) to
`403 { error: "gateway_blocked", status, message }` — a flat body, deliberately not the usual
`{error:{code,message}}` envelope, so `parseGatewayBlocked` can read it without unwrapping. Call sites, all
verified at this sha: `handlers/runs.ts:30`; `handlers/jobs.ts:71, 109, 155, 166, 177, 188, 215, 226, 254, 266, 279, 291`;
`handlers/knowledge.ts:174, 191, 207, 253, 288, 310, 370, 403`; `handlers/finance.ts:17, 32, 52, 64`;
`handlers/market.ts:29, 41, 55`; `handlers/edit.ts:314, 542`; `handlers/enhance-prompt.ts:49`;
`handlers/legal.ts:114`; `handlers/meetings.ts:139, 155, 174`.

**Phase 5 lane B: the plan is enforced in the same function, and first.** `requireGatewayAllowed`
calls `requireEntitlementAllowed(tenantOf(opts))` (`packages/host/src/entitlement-store.ts:431-452`)
before it derives the gate, so every call site above gained the allowance without one of them
changing, and none of them gained an `await` — `better-sqlite3` is synchronous, and off server mode
the function returns before it asks for a connection. A refusal is a `PlanBlockedError` carrying
`plan_past_due`, `plan_cancelled` or `plan_allowance_exhausted`, never `gateway_blocked`: that code
routes the renderer to onboarding, which is a dead end for a hosted tenant who holds no key. See
[`tenant-entitlement.md`](tenant-entitlement.md).

Deliberately **open**: settings, workspaces, threads, artifacts, media, usage, model refresh — proved by the
absence of the import in those handler files and directly by
`packages/host/src/handlers/settings.test.ts:186-192` ("does not gate settings, usage or threads"). A closed gate
must always be recoverable. Phase 5 lane B adds two more for the same reason: `GET /api/v1/billing/plan`
and `POST /api/v1/billing/top-up` (`packages/host/src/router.ts:275-276`), so a tenant the **plan**
has blocked can still read why and pay.

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
(`apps/web/src/App.tsx:77-79`), listens for `GATE_EVENT = "agentforge-gate"`
(`apps/web/lib/gateway-gate.ts:108`, listener at `App.tsx:89-97`), re-fetches settings and re-resolves on every
locale epoch (`:99-122`), and renders `OnboardingScreen` when `gate === "onboarding"` (`:139-140`). Reason copy
maps through `REASON_KEYS` (`apps/web/lib/gateway-gate.ts:123-127`) to
`onboarding.gate.invalidKey / unreachable / error`; the Settings status word maps through `gatewayStatusKey`
(`:135-137`) to `settings.gateway.status.<status>`.

### Start over

Card `settings-reset` (`apps/web/components/settings-reset-card.tsx:159`), mounted at
`apps/web/components/settings-page.tsx:535`, fed by `resetPending` on the settings payload.

**Sign out (`scope: "key"`)** — no typed confirmation, fully synchronous. `resetGatewayKey`
(`packages/host/src/handlers/settings.ts:400-415`) calls `clearGatewayKeyEverywhere(tenant)`
(`packages/host/src/settings-store.ts:522-538` — **every desk of the caller's tenant**, because "a key left on
a second desk would keep the gate open after 'forget my key'"; Phase 3 lane D narrowed it from the whole
install), then `clearGateState(tenant)`, `clearThisKeyCache()`, `resetEmbedCircuit()` and — added 2026-09-17 —
`resetJobModelCircuit()` (`:405-407`). Returns `relaunch: false`. Threads, desks and media are untouched. The
card navigates to `/chat` and calls `announceGate(result.gateway)`, which dispatches `GATE_EVENT` and drops the
shell to onboarding.

**Phase 4 opened `scope: "key"` on the hosted server.** It used to answer 403 there, on the same reasoning as
`scope: "all"`. That reasoning does not hold: everything this route touches is the caller's own tenant —
lane D scoped `clearGatewayKeyEverywhere` and `clearGateState` to `tenant`, and the three cache resets are
process-wide breakers that cost a re-check and nothing else. Refusing it also left a hosted tenant with **no**
way to remove a saved key, because a blank `openaiApiKey` in a settings POST is dropped rather than applied
(`keyFieldValue`, `:194-202`); both halves are pinned by `packages/host/src/handlers/settings.test.ts`
("allows scope key, because the key it forgets is the caller's own", and "is the only way a hosted tenant can
clear its key"). `scope: "all"` stays refused (`resetEverything`, `:423-440`): that one really does wipe the
shared data directory.

**Fresh install (`scope: "all"`)** — typed `RESET` required. The button is disabled until
`typed.trim() === RESET_CONFIRM_WORD`, but what travels is **what the owner actually typed**
(`apps/web/components/settings-reset-card.tsx:134-136`), and the host re-checks it independently
(`packages/host/src/handlers/settings.ts:427-429`, 400 otherwise). Then
`requestDataReset(localDataDir(), [...HOST_RESET_ENTRIES])` (`:431`) writes the marker — nothing is deleted yet,
because "the database is open and ffmpeg may still be writing" (`:430`) — followed by `killTrackedChildren()`,
and the answer is `{ relaunch: true, resetPending: true }`.

The marker is `reset-pending.json` (`RESET_MARKER_FILE`, `packages/db/src/reset.ts:26`), written
temp-file-then-`renameSync` so a crash cannot leave a half-written marker that parses.

**The wipe list is named entries, never the directory** (`HOST_RESET_ENTRIES`,
`packages/host/src/handlers/settings.ts:354-380`),
because in the packaged app that same folder is Electron's userData / Chromium profile:

```
settings.enc  settings.json  .master-key  gateway-gate.json  media
workspace-id.txt  desk-usage.json  tenants  datasets  edit  legal
models-cache.json  models-dev-cache.json  components  logs
```

plus, always, `SQLITE_ENTRIES` — `agentforge.sqlite`, `-wal`, `-shm` (`packages/db/src/reset.ts:29`), which
`applyPendingDataReset` unions onto the marker's own list at `packages/db/src/reset.ts:318-319` ("the SQLite trio is
added by `applyPendingDataReset`, because `@agentforge/db` owns it",
`packages/host/src/handlers/settings.ts:351-352`), and, when `DATABASE_URL` points out of tree, that trio by
absolute path (`removeDatabaseElsewhere`, `packages/db/src/reset.ts:216-269`). Pinned exactly by
`packages/host/src/handlers/settings.test.ts:450-471`, which also asserts `host-status.json` and anything
containing "storage" never appear (`:473-474`), and again — against `TENANT_STATE_FILENAMES` rather than a
literal — by `packages/host/src/tenant-state.test.ts`, so a payload that gains a file can never be left off
the list. Preserved: `host-status.json`, `Local Storage/`, every other
Chromium artifact, and `legacy-migrated.json`.

**Applied at boot, before SQLite opens.** `packages/db/src/client.ts:38-46` — when
`AGENTFORGE_APPLY_PENDING_RESET === "1"` and no connection exists, `applyPendingDataReset(localDataDir())` runs
at module top level, just before `new SqliteDatabase(file)`, and logs one line of counts from
`resetOutcomeSummary` (`packages/db/src/reset.ts:345`) — "Start over applied: N item(s) removed", or, as a
warning, "Start over is not finished: …". Counts only: the entries include the key file, and a database kept
outside the data dir is reported by its absolute path.

**A wipe that fails part-way is retried, not dropped (2026-09-23).** Each removal reports `removed`, `absent`,
`skipped` or `failed`; only `failed` keeps the wipe pending. When anything failed — on Windows, a file another
process still holds, with `EBUSY` or `EPERM` — `keepForRetry` rewrites the marker to name only what is still owed
and leaves it for the next launch (`packages/db/src/reset.ts:276-289`, called at `:336`), and the outcome says
`applied: false`. The SQLite trio goes back on the list only when part of it is what failed: once it is gone the
app opens a fresh database on this same boot, and a retry must not delete that one (the marker's
`database: false`, `:40`). A failed entry is logged by its name and error code, never by path (`:201`). Before
this change the marker was dropped whatever happened, so a locked `.master-key` or `settings.enc` simply stayed
behind after the owner had confirmed the erase ([SR-77](../security-register.md#sr-77),
[SR-78](../security-register.md#sr-78)). That env flag is set in exactly two places:
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
| Verdict missing, unreadable, or not JSON | `loadGateState` returns `null` (`packages/host/src/gateway-gate.ts:158-188`) → opens on trust. Deliberately unlike the sealed settings payload, which refuses rather than reset: a verdict is a cache of something the gateway said, so losing one costs a re-check |
| Verdict cannot be written | `saveGateState` warns and returns `{persisted:false}` (`:198-213`, warn at `:210`); `runGatewayCheck` then answers `status:"error"` with `allowed` as derived (`:522-529`) — "an unwritable data dir must not close a desk" |
| Live check throws / times out | mapped to `unreachable` (`:506-510`), never thrown |
| Background re-check throws | swallowed (`:593-595`); the un-awaited promise also carries its own `.catch` (`:592`) |
| Save with an empty key string | `clearGateState()` and no check at all (`packages/host/src/handlers/settings.ts:328-331`). On the hosted server the blank never reaches the store either (`keyFieldValue`, `packages/host/src/handlers/settings.ts:194-202`), so a key is dropped through `scope: "key"` rather than through a blank save |
| Server mode, no database connection installed | `tenantStateBackend()` throws `tenant_state_backend_missing` (500) on the first read or write (`packages/host/src/tenant-state-store.ts:251-261`). Fail closed and loud, never a silent fall back to the desktop's files — see [`tenant-secrets-backend.md`](tenant-secrets-backend.md) |
| Sealed settings that will not open with the current wrap key | server mode refuses the request (`settings_unreadable`, 500) and leaves the payload untouched; a desk quarantines and starts fresh, exactly as before (`onUndecryptableSettings`, `packages/host/src/settings-store.ts:373-385`) |
| Reset queued, app killed before reboot | `reset-pending.json` persists; the wipe applies on the next boot regardless of how the process died |
| Reset while runs are in flight | only *tracked* ffmpeg/ffprobe children are signalled (`packages/host/src/child-processes.ts:42-55`); an in-flight chat turn or embed job is simply cut off at exit. No coverage |
| Partial removal | since 2026-09-23 the marker is kept, rewritten to what is left, and the next launch retries it; the outcome says `applied: false` and the boot line warns (`keepForRetry`, `packages/db/src/reset.ts:276-289`). Before, `dropMarker()` ran anyway and the result said applied |
| The marker cannot be rewritten after a partial wipe | the original marker is still in place, so the next boot retries the whole wipe (`:285-288`) |
| Reset on webdev | `relaunchDesktopApp` returns `{ok:false, reason:"unavailable"}`; the card shows `settings-reset-restart-needed`; the wipe lands when the dev server next restarts |

## Where things live

| File | Role |
|---|---|
| `packages/host/src/settings-store.ts` | The encrypted store, one payload per tenant; `SettingsScope`, `resolveSettingsScope`, `resolveSettingsWorkspaceId`, `sliceFor`, `clearGatewayKeyEverywhere`, `loadUserLocale` / `saveUserLocale`, `loadOwnerLocale` / `saveOwnerLocale` |
| `packages/host/src/tenant-state-store.ts` | **Phase 4.** The backend the two payloads go through: `TenantStateBackend`, the file and row implementations, `TENANT_STATE_FILENAMES`, legacy-file adoption — see [`tenant-secrets-backend.md`](tenant-secrets-backend.md) |
| `packages/host/src/tenant-state-db.ts` | Three lines; the only place the row backend is handed a connection, imported from `router.ts` |
| `packages/core/src/tenancy/state-keys.ts` | `TENANT_STATE_KEYS` — `settings` and `gateway_gate`, the names both backends key on |
| `packages/host/src/wrap-key-rotation.ts`, `scripts/rotate-wrap-key.ts` | The wrap-key rotation drill and its CLI |
| `packages/host/src/tenant-paths.ts` | The one place a tenant becomes a directory — see [`tenant-storage.md`](tenant-storage.md) |
| `packages/host/src/workspace.ts` | `workspace-id.txt` read/write |
| `packages/host/src/tenant.ts` | `getTenant` — desk resolution, stamping, legacy adoption |
| `packages/host/src/handlers/settings.ts` | `settingsPayload`, GET/POST settings, `gateVerdictFor`, `refreshGatewayGateAfterSave`, `handleGatewayCheck`, reset, cancel; `HOST_RESET_ENTRIES` |
| `packages/core/src/gateway/gate-types.ts` | The gate contract |
| `packages/host/src/gateway-gate.ts` | Derivation, the per-tenant verdict (through the state backend), live check, `requireGatewayAllowed` / `requireGatewayAllowedFor`, background refresh |
| `packages/core/src/gateway/pinned.ts` | The pinned URL, its integrity hash, the dev-only override rule |
| `packages/core/src/secrets.ts` | `resolveProviderKeys` (which, in server mode, no longer falls back to the operator's environment), `maskSecrets`, `resolveRuntimeMode` |
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
  `Last checked` **only when `checkedAt` is non-null** (`apps/web/components/settings-page.tsx:442-457`, the
  condition at `:447`). On
  `stub`, `needs_key` and never-checked desks the row is just the word and the Re-check link — driven on the
  owner's desk on 2026-09-17, where it read "Demo luring · Periksa ulang".
- **`invalid_key` is the only status with zero grace**, however recently the key worked. A rejection is an
  answer; unreachable is not.
- **Per-desk settings are one file.** Anything that reasons about "the desk's settings directory" is wrong.
- **`getTenant` reads and compares the settings file on every single request** because `adoptLegacySettings` is
  unconditional (`packages/host/src/tenant.ts:124`). It is a no-op once the legacy slice is gone, but it is not
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
  (`packages/host/src/http-adapter.ts:36`) on top of the loopback `Host` and `Origin` checks, so a cross-site
  HTML form POST cannot reach it. The IPC-only transport and the loopback-only `Host` / `Origin` allowlist are
  **(desktop, frozen)**: on the hosted web app the same host gate runs behind the HTTP adapter
  (`packages/host/src/http-adapter.ts:539-568`). The loopback check **became** a trusted-origin allowlist plus a
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
`settings-load-error` `:379`, `runtime-status` `:384`, `settings-locale` `:408`, `settings-locale-error` `:416`,
`settings-locale-restart` `:421`, `settings-locale-restart-button` `:426`, `settings-form` `:436`,
`settings-gateway-status` `:444`, `settings-gateway-recheck` `:453`, `settings-gateway-grace` `:459`,
`settings-gateway-reason` `:464`, `openai-key` `:477`, `settings-edit-turn-cap` `:496`, `key-fingerprint` `:500`,
`settings-error` `:505`, `save-settings` `:515`, `privacy-note` `:523`; the whole `settings-reset-*` family in
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
atomic write); `packages/db/src/reset-retry.test.ts` (a failed removal keeps the marker naming only what is left,
the retry never deletes the fresh database, and no path reaches the log); `apps/web/lib/settings-save.test.ts`
(`readSettingsAnswer`); `packages/host/src/gateway-pin.test.ts`; `apps/web/lib/gateway-endpoint-hidden.test.ts`;
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

`[Supported]` The code agrees at every branch: a missing or unreadable verdict opens
(`loadGateState`, `packages/host/src/gateway-gate.ts:158-188`), an unwritable store costs a cached decision and
nothing else (`saveGateState`, `:198-213`; `runGatewayCheck`, `:522-529`), the background re-check swallows its
own failures (`:593-595`), and the stub runtime is always open off server mode (`:291-293`). **Confidence: high.** The design record is prose in `AGENTS.md`, not a commit body —
`git log --oneline -20 -- packages/host/src/gateway-gate.ts packages/core/src/gateway/gate-types.ts` returns only
`8831bc4` and `4db009a`, and `4db009a`'s message is about locale and layout, not the gate.

**Why sign-out clears the key on every desk rather than the current one.** `[Direct]` the comment at
`packages/host/src/settings-store.ts:522-538`: a key left on a second desk would keep the gate open after "forget
my key". **Confidence: high.**

**Why the fresh-install wipe is a named list and deferred to boot.** `[Direct]` two comments:
`packages/host/src/handlers/settings.ts:275-280` — "Deliberately a named list, never the directory: in the packaged
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

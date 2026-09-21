# Web migration plan: from one local install to one hosted multi-tenant server

**Status:** plan, not a decision. The decision is [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md); this page says how to get there.
**Verified against `main` at `986f113`, 2026-09-18.** Every `file:line` below was read in that tree.

Deployment assets (Dockerfile, compose, reverse proxy, env template, deploy scripts) live in the
sibling folder **`webapp-deploy/`**. This plan references that path and never creates it.

## 1. Scope and principle

The move is **additive**. Nothing is deleted to make room for the server.

- **The desktop keeps building.** Electron is frozen at 0.14.27 and stays buildable from this tree.
  `pnpm desktop:build` and `pnpm desktop:release` must pass unchanged at the end of every phase.
- **Every phase leaves webdev `:3000` green.** The isolated webdev instance is where each phase is
  driven. Hot reload does the work; never start a second port, never ask for a restart.
- **Nothing counts as shipped until it is deployed to the hosted environment and driven there.**
  A phase whose code is merged but not deployed is not done. Each deploy appends a row to the deploy
  log in the decision record.
- **One host, two adapters.** `packages/host` stays the single implementation. The HTTP adapter
  (`packages/host/src/http-adapter.ts`) serves the web; the Electron IPC path
  (`apps/web/lib/api-client.ts:97-98` → `apps/web/lib/desktop-bridge.ts:59-70`) serves the desktop.
  A change that only one adapter can carry belongs behind a capability flag, not a fork.
- **Tests before behaviour.** Each phase lists the tests it must add; they go in first.

## 2. Inventory of local-based assumptions

| Assumption | Where (`file:line`) | What it must become | Phase |
|---|---|---|---|
| Data dir is one folder on this machine | `packages/db/src/vault-key.ts:6-19` (`AGENTFORGE_SETTINGS_PATH` → `AGENTFORGE_DATA_DIR` → `../../data`) | One server data root, with a per-tenant subtree resolved from the request, not from `process.env` | 4 |
| SQLite is one file next to the data dir; Postgres throws | `packages/db/src/vault-key.ts:21-35` (`"Postgres is not supported."` at `:24-26`) | Stays SQLite for Phase 0-2. Phase 3 is the decision point: one file with a tenant column, or a file per tenant, or Postgres | 3 |
| Wrap key falls back to a `.master-key` file written on demand, mode 0600 | `readOrCreateMasterKeyFile` (`packages/db/src/vault-key.ts:107-114`), reached from `getLocalVaultKey` at `:126` | `AGENTFORGE_SECRETS_KEY` becomes **mandatory** on the server; the file fallback throws instead of self-creating | 1 |
| Electron overrides the wrap key from the OS keychain | `apps/desktop/main.cjs:265-294` (keytar service/account) | Desktop-only, untouched. The server path must never load keytar | 4 |
| `settings.enc` is one file for the whole install, holding a slice per workspace | `packages/host/src/settings-store.ts:26-27`, shape at `:120-122` (`version: 2; workspaces: Record<string, StoredSecrets>`), written at `:180-183` | A row per tenant, encrypted with the same AES-256-GCM envelope; the file becomes the desktop backend of a storage interface | 4 |
| Mutating `/api` requires a loopback Origin **and** a loopback Host | `isAllowedMutatingApiRequest` (`packages/host/src/local-request.ts:80-89`), wired at `packages/host/src/http-adapter.ts:560`; the web rule chosen alongside it at `:529` | Trusted-origin allowlist from config, plus a CSRF token, plus the existing `x-agentforge-transport` header (`http-adapter.ts:10-12`) | 1 |
| Missing Origin is treated as same-machine and allowed | `packages/host/src/local-request.ts:84-86` (documented at `:75-79`) | Missing Origin is rejected on the web adapter; still allowed for the desktop IPC path, which never reaches this function | 1 |
| Server binds `127.0.0.1`, port from `PORT`, "never LAN-bind" | `apps/web/server.ts:110-115` via `resolveBindHost` (`apps/web/lib/bind-host.ts:17-27`) | `BIND_HOST` config, default `127.0.0.1`; the proxy in `webapp-deploy/` is the only public listener | 1 |
| A single local owner is created on first touch of the DB | `packages/db/src/ensure-local-owner.ts:20`, inserted at `:20-26`; id from `packages/core/src/local-owner.ts:1` (`"local-owner"`); seeded by `packages/db/src/seed.ts:32` | The owner comes from the portal session. `ensureLocalOwner` becomes the desktop-only branch of a `resolveTenant(session)` | 2, 3 |
| `TenantContext` has no tenant id and no plan | `packages/core/src/tenancy/types.ts:13-20` (`organizationId`, `workspaceId`, `userId`, `role`) | Gains `tenantId` and a resolved `plan`; `requireTenant` (`types.ts:20`) gets its first real call sites | 3, 5 |
| `getTenant()` takes only a preferred workspace id — no identity input at all | `packages/host/src/tenant.ts:38-123`; **102 non-test call sites** across `packages/host/src` | `getTenant(request)` derives identity from the session. This is the single seam for tenancy — every handler already goes through it | 3 |
| Org/workspace scoping is real in SQL but collapsed to one value | e.g. `packages/host/src/threads.ts:332` filters on `runs.organizationId`; role is always `"owner"` (`ensure-local-owner.ts`) | Same columns, many values. The filters already exist; what changes is that they stop being a single constant | 3 |
| Selected desk is a file on disk, machine-wide | `selectedWorkspacePath` (`packages/host/src/workspace.ts:19-21`), read and written at `:12-40` (`workspace-id.txt`) | Per-session state, carried by the existing `WORKSPACE_COOKIE` (read at `http-adapter.ts:470`) and validated against the tenant's desks | 3 |
| Media files land under the data dir, keyed by org | `packages/host/src/media-root.ts:4-8`; write at `packages/host/src/media.ts:86-92` | Per-tenant prefix under a storage interface; local disk stays the desktop backend. **Done in Phase 6**: `packages/host/src/tenant-storage.ts` | 6 |
| Job output and scratch files are on disk | `packages/host/src/edit/ffmpeg/paths.ts:42-44` (`<dataDir>/edit/<projectId>`), `packages/host/src/datasets.ts:315-317`, `packages/host/src/legal/store.ts:306` | Same storage interface, tenant-prefixed; ffmpeg path allowlist re-derived per tenant | 6 |
| Component installer writes native modules into the data dir on first run | `packages/host/src/components/paths.ts:89-91` (root at `:51-54`), log at `components/log.ts:15-19`, one component (`components/types.ts:10`, `anydoc`) from a pinned registry URL (`components/manifest.ts:15`); routes at `packages/host/src/router.ts:279-280`, ungated on purpose (`handlers/components.ts:1-9`) | **Done in Phase 7**: installed once per server at image build, never per tenant and never from a browser request. `AGENTFORGE_COMPONENTS_DIR` (`components/paths.ts:51`) takes the root off the tenant volume, and a server refuses to load from inside the data dir (`:84`) | 7 |
| Gateway gate trusts an unknown key on first run | `packages/host/src/gateway-gate.ts:274-276` — no state, or a fingerprint mismatch, returns `allowed: true` | Server-side the gate must fail closed for a tenant with no verified key; trust-on-first-run stays for the desktop | 5 |
| Gate state is one JSON file per install | `packages/host/src/gateway-gate.ts:27` (`gateway-gate.json`), path at `:101-103`; 7-day grace at `:33`, 1-day OK TTL at `:42` | A row per tenant. Grace and TTL constants stay as-is | 4, 5 |
| A missing gate payload fails **open** in the browser | `apps/web/lib/gateway-gate.ts:83-89` (`return isElectron ? "onboarding" : "app"`) | On the hosted build a missing gate must fail closed. This is the single highest-risk line in the renderer | 5 |
| "Start over" wipes a named list under the data dir and relaunches | `packages/host/src/handlers/settings.ts:274-296` (`HOST_RESET_ENTRIES`), queued at `:310-321`; applied next boot by `packages/db/src/reset.ts:248` under `packages/db/src/client.ts:35-37` | Web: a per-tenant purge inside a transaction plus a storage-prefix delete. No process relaunch, no shared-file deletion | 8 |
| `host-status.json` describes the Electron host | written only at `apps/desktop/main.cjs:300-312`, single call site `:682`; read by `.cursor/skills/verify-agentforge/scripts/doctor.mjs:78-104` | Desktop-only; untouched. The web gets a `/api/v1/health` route the proxy and deploy script probe | 8 |
| IPC bridge shapes every renderer call | `apps/web/lib/desktop-bridge.ts:59-70`, branch at `apps/web/lib/api-client.ts:97-98` | Stays. It is the second adapter, not legacy | 8 |
| Electron-only renderer surfaces | `apps/web/components/settings-reset-card.tsx:229` (relaunch), `apps/web/lib/use-app-updates.ts:31`, `apps/web/components/edit-studio.tsx:322-324` (native file picker), `apps/web/lib/product-brand.tsx:73` | Gated off on the web build and replaced with a browser equivalent (file input, no relaunch, no updater) | 8 |
| Updater points at the releases repo | `apps/desktop/auto-update.cjs` | Desktop-only, frozen. The web has no updater; a deploy is a container swap | 8 |
| Playwright drives `127.0.0.1:3000`, boots `pnpm dev`, points at the shared `data/` dir | `apps/web/playwright.config.ts:11`, `:15-25` (`AGENTFORGE_DATA_DIR: ../../data`, `AGENTFORGE_RUNTIME: "stub"`) | A second project targeting the deployed base URL with a seeded test tenant and a real session cookie | 0, 2 |
| Locale is one value for the whole install | `packages/host/src/settings-store.ts:123` (`locale?: AppLocale`), exported from `packages/core/src/index.ts:621-622` | **Copy and catalogues unchanged.** Only the storage of the chosen locale moves to per-user | 4 |
| Usage is per-install, not per-user: a global JSON file with no tenant dimension | `packages/host/src/desk-usage.ts:21-23` (`desk-usage.json`), append at `:66` | Per-tenant rows. Merged with the already-org-scoped run usage (`packages/host/src/threads.ts:308`, read at `:328`) | 5 |
| USD is estimated live and never persisted | `packages/core/src/gateway/account.ts:165`, formula at `:149`; `QUOTA_PER_USD = 500_000` at `packages/core/src/gateway.ts:96`; entry points `packages/host/src/account-usage.ts:172,181,297` | Persisted per run, per tenant. This is the metering base for the Personal allowance and Enterprise pooled spend | 5 |
| No plan, seat, subscription or billing code exists anywhere in `packages/` or `apps/` | verified by search; the design is docs-only (`docs/internal/portal/schema.md:36,70-72`) | New `tenant_plan` and `tenant_usage` tables plus a webhook route | 5 |
| ffmpeg and SQL worker children are tracked in one process-wide set | `packages/host/src/child-processes.ts` (module-level `Set`); caps at `packages/host/src/sql-runner.ts:8-11` | Per-tenant concurrency caps on top of the global registry | 6 |

## 3. Phases

### Phase 0 — Deploy as-is, single owner, behind the proxy

**Goal.** The tree as it stands, running on the server, reachable over HTTPS, with exactly one tenant
(the existing local owner). Proves the deployment path before any code changes.

**Files.** None in this repo except `docs/internal/web-pivot-2026-09-18.md` (deploy log row).
Everything else is in `webapp-deploy/`: Dockerfile building `apps/web` (`vite build` → `dist`, run
`NODE_ENV=production tsx server.ts`), compose, reverse proxy with TLS, env file carrying
`AGENTFORGE_SECRETS_KEY` and `AGENTFORGE_DATA_DIR`, a mounted data volume, and a backup script for it.

**Tests.** A smoke script in `webapp-deploy/` that hits the deployed URL, loads the SPA, and runs one
mutating call. No new repo tests.

**Done when.** The URL serves the app over TLS, one desk works end to end, the data volume survives a
container restart, and the deploy log has its first row.

**Risk.** The proxy forwards a public `Host` header, which `isLoopbackHostHeader` rejects — every
mutating call 403s. The proxy must rewrite `Host` to `127.0.0.1` until Phase 1 lands. This is the
whole reason Phase 1 exists and must not be worked around by loosening the check in the repo.

### Phase 1 — Trusted origins, CSRF, bind config, mandatory wrap key

**Status: landed and merged.** Shipped in [PR #56](https://github.com/Kyoo032/agentforge/pull/56), on `main` as commit `6ae177a`. This closes open decision 3 in [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md). One switch, `isServerMode()` in `packages/core/src/server-mode.ts` (`AGENTFORGE_SERVER=1`), gates every hosted-only rule. `isAllowedWebOrigin` / `isAllowedWebHostHeader` in `local-request.ts`, the web-vs-loopback choice and the CSRF cookie in `http-adapter.ts` + `csrf.ts`, `BIND_HOST` via `apps/web/lib/bind-host.ts`, the mandatory wrap key in `vault-key.ts`. Also landed from the security spec's before-traffic rows: the gate fails closed (T4, `gateway-gate.ts`, and the stub runtime no longer opens it on the server), "Start over" refused with `reset_disabled` (T8), global ffmpeg/SQL caps in `concurrency.ts` (T9), the JSON logger with redaction in `log.ts` (L1). Proven on a throwaway server-mode host: no Origin 403 `origin_forbidden`, no token 403 `csrf_missing`, wrong Host 403, webdev :3000 unchanged.

**Goal.** The host accepts mutating calls from a configured public origin, on its own merits.

**Files.** `isAllowedMutatingApiRequest` (`packages/host/src/local-request.ts:80-89`) gains an allowlist-aware sibling
(`isAllowedWebOrigin`) that rejects a **missing** Origin; `packages/host/src/http-adapter.ts` chooses
between the web rule (`:529`) and the loopback rule (`:536`) from config; a CSRF token is minted on first GET,
set as a `SameSite=Lax` cookie, and required on every mutating call alongside the existing
`x-agentforge-transport` header; `csrfTokenForMutation` (`apps/web/lib/api-client.ts:137`) sends it;
`resolveBindHost` (`apps/web/lib/bind-host.ts:17`) reads `BIND_HOST` for `apps/web/server.ts:114-115`;
`getLocalVaultKey` (`packages/db/src/vault-key.ts:123-134`) throws instead of creating `.master-key`
when the server flag is set.

**Tests.** Extend `packages/host/src/local-request.test.ts` and `http-adapter.test.ts`: allowed origin
passes, unlisted origin 403s, missing Origin 403s on the web rule and passes on the loopback rule,
missing CSRF token 403s, a header that does not match the cookie 403s. (At the time of writing the
double-submit token was bare randomness, so "a token from another session" was not a case this could
test. Phase 3 lane C bound the token to the session id and added that case —
`packages/host/src/csrf.test.ts`, [`web-phase3-lane-c.md`](web-phase3-lane-c.md) §6.) A test that
`.master-key` is not created when the server flag is set.

**Done when.** The proxy passes the real `Host` through, webdev `:3000` still works unchanged (its
origin is on the allowlist by default), and the desktop IPC path is untouched.

**Risk.** Loosening the check for the web accidentally loosens it for the desktop. Keep two named
functions and choose between them once, at `http-adapter.ts:529-536`. A second risk: the CSRF cookie
and the `WORKSPACE_COOKIE` (read at `http-adapter.ts:470`) must not collide on `SameSite` or path.

### Phase 2 — Portal browser session

**Status: backend landed and merged; no UI yet.** The backend shipped with Phase 1 in [PR #56](https://github.com/Kyoo032/agentforge/pull/56), on `main` as commit `6ae177a`. `packages/host/src/auth/` (session mint/verify/slide/revoke, SQLite store `auth_sessions` via migration `0014`, portal client with the doc's reason codes, four routes) and the server-mode-only session gate in `router.ts` (`session_required` 401 on every `/api` route, any method, except `/api/v1/auth/*`, `GET /api/v1/ping` and `GET /api/v1/components`; the verified session rides on `request.session` for Phase 3, and until Phase 3 the hosted server is single-tenant). Assumed portal contract: `POST /auth/token` with `grant_type=authorization_code` + `code`; refresh and logout verbatim from the login doc. The sign-in screen and the Playwright project are still open.

**Goal.** A visitor signs in through the portal in a browser and gets a session; the device-code
client is not used on the web.

**Files.** New `packages/host/src/auth/` (session cookie mint/verify, portal token exchange, refresh,
sign-out); new routes in `packages/host/src/router.ts`; a sign-in screen in `apps/web/`; the reason
codes come straight from `docs/internal/portal/device-code-login.md:222`
(`session_revoked`, `device_revoked`, `user_inactive`, `org_inactive`, `org_past_due`,
`seat_cap_reached`, `tenant_inactive`, `refresh_reused`, `refresh_expired`) and are rendered with the
portal's own `message_en` / `message_id` when the app has no better copy
(`docs/internal/portal/device-code-login.md:85-94`).

**Tests.** Session mint/verify unit tests; an unauthenticated mutating call 401s; each reason code
maps to a rendered screen; sign-out clears the cookie and the server-side session. A Playwright
project pointed at the deployed URL with a seeded test account.

**Done when.** Sign-in works on the hosted URL; the desktop still boots with no session at all
(`ensureLocalOwner` branch); webdev `:3000` still boots without sign-in behind a dev flag.

**Risk.** Two account concepts in the tree at once. The device-code spec stays the portal contract;
only the client half differs. Keep the portal's reason codes as the single vocabulary so the desktop
and the web report the same failure the same way.

### Phase 3 — Tenancy in the schema and every handler

**Goal.** Rows belong to a tenant, and no handler can read across tenants.

**Decision point (open question 1).** Recommended: **tenant column, one database**, because
`organizations` already plays that role in 35 tables (`packages/db/src/schema.ts`) and the queries
already filter on it (`packages/host/src/threads.ts:332`). Staying on SQLite keeps `ensureSchema`
(`packages/db/src/ensure-schema.ts:192`) and the hand-rolled migration runner (`:64-176`) intact.
Postgres becomes necessary when write concurrency across tenants exceeds what one SQLite writer can
take, not before; the `DATABASE_URL` guard at `vault-key.ts:23-26` is the switch.

**Files.** `packages/core/src/tenancy/types.ts:13-20` gains `tenantId`; `packages/host/src/tenant.ts:38`
becomes `getTenant(request)` and resolves from the session, keeping `ensureLocalOwner` as the desktop
branch; `packages/db/src/ensure-local-owner.ts:20` is renamed to say what it is; the 102 call sites
need no edit if the signature change is source-compatible, which is the reason to change it here
rather than at each call site; `requireTenant` (`types.ts:20`) is called at the top of `dispatch`;
`packages/host/src/workspace.ts:19-41` becomes session state.

*Landed differently in one place.* Lane C built the source-compatible `getTenant` and made
`workspace-id.txt` desktop-only, but did **not** call `requireTenant` at the top of `dispatch`: that
presumes `dispatch` resolves a tenant eagerly, which adds a database round-trip to every request
including the ones that never ask. The guarantee it was there to give is given instead by the two
refusals inside `getTenant` itself — see [`web-phase3-lane-c.md`](web-phase3-lane-c.md) §2 and the map
[`maps/tenant-resolution.md`](maps/tenant-resolution.md).

**Migration path for existing SQLite rows.** The existing local rows already carry an
`organization_id` (the "Personal" org from `ensure-local-owner.ts:30-38`). A migration in
`packages/db/drizzle/` creates the tenant table and maps that one org to one tenant. No row rewrite
is needed for the desktop, so the frozen app's database keeps opening.

**Gateway key reset is scoped here, not in Phase 4.** `clearGatewayKeyEverywhere`
(`packages/host/src/settings-store.ts:373-388`) is deliberately machine-wide today. In server mode
"everywhere" must mean "this tenant's desks", or the first tenant to reset their key signs out every
other tenant on the box. Phase 3 is the phase that scopes it, because Phase 3 is when a second tenant
first exists — shipping tenancy with a machine-wide reset still in the tree is the bug, not a Phase 4
follow-up. The storage backend behind `settings.enc` still moves in Phase 4; only the scoping of this
one function comes forward. Lane D owns it (`web-phase3-tenancy-spec.md` § 3e, § 5 settings row, § 7
Lane D).

**Tests.** A cross-tenant read test per table family: tenant A's session cannot fetch tenant B's
threads, artifacts, datasets, knowledge sources, edit projects or media. A migration test that an
existing single-owner database opens and lands in exactly one tenant. `clearGatewayKeyEverywhere`
called by tenant A leaves tenant B's key and gate verdict intact.

**Done when.** Two tenants on the hosted server see disjoint data, and the desktop opens its existing
database with no re-seed.

**Risk.** The biggest phase by far. A handler that reads by id alone, without the tenant filter, is an
IDOR. Do not trust per-handler review: add a test helper that runs every `GET`-by-id route under
tenant B with tenant A's ids and asserts 404.

### Phase 4 — Secrets and data dir per tenant

**Goal.** Keys, settings, gate state and locale are per tenant, and nothing is written to a path
derived from `process.env` at request time.

**Files.** `packages/host/src/settings-store.ts:26-27` grows a storage interface with a file backend
(desktop, unchanged) and a DB-row backend (web), keeping the envelope from
`packages/core/src/crypto/envelope.ts` and `getLocalVaultKey()` (`vault-key.ts:46-52`) as the wrap key
in both; `loadSettings` / `saveSettings` (`settings-store.ts:329,334`) take the tenant;
`packages/host/src/gateway-gate.ts:102-104` moves its state to the same backend; the locale at
`settings-store.ts:121` becomes per user.

**Tests.** Two tenants with different gateway keys do not see each other's key or gate verdict;
a wrap-key rotation re-encrypts without data loss. The `clearGatewayKeyEverywhere` scoping test
already exists from Phase 3 and must stay green across the backend swap.

**Done when.** Two tenants each paste their own key and each gets their own gate verdict on the
hosted server.

**Risk.** Moving `settings.enc` from a per-tenant file to a DB-row backend is a live data move: the
envelope and wrap key stay the same, but the read and write paths change under tenants who already
have keys. `clearGatewayKeyEverywhere` is **not** a Phase 4 risk — it is scoped to one tenant in
Phase 3 (see above); Phase 4 only has to keep that scoping when the backend changes.

### Phase 5 — Plans: Personal subscription with an allowance, Enterprise seats

**Goal.** The host knows what a tenant is entitled to and refuses the gateway call when it is not.

**Files.**
- New tables: `tenant_plan` (`tenant_id`, `kind` `personal|enterprise`, `status`
  `active|past_due|cancelled`, `allowance_usd_micros`, `seat_cap`, `period_start`, `period_end`) and
  `tenant_usage` (`tenant_id`, `run_id`, `model`, input/output tokens, `usd_micros`, `at`).
- The webhook route (`POST /api/v1/billing/webhook`) verifies the provider signature and writes the
  plan row. It is the only writer of `status`. It must be exempt from the CSRF rule from Phase 1 and
  instead authenticated by signature.
- **The host check** goes into `requireGatewayAllowed` (`requireGatewayAllowed` (`packages/host/src/gateway-gate.ts:436`)),
  which already has **30 call sites** in `packages/host/src/handlers/` and is the only choke point
  before a gateway call. Personal: refuse when `status !== "active"` or the period's
  `tenant_usage` sum exceeds `allowance_usd_micros`. Enterprise: refuse when `status !== "active"` or
  the seat counter is over `seat_cap`.
- **The seat counter** follows the portal rule exactly: a seat is a member with an active session in
  the last 30 days (`docs/internal/portal/schema.md:328`, restated at
  `docs/internal/portal/device-code-login.md:510`). Time-based, counted from session rows, never a
  stored counter.
- **Metering.** `packages/host/src/desk-usage.ts:79` (the untenanted JSON append) is replaced on the
  web by a `tenant_usage` insert; `packages/core/src/gateway/account.ts:165,149` keeps computing the
  USD estimate and the result is now persisted rather than recomputed; the readers at
  `packages/host/src/account-usage.ts:172,181,297` merge from the table.
- `apps/web/lib/gateway-gate.ts:83-89` must fail **closed** on the web build.

**Tests.** A Personal tenant at 99% of allowance passes and at 101% is refused; a `past_due` tenant is
refused; an Enterprise tenant at `seat_cap` refuses a new member and admits an existing one; a member
idle 31 days frees a seat; a webhook with a bad signature changes nothing; the refusal carries the
portal reason code and both message languages.

**Done when.** Two tenants on different plans are driven on the hosted server: one hits its allowance
and is blocked, one hits its seat cap and is blocked, both recover when the webhook flips the row.

**Risk.** The allowance is enforced *before* the call but measured *after* it, so a single expensive
run can overshoot. Decide overage behaviour (block vs meter) before shipping — it is open question 4
below. Second risk: whoever holds the gateway key on Personal (operator key with quotas is the
working assumption) determines whether a per-tenant quota is even enforceable at the gateway.

### Phase 6 — Media and job storage per tenant

**Goal.** Bytes are addressed by tenant, and one tenant cannot read another's file or exhaust the box.

> **Landed.** See [`web-phase6-tenant-storage.md`](web-phase6-tenant-storage.md) and
> [`maps/tenant-object-storage.md`](maps/tenant-object-storage.md) for what was actually built, and
> which parts of the text below were deliberately not: the per-tenant ffmpeg and SQL-worker
> concurrency caps are still open, and the job trees are counted against the quota rather than moved
> off the disk, because ffmpeg and the dataset runner open files by path.

**Files.** A storage interface behind `packages/host/src/media-root.ts:4-8`, with the local-disk
backend kept for the desktop; the write at `packages/host/src/media.ts:86-92` gains a tenant prefix
ahead of the existing org segment; the same for `packages/host/src/edit/ffmpeg/paths.ts:42-44`,
`packages/host/src/datasets.ts:315-317` and `packages/host/src/legal/store.ts:306`; the ffmpeg path
allowlist (`edit/ffmpeg/paths.ts:47`) is re-derived per tenant; per-tenant concurrency caps on top of
`packages/host/src/child-processes.ts`.

**Tests.** Tenant B cannot fetch tenant A's media by id (the byte-range route at
`packages/host/src/handlers/media.ts:40`); a path-traversal filename cannot escape the tenant prefix;
a tenant at its concurrency cap queues rather than spawning.

**Done when.** Two tenants upload and render on the hosted server with disjoint trees, and a disk
quota per tenant is reported.

**Risk.** ffmpeg and the SQL worker spawn real OS processes with no per-tenant bound today. On one
shared box that is a denial-of-service between paying customers, not a hypothetical.

### Phase 7 — Component installer per server

**Goal.** `anydoc` is present before the first request, installed once, by the operator.

> **Landed.** See [`web-phase7-component-installer.md`](web-phase7-component-installer.md) and
> [`maps/component-installer.md`](maps/component-installer.md) for what was actually built. Two
> differences from the text below. The CLI is `scripts/components.ts` rather than an entry point
> inside `install.ts`, so the image build can run it without importing a route's module graph; and
> the phase also moved the components root off the tenant data volume
> (`AGENTFORGE_COMPONENTS_DIR`, defaulting to the old path), which is what makes security spec H3's
> `noexec` mount possible and was the reason H3 named this phase. The route's 403 was already there:
> it landed in [PR #88](https://github.com/Kyoo032/agentforge/pull/88) as OWASP A01-3.

**Files.** `packages/host/src/components/install.ts` gains a CLI entry that `webapp-deploy/`'s image
build or entrypoint calls; `packages/host/src/router.ts:228-229` keeps `GET /api/v1/components` for
status and gates the install route off on the web build; the first-run UI
(`apps/web/lib/use-component-setup.ts:42`, `apps/web/components/component-setup.tsx:150`) is skipped
when the server reports the component already present.

**Tests.** The install CLI is idempotent; the install route 403s on the web build; the status route
reports installed without a browser ever triggering a download.

**Done when.** A fresh container has the component before it serves its first request, and no tenant
can start a download.

**Risk.** Leaving the install route open on a multi-tenant server lets any signed-in user trigger a
registry download and a tar unpack. The URL and hashes are pinned (`components/manifest.ts:15`), so
this is a resource problem rather than a supply-chain one — but it is still a free lever.

### Phase 8 — Retire or gate Electron-only surfaces on the web build

**Goal.** The web build shows nothing that only Electron can do.

**Files.** `apps/web/components/settings-reset-card.tsx:229` (relaunch → per-tenant purge, no
relaunch); `apps/web/lib/use-app-updates.ts:31` (already `unavailable` off Electron — remove the entry
point); `apps/web/components/edit-studio.tsx:322-324` (native picker → browser file input);
`apps/web/lib/product-brand.tsx:73` (brand from server config rather than the bridge);
`packages/host/src/handlers/settings.ts:314-325` gets a web branch that deletes the tenant's rows and
storage prefix in a transaction instead of queueing `HOST_RESET_ENTRIES` (`:273-292`) — the file list
is machine-wide and would wipe every tenant; a `GET /api/v1/health` route replaces `host-status.json`
for the deploy probe.

**Tests.** "Start over" on the web deletes exactly one tenant and leaves the others intact; the reset
route still queues the file wipe on the desktop; `host-status.json` is still not in
`HOST_RESET_ENTRIES` (already asserted at `packages/host/src/handlers/settings.test.ts:384`).

**Done when.** A tenant can reset themselves on the hosted server without touching anyone else, and
`.cursor/skills/verify-agentforge` still passes against the packaged desktop app.

**Risk.** Running the existing reset on the server wipes `.master-key`, `settings.enc`,
`gateway-gate.json` and `media` for the **entire box**. Gate this before Phase 0 traffic is real, not
at Phase 8 — an early guard that refuses `/api/v1/settings/reset` with scope `all` on the web build
costs one line and removes the worst accident available.

## 4. What stays for the desktop, and how the two targets share code

Frozen and untouched: `apps/desktop/main.cjs`, `apps/desktop/auto-update.cjs`, the keytar wrap-key
override (`main.cjs:265-294`), `host-status.json` (`main.cjs:300-312`), the pack and release routes,
and `.cursor/skills/verify-agentforge`.

The shared shape is **one host, two adapters**:

- `packages/host` holds every handler, every rule and every gate. It is the product.
- The **HTTP adapter** (`packages/host/src/http-adapter.ts:183`) serves the web: trusted origins,
  CSRF, session cookie, tenant from session.
- The **IPC adapter** (`apps/desktop` → `apps/web/lib/desktop-bridge.ts:59-70`, selected at
  `apps/web/lib/api-client.ts:97-98`) serves the desktop: no origin check, no session, tenant from
  `ensureLocalOwner`.
- Everything a target cannot do is a **capability**, resolved once at boot and read by both the host
  and the renderer: `sessions` (web) vs `singleOwner` (desktop); `objectStorage` vs `localDisk`;
  `plans` vs `none`; `relaunch`, `updater`, `nativeFilePicker` (desktop only).

The rule that keeps this honest: a new feature is written once in `packages/host` against the
capability flags. If it cannot be, it is a desktop maintenance fix and the desktop is frozen, so it
probably should not be written at all.

## 5. Open questions

Owner for all of these: **Kyo**. None are resolved here; a PR must not invent an answer.

1. **Tenant column vs database per tenant, and SQLite vs Postgres.** Phase 3 recommends the tenant
   column on SQLite, but the write-concurrency ceiling of one SQLite writer across many tenants has
   not been measured. What load justifies Postgres, and who measures it?
2. **Session shape.** Cookie session vs bearer, refresh cadence, sign-out semantics, and whether the
   host mints its own session or proxies the portal's. Phase 2 cannot start without this.
3. **Who holds the gateway key on Personal.** The working assumption is an operator key with
   per-tenant quotas. If each Personal user pastes their own key instead, the allowance in Phase 5
   becomes advisory rather than enforceable.
4. **Overage behaviour on Personal:** block at the allowance, or meter and bill the excess? This
   changes what `requireGatewayAllowed` returns and what the account screen has to show.
5. **Tier sizes** for Personal, and the relationship between the Enterprise `seat_cap` and the
   contracted `seat_band` (`docs/internal/portal/schema.md:71-72`).
6. **Billing provider by selling entity** — Xendit, Paddle or Stripe — and therefore the webhook
   signature scheme in Phase 5.
7. **Seat-cap semantics.** A member idle 30 days silently frees their seat and may be refused on their
   next sign-in through no fault of theirs (`docs/internal/portal/device-code-login.md:510`). Accept,
   or hold the seat until it is explicitly revoked?
8. **Hosting specifics** — which server, which proxy, TLS renewal, backup schedule and retention for
   the data volume, and the deploy command. All of it lives in `webapp-deploy/`; this plan only
   assumes it exists.
9. **Tenant provisioning.** Who creates a tenant, and when: at first sign-in, by an operator, or by
   the billing webhook? Phase 3 needs an answer before `getTenant` can resolve one.
10. **Data residency and backup of tenant data**, including what a tenant gets when they cancel and
    how long their rows and files are kept.

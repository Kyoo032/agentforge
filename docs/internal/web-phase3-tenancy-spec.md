# Phase 3: tenancy in the schema and every handler

**Status:** implementation spec, 2026-09-18. Verified against the working tree that became
[PR #56](https://github.com/Kyoo032/agentforge/pull/56) (Phase 1 + Phase 2 backend + the security pass), merged
to `main` as commit `6ae177a`. Every `file:line` below was read in that tree.
Parents: [`web-migration-plan.md`](web-migration-plan.md) §Phase 3, [`web-security-spec.md`](web-security-spec.md)
rows T1-T3, T8, [`web-pivot-2026-09-18.md`](web-pivot-2026-09-18.md).

**Correction to the parent plan.** `web-migration-plan.md:142` says `organizations` "already plays that role in
35 tables". It does not: `packages/db/src/schema.ts` defines **36 tables**, of which **13** declare an
`organization_id` column. The recommendation below survives the correction, for the reason §3(a) gives.

---

## 1. What Phase 1 and Phase 2 delivered

Each line verified against the tree.

| Item | Where | State |
|---|---|---|
| `isServerMode()` / `trustedOrigins()` | `packages/core/src/server-mode.ts:12`, `:22` | Done. `AGENTFORGE_SERVER=1`; in server mode `trustedOrigins` defaults to `[]` (`server-mode.ts:27-29`), so an unconfigured server accepts no mutating call. |
| Web Origin rule | `packages/host/src/local-request.ts:96-102` (`isAllowedWebOrigin`, missing Origin rejected at `:98-100`) | Done. Loopback sibling `isAllowedMutatingApiRequest` unchanged at `local-request.ts:77-86`. |
| Host-header allowlist | `packages/host/src/local-request.ts:110-116`, default-port spelling at `:120-133` | Done. |
| The one branch point | `packages/host/src/http-adapter.ts:338-349` inside `mutatingRejection` | Done. Server mode → origin+host+CSRF; else the loopback rule. |
| CSRF double-submit | `packages/host/src/csrf.ts:52` (mint), `:74-77` (`Set-Cookie`), `:84-101` (constant-time check); minted at `http-adapter.ts:263-266`, checked at `:343-346`; renderer echoes at `apps/web/lib/api-client.ts:95-97,137` | Done. `__Host-agentforge_csrf` on HTTPS, `agentforge_csrf` on plain http (`csrf.ts:21,24`). |
| `BIND_HOST` | `apps/web/lib/bind-host.ts:15-26`, wired at `apps/web/server.ts:109-110` | Done. Non-loopback bind throws unless server mode (`bind-host.ts:20-25`). |
| Mandatory wrap key | `packages/db/src/vault-key.ts:123-135`; entropy floor at `:90-105`; `.master-key` self-create only off server mode (`:125-127`) | Done. |
| Gate fails closed on the server | `packages/host/src/gateway-gate.ts:275` (`serverMode`), `:278-280` (stub runtime no longer opens it), `:288-290` (unverified key = `error`, not `ok`) | Done. |
| Hosted meta marker | `apps/web/lib/hosted-build.ts:21` (tag), `:55-57` (`isHostedBuild`), `:65-76` (`injectHostedMarker`); stamped at `apps/web/server.ts:53,95` | Done. |
| Renderer gate fails closed on hosted | `apps/web/lib/gateway-gate.ts:94-99` — `hosted \|\| isElectron ? "onboarding" : "app"` at `:97` | Done (was `isElectron ? … : "app"`). |
| "Start over" refused | `packages/host/src/handlers/settings.ts:296-298` (`reset_disabled`), thrown at `:335-337` before the confirm word | Done. `HOST_RESET_ENTRIES` at `:274-293` is still machine-wide, which is why it is refused rather than scoped. |
| Global limiters | `packages/host/src/concurrency.ts:288,290` (`ffmpegLimiter`, `sqlLimiter`), `createJobLimiter` at `:241`; wired at `packages/host/src/edit/ffmpeg/run.ts:73` and `packages/host/src/sql-runner.ts:95,172` | Done — **global, not per tenant** (`concurrency.ts:10-13`: caps apply only in server mode). |
| JSON logger with redaction | `packages/host/src/log.ts:217` (`createLogger`), `:240` (`log`), `redactSecrets` applied at `:145,157,176,208` | Done. Does **not** yet add a tenant id or request id as fields (spec row L1 asks for both). |
| Session backend | `packages/host/src/auth/session.ts:81` (`createSession`), `:105` (`verifySession`), `:122` (`slidSession`), `:131` (`revokedSession`); store at `auth/session-store.ts`; portal client at `auth/portal-client.ts`; routes at `auth/routes.ts:192` | Done. Idle 12 h / absolute 30 d (`session.ts:18-19`), slide ≤ once per 5 min (`:21`). |
| Router session gate | `packages/host/src/router.ts:317-345`, invoked at `:352-359`; exemptions at `auth/routes.ts:94-99` (`/api/v1/auth/*`, `GET /api/v1/ping`, `GET /api/v1/components` — `UNGATED_GETS` at `:44`) | Done. Every method on every other `/api` path 401s `session_required`. |
| `HostRequest.session` | `packages/host/src/types.ts:31-36` (`HostSession`), `:53`; populated at `router.ts:333-338`, re-attached at `:376-377` (the caller's own object is never mutated, and a forged `session` field is dropped) | Done. |
| `auth_sessions` + migration `0014` | `packages/db/src/schema.ts:663-681`; `packages/db/drizzle/0014_auth_sessions.sql:12-27`; journal entry idx 14 | Done. Carries `tenant_id`, `org_id`, `user_id` already. |
| Reason-code copy | `apps/web/locales/en/auth.json`, `apps/web/locales/id/auth.json` — all nine portal codes plus `session_required`, `invalid_request`, `invalid_grant`, `portal_unavailable` | Done. |

### Not done

1. **No sign-in screen.** `grep -rln "auth/session|sign-in|signIn|SignIn" apps/web --include=*.tsx --include=*.ts`
   returns nothing. The four routes exist (`router.ts:161-164`); no renderer code calls them, and no component
   reads the strings at `apps/web/locales/*/auth.json`.
2. **The portal browser-login contract is assumed.** `packages/host/src/auth/portal-client.ts:20,213` post
   `grant_type=authorization_code` + `code` to `{AGENTFORGE_PORTAL_URL}/auth/token` and expect `org_id` /
   `tenant_id` back (`:140-142`). `docs/internal/portal/device-code-login.md` documents `/auth/device/token`
   and `/auth/token` with `grant_type=refresh_token` only — the authorization-code grant is **not in the doc**.
3. **CSRF is not bound to the session** (`csrf.ts:89-91` says so). A token minted for session A is accepted for
   session B. Phase 3 should close it, because Phase 3 is the first phase where B exists.
4. **No per-tenant caps.** `concurrency.ts:288,290` are process-wide singletons; row T9 wants them per tenant at
   Phase 5. The global floor is what landed.
5. **No tenant resolution from the session.** `getTenant` (`tenant.ts:35`) still takes a workspace id and calls
   `ensureLocalOwner`. Its own comment (`tenant.ts:27-34`) states the hosted server is therefore single-tenant
   today: every signed-in browser shares one desk. **This is the whole of Phase 3.**

---

## 2. Current state of tenancy in the code

- **`TenantContext`** — `packages/core/src/tenancy/types.ts:13-18`: `{ organizationId, workspaceId, userId, role }`.
  No `tenantId`, no plan. `requireTenant` at `:20-25` has no call site in `packages/host/src`.
- **`getTenant()`** — `packages/host/src/tenant.ts:35-50`. Signature `(preferredWorkspaceId?: string | null)`.
  It calls `ensureLocalOwner(db, explicit || selected)` at `:38`, then `listLocalWorkspaces` at `:39`, adopts
  legacy settings at `:42`, and stamps the selected desk file at `:46-48`.
  **Call-site count: 102.** (`grep -ro "getTenant(" packages/host/src --include=*.ts | grep -v '\.test\.ts'`
  → 104 occurrences; minus the definition at `tenant.ts:35` and the doc-comment mention at `types.ts:47`.)
  Highest-density files: `handlers/edit.ts` (18), `handlers/knowledge.ts` (16), `handlers/jobs.ts` (12),
  `handlers/agents.ts` (11), `handlers/settings.ts` (6).
- **`ensureLocalOwner`** — `packages/db/src/ensure-local-owner.ts:17-101`. Upserts the `user` row
  (`:18-26`), the `personal` org (`:28-39`), the home workspace (`:41-53`), the org membership (`:61-72`) and
  the workspace membership (`:79-91`); returns `role: "owner"` unconditionally (`:97`). It resolves the org by
  `eq(organizations.slug, PERSONAL_ORG_SLUG)` (`:28`) — **one org per database, by construction.**
- **Local-owner constants** — `packages/core/src/local-owner.ts:1-6`: `LOCAL_OWNER_ID = "local-owner"`,
  `PERSONAL_ORG_SLUG = "personal"`, `HOME_WORKSPACE_SLUG = "home"`, `WORKSPACE_COOKIE = "agentforge_workspace"`.
  `pickWorkspaceId` at `:16-31` accepts a preferred id **only if it is in the list passed in** (`:20-22`),
  otherwise falls back to home (`:23-26`) — it never errors on a foreign id, it silently substitutes.
- **Workspace selection** — `packages/host/src/workspace.ts:8-24`: `<dataDir>/workspace-id.txt`, machine-wide.
  The cookie flow: `http-adapter.ts:309` sets `workspaceId: cookies[WORKSPACE_COOKIE] || readSelectedWorkspaceId() || null`,
  which reaches `getTenant(request.workspaceId)` at all 102 call sites. The cookie is entirely client-supplied;
  the only thing standing between it and a foreign desk is `pickWorkspaceId`'s membership test, which today
  operates on a single org's desks.
- **Tables carrying `organization_id`: 13 of 36** (all `packages/db/src/schema.ts`):
  `organization_members` `:39`, `workspaces` `:57`, `workspace_members` `:79`, `agents` `:97`,
  `agent_versions` `:124`, `tools` `:142` (**nullable** — a null org is a built-in tool),
  `agent_tool_bindings` `:159`, `threads` `:173`, `messages` `:193`, `runs` `:210`, `tool_invocations` `:235`,
  `media` `:457`, `edit_projects` `:475`.
- **Tables holding user data with no `organization_id`: 21.** Keyed on `workspace_id` (14, all reachable via
  `workspaces.organization_id`): `knowledge_soul` `:249`, `knowledge_memories` `:258`, `knowledge_sources`
  `:270`, `knowledge_workspace_backend` `:301`, `knowledge_backend_outbox` `:322`, `knowledge_settings` `:339`,
  `knowledge_vectors` `:347`, `knowledge_retrievals` `:372`, `knowledge_graph_nodes` `:401`,
  `knowledge_graph_edges` `:420`, `knowledge_verify` `:438`, `knowledge_maps` `:445`, `artifacts` `:598`,
  `datasets` `:617`. Keyed on `project_id` (5, reachable via `edit_projects.organization_id`): `edit_ops`
  `:495`, `edit_snapshots` `:516`, `edit_jobs` `:530`, `edit_cards` `:557`, `edit_unplaced` `:580`.
  **Not reachable from any organization row:** `market_cache` `:641` (keyed on `(ticker, kind)` only) and
  `user` `:15` (global identity, reachable only through `organization_members`). Two FTS5 tables live outside
  drizzle: `knowledge_chunks` (`drizzle/0003_knowledge.sql:33`, `ensure-schema.ts:594`) carries
  `workspace_id`; `market_news_fts` (`0009_market.sql:12`, `ensure-schema.ts:351`) carries `ticker` only.
- **How reads filter today** (audited module by module, all paths under `packages/host/src/`):
  - `threads.ts` — `getThread` filters org + workspace + user + id (`:54-60`); `listWorkspaceThreads` `:93-95`;
    `deleteThread` `:132-137`; `listRunUsage` `:336`. Clean.
  - `artifacts.ts` (`get` `:165`, `list` `:152,158`, `remove` `:175`) and `datasets.ts` (`:257,263,294,299`) —
    every statement `workspace_id = ? AND id = ?`. Clean.
  - `knowledge.ts` / `knowledge/*` — every statement carries `workspace_id`: `:174,199,204,611`,
    `backend-store.ts:107,114,123,131`. Clean.
  - `edit/projects.ts` — `listEditProjects` org + workspace (`:122`); `getEditProjectBundle` gates on
    `foldProject(projectId, tenant.workspaceId)` (`:137`) then reads children by `project_id` alone
    (`:139-141`).
  - `legal/store.ts` — workspace id in the path (`:114`) **and** re-verified against the record (`:125`). The
    strictest module in the tree.
  - `media.ts` (`:24,73`) and `handlers/media.ts:33` — `organization_id`-scoped. **Media is org-scoped, not
    desk-scoped** (deliberate, `knowledge.ts:627-628`): a file uploaded on desk A is readable from desk B in
    the same org.
  - `market/repo.ts` — `readCached` `:225-226`, `writeCached` `:292-295`, `searchNews` `:350-351`: no tenant
    parameter exists. A deliberate shared cache of public data.
- **Storage path keying** — `media-root.ts:4-8` (`MEDIA_ROOT` env, else `<dataDir>/media`), written at
  `media.ts:47-48` as `${tenant.organizationId}/${id}.${ext}`; job scratch `edit/ffmpeg/paths.ts:42-44`
  (`<dataDir>/edit/<projectId>`, allowlist at `:46-48`); `datasets.ts:316`; `legal/store.ts:305-306`.
- **Per-install JSON state** — gate state `gateway-gate.ts:29` + path `:113` (`<dataDir>/gateway-gate.json`);
  desk usage `desk-usage.ts:8-10`, whose three exports take no tenant at all (`:41-76`) and are blended into
  per-workspace reports at `account-usage.ts:165,201,260,304`; secrets `settings-store.ts:28`
  (`<dataDir>/settings.enc`), shape `{ version: 2; locale?; workspaces: Record<string, StoredSecrets> }`
  (`:118-120`) — **one file, one slice per desk, one machine-wide locale** (`:402-409`).

---

## 3. Design decisions

### (a) Tenant = portal `tenant_id`; org = portal `org_id`

Add one `tenants` table and one `tenant_id` column on `organizations`. Do **not** add a column to the other 35
tables.

The portal's own model is the source of truth: `tenants` is the whitelabel partner and the root of every RLS
scope (`docs/internal/portal/schema.md:54-60`); `orgs` is "the billing and seat boundary inside a tenant"
(`:69-74`). `auth_sessions` already stores both (`schema.ts:668-669`), so the host has the two ids on every
request without a new lookup.

**Reachability.** With `organizations.tenant_id` in place, every table that holds user data reaches a tenant:
13 directly, 14 through `workspaces.organization_id`, 5 through `edit_projects.organization_id`. The exceptions,
stated plainly:

- `market_cache` (`schema.ts:641-652`) and `market_news_fts` (`0009_market.sql:12`) have no path to an
  organization. A read-through cache of public ticker data; it stays shared. The risk is not confidentiality
  but **cache poisoning across tenants**. Accept for Phase 3.
- `user` (`schema.ts:15-25`) is global identity with a unique `email` (`:18`), so two tenants cannot hold the
  same address. **Recommendation: key users on the portal `user_id` and drop the reliance on `email`
  uniqueness** — the host never authenticates on email, only the portal does.
- `tools.organization_id` is nullable (`schema.ts:142`); a null row is a shared built-in. Leave it null and
  read null as "visible to every tenant".

**Rejected: a `tenant_id` column on all 36 tables.** Thirteen would be redundant with `organization_id`, 19
would need a backfill through a join they do not have, and the invariant "`tenant_id` agrees with the tenant of
`organization_id`" would need a trigger or a test on every write path.

**Rejected: a database file per tenant.** It makes `getTenant` a connection factory, breaks the `db` singleton
in `packages/db/src/client.ts:44-45` that all 102 call sites import transitively, turns `ensureSchema`
(`ensure-schema.ts:192`) into a per-request concern, and makes a cross-tenant query (seat counting, usage
roll-up) impossible without opening N files.

### (b) SQLite stays; add `busy_timeout`

`packages/db/src/client.ts:44-45` sets `journal_mode = WAL` and `foreign_keys = ON` and nothing else. WAL gives
concurrent readers with one writer, but **no `busy_timeout` is set**, so a second writer gets `SQLITE_BUSY`
immediately instead of waiting. Add `sql.pragma("busy_timeout = 5000")` alongside them. That is the entire
Phase 3 database-engine change.

**Rejected: Postgres now.** `vault-key.ts:23-26` throws on a `postgres://` URL, and moving means a dialect change
across `packages/db` plus the hand-written `db.$client.prepare(...)` statements in `artifacts.ts:152-175`,
`datasets.ts:257-299`, `knowledge.ts` and `ensure-local-owner.ts:178-186`. **Exact trigger for revisiting:** a
sustained p99 write latency above 200 ms on `/api/v1/threads/:threadId/runs/*`, or any `SQLITE_BUSY` reaching a
client after `busy_timeout` is in place — both measurable from the L1 logger once it carries a request id. Kyo
owns the measurement (migration plan open question 1).

### (c) `getTenant(request)` — source-compatible

```ts
export async function getTenant(
  input?: string | null | Pick<HostRequest, "workspaceId" | "session">,
): Promise<TenantContext>
```

A string or null behaves exactly as today. An object with a `session` resolves from the session; an object
without one falls through to `ensureLocalOwner`. All 102 call sites pass `request.workspaceId`
(`string | null | undefined`) — **they compile unchanged**. Lane E then sweeps them to pass `request`, which
changes no desktop behaviour. `TenantContext` gains `tenantId: string` (`tenancy/types.ts:13-18`);
`ensureLocalOwner` returns the synthetic local tenant id (see §4); `requireTenant` (`types.ts:20`) is called
once at the top of `dispatch` (`router.ts:352`), so a handler that forgets is a 500, not a leak.

**Rejected: a new `getSessionTenant()` alongside the old one.** Two resolvers means 102 sites to classify by
hand and no compiler help for the ones missed.

### (d) The workspace cookie must name a desk the session's tenant owns

Today `pickWorkspaceId` (`local-owner.ts:20-26`) silently substitutes home when the preferred id is not in the
list. In server mode that becomes `404 not_found` with the cookie cleared — silent substitution masks a real
bug and tells a prober the id was wrong. Desktop and webdev: substitution unchanged.

`workspace-id.txt` (`workspace.ts:8-24`) becomes **desktop-only**. `http-adapter.ts:309` must not call
`readSelectedWorkspaceId()` in server mode, and `rememberSelectedWorkspace` (`tenant.ts:19-25`) must not write
it: on a shared box the last browser to load the app would repoint every deskless read for everyone.

### (e) Per-install JSON state

| State | Today | Phase 3 | Why |
|---|---|---|---|
| Gateway gate | `gateway-gate.ts:29,113` — one JSON file | **A row per `(tenant_id, org_id)`** | Read on nearly every settings call and written by `maybeRefreshGateway` (`:527`); a file per tenant would be N handles on a hot path. A row also makes "which tenants are blocked" one query. |
| Desk usage | `desk-usage.ts:8-10` — one JSON file, appended at `:66`, no tenant parameter anywhere (`:41-76`) | **A row per tenant** (the Phase 5 `tenant_usage` table, created early with only the columns Phase 3 needs) | Append-only metering; a file every tenant appends to is a write-contention point and cannot be queried per period. |
| `settings.enc` | `settings-store.ts:28`, shape `:118-120` | **Stays a file, per tenant, at `<dataDir>/tenants/<tenantId>/settings.enc`** | Keeping it a file preserves the AES-256-GCM envelope and `getLocalVaultKey()` (`vault-key.ts:123`) unchanged, keeps the desktop backend byte-identical, and lets a tenant's secrets be deleted by removing a directory. The row backend is Phase 4's job (`web-migration-plan.md:186-191`); doing it here collides with that lane. |

The machine-wide locale (`settings-store.ts:402-409`) moves into the same per-tenant file; copy and catalogues
are untouched. `clearGatewayKeyEverywhere` (`:371-386`) is deliberately machine-wide — in server mode
"everywhere" must mean "this tenant's desks", or one tenant's key reset signs out every other tenant. That is a
Phase 3 fix, not a Phase 4 one, because Phase 3 is when a second tenant exists. **The parent plan agrees:**
`web-migration-plan.md` § Phase 3 now owns the scoping and § Phase 4 only has to keep it green across the
backend swap. The scoping and the backend are separate changes — only the scoping comes forward; `settings.enc`
stays a file until Phase 4.

### (f) Per-tenant storage prefix now

Introduce the prefix in Phase 3 so Phase 6 is a backend swap, not a data migration. `media.ts:47` becomes
`${tenant.tenantId}/${tenant.organizationId}/${id}.${ext}`; `edit/ffmpeg/paths.ts:42-44` becomes
`<dataDir>/tenants/<tenantId>/edit/<projectId>`, with the allowlist at `:46-48` re-derived per tenant so an
ffmpeg argument cannot reach another tenant's tree; `datasets.ts:316` and `legal/store.ts:305-306` gain the
same `tenants/<tenantId>/` segment.

Existing rows keep their stored `storage_path` (`schema.ts:464`, `:627`), read verbatim at
`handlers/media.ts:39`. Only new writes take the prefix — no file moves, so the desktop's media keeps
resolving.

---

## 4. Schema and migration

### Drizzle additions (`packages/db/src/schema.ts`)

```ts
/** The whitelabel partner, from the portal (docs/internal/portal/schema.md:54-60). One row per
 *  portal `tenants.id`; the desktop and any pre-Phase-3 database hold exactly the LOCAL_TENANT_ID row. */
export const tenants = sqliteTable("tenants", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  /** active | inactive — drives the portal's `tenant_inactive` reason code. */
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
});
```

and one column on the existing table:

```ts
export const organizations = sqliteTable("organizations", {
  id: uuidPk(),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  // … name, slug, industryPack, createdAt unchanged (schema.ts:29-32)
}, (table) => [index("organizations_tenant_idx").on(table.tenantId)]);
```

`organizations.slug` is `.notNull().unique()` today (`schema.ts:30`). With many tenants, two tenants both
having a "personal" org is normal, so the unique index must become
`uniqueIndex("organizations_tenant_slug").on(table.tenantId, table.slug)`.

**No `tenant_members` table.** Membership already exists as `organization_members` (`schema.ts:35-51`), and the
portal is the authority on who belongs to which org (`portal/schema.md:97-103`). A host-side tenant membership
table would be a second, staler copy.

**No `tenant_plan` columns.** Deferred to Phase 5 (`web-migration-plan.md:210-212`), which owns both
`tenant_plan` and `tenant_usage`. Phase 3 creates `tenant_usage` only if lane D lands the desk-usage move; if it
slips, the JSON file stays and Phase 5 does it.

### `packages/db/drizzle/0015_tenants.sql`

```sql
-- Phase 3 (docs/internal/web-phase3-tenancy-spec.md). Declared defensively like 0010-0014.
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tenants_slug_unique` ON `tenants` (`slug`);
--> statement-breakpoint
-- The one tenant every pre-Phase-3 database resolves to. Deterministic id: a desktop that has
-- already migrated and a fresh install must agree, and nothing downstream may see a UUID here.
INSERT OR IGNORE INTO `tenants` (`id`, `slug`, `name`, `status`, `created_at`)
VALUES ('local-tenant', 'local', 'Local', 'active', CAST(strftime('%s','now') AS INTEGER) * 1000);
--> statement-breakpoint
-- SQLite cannot ADD COLUMN ... NOT NULL REFERENCES without a default, so the column lands
-- nullable, is backfilled, and the NOT NULL is enforced by the drizzle type plus the test below.
ALTER TABLE `organizations` ADD `tenant_id` text REFERENCES `tenants`(`id`);
--> statement-breakpoint
UPDATE `organizations` SET `tenant_id` = 'local-tenant' WHERE `tenant_id` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizations_tenant_idx` ON `organizations` (`tenant_id`);
--> statement-breakpoint
DROP INDEX IF EXISTS `organizations_slug_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizations_tenant_slug` ON `organizations` (`tenant_id`,`slug`);
```

Add `LOCAL_TENANT_ID = "local-tenant"` to `packages/core/src/local-owner.ts` beside `LOCAL_OWNER_ID` (`:1`), and
export it from `packages/core/src/index.ts`.

### How `ensureSchema` applies it

`packages/db/src/ensure-schema.ts:192-232` reads `meta/_journal.json` (`:82-86`), compares against
`__drizzle_migrations` (`:6`), and applies whatever is newer than the last `created_at` (`:216`, `:221`). Adding
entry `idx: 15, tag: "0015_tenants", when: 1788820000007` to the journal is all that is required for a database
already stamped through `0014`.

Two existing hazards this must respect:

1. A database that was **baseline-stamped** (`:209-213` — all kernel tables present, zero journal rows) gets
   every migration marked applied without running, `0015` included, so `tenants` would never be created.
   Mitigate the way `0010`-`0014` already do: an `ensureTenantTables(sqlite)` healer beside
   `ensureArtifactTables` / `ensureDatasetTables` (`:231-232`) that creates the table, inserts the
   `local-tenant` row and backfills `organizations.tenant_id` when the column is missing — the same idempotent
   `PRAGMA table_info` shape as `workspaceColumns` (`:182-190`).
2. `REQUIRED_TABLES` (`:8`) drives the partial-init refusal at `:197-202`. **Do not add `tenants` to it** — an
   existing desktop database has all current kernel tables and no `tenants`, which would make
   `present.length > 0 && missing.length > 0` true and throw "Refusing to migrate or baseline-stamp" on the
   frozen desktop's first launch. The healer covers it instead.

### Proof the desktop opens with no re-seed

`ensureLocalOwner` finds the existing org by `eq(organizations.slug, PERSONAL_ORG_SLUG)`
(`ensure-local-owner.ts:28`) and the existing user by `eq(user.id, LOCAL_OWNER_ID)` (`:18`). `0015` adds a
column and a row; it touches neither `user`, `organizations.id`, `workspaces`, nor any content table, and every
foreign key pointing at `organizations.id` still resolves. Additive-only — and §6 asserts exactly that against
a copied real database.

---

## 5. Handler audit

`packages/host/src/router.ts:158-291` — **129 route registrations, 55 of them by-id.** Per family:

| Family (router.ts lines) | Store module | Org/workspace filter today | Phase 3 change |
|---|---|---|---|
| ping `:159` | — | n/a | none |
| auth `:161-164` | `auth/routes.ts:192` | session is the subject | mint the CSRF token bound to the session id (`csrf.ts:89-91`) |
| edit `:165-184` (18 routes, 17 by-id) | `edit/projects.ts`, `edit/ops.ts`, `edit/jobs.ts` | **partial** — handlers gate on `foldProject(projectId, tenant.workspaceId)` (`handlers/edit.ts:146,183,198,380,397,407,418,438,462`) and `jobInProject` (`handlers/edit.ts:171-177`); the store functions themselves do not | fix the ungated route (below); push the workspace filter into `loadProjectRow` by making its second argument required (`edit/ops.ts:66-76`) |
| settings `:185-190` | `settings-store.ts`, `gateway-gate.ts` | desk slice by `tenant.workspaceId` (`handlers/settings.ts:349,363`) | per-tenant `settings.enc` and gate row (3e); scope `clearGatewayKeyEverywhere` (`settings-store.ts:371`) |
| usage `:191` | `account-usage.ts`, `desk-usage.ts` | **no** — `desk-usage.ts:41-76` takes no tenant; merged unfiltered at `account-usage.ts:165,201,260,304` | move to per-tenant rows (3e) |
| components `:194-195` | `components/*` | n/a — server-wide, ungated on purpose (`router.ts:192-193`) | Phase 7, not here |
| chat `:196` | `threads.ts` | yes | none |
| workspaces `:197-203` (5 by-id) | `ensure-local-owner.ts` | yes — `updateLocalWorkspace` `:156`, `deleteLocalWorkspace` `:199` both `and(id, organizationId)` | 404 on a foreign desk (3d); `handleSelectWorkspace` must stop writing `workspace-id.txt` in server mode |
| threads / runs `:204-210` (5 by-id) | `threads.ts` | yes — `:54-60`, `:93-95`, `:132-137` | none beyond `getTenant` |
| models `:211-212` | `models.ts` | gateway catalogue, not tenant data | none |
| media `:213-214` (1 by-id) | `media.ts`, `handlers/media.ts` | yes, **org-level only** — `handlers/media.ts:33`, `media.ts:24,73` | tenant prefix on write (3f); keep the org filter |
| images / videos `:215-220` (1 by-id) | `handlers/jobs.ts`, `video-examples.ts` | yes via `media.ts` | none |
| documents / presentations / research / data `:221-228, :241-242` | `handlers/jobs.ts`, `artifacts.ts` | yes via `artifacts.ts:152-175` | none |
| finance `:229-235` | `finance-*.ts`, `artifacts.ts` | yes via artifacts | none |
| market `:236-240` | `market/repo.ts` | **no** — `:225-226`, `:292-295`, `:350-351` have no tenant parameter | accepted shared cache (3a); document it |
| datasets `:243-246` (2 by-id) | `datasets.ts` | yes — `:257,263,294,299` | tenant prefix on the raw file (`datasets.ts:316`) |
| legal `:247-256` (7 by-id) | `legal/store.ts` | yes, twice — path `:114` and record check `:125` | tenant prefix on `legalRoot()` (`:305-306`) |
| prompts `:257` | — | n/a | none |
| artifacts `:258-261` (3 by-id) | `artifacts.ts` | yes — `:165,175` | none |
| knowledge `:262-277` (3 by-id) | `knowledge.ts`, `knowledge/*` | yes — `:174,199,204,611`, `backend-store.ts:107,114,123,131` | none |
| agents `:278-286` (9 by-id) | `handlers/agents.ts` | yes via `AgentService` on `agents.organizationId` (`schema.ts:97`) | verify each of the 9 in the harness |
| misc `:287-290` | `handlers/misc.ts` | `GET /api/v1/organizations` returns the caller's orgs | must return only the session tenant's orgs |

### IDOR-risk by-id routes

**Confirmed, today, on the tree:**

- **`POST /api/v1/edit/projects/:projectId/unplaced/:itemId/discard`** — `router.ts:183` →
  `packages/host/src/handlers/edit.ts:501-516`. It calls `getTenant(request.workspaceId)` at `:503` and
  **throws the result away**, then runs `db.update(editUnplaced).set({ discardedAt: new Date() })
  .where(eq(editUnplaced.id, request.params.itemId)).returning()` at `:504-508` — neither the tenant nor the
  `:projectId` in its own path constrains the row, and `edit_unplaced` carries only `project_id`
  (`schema.ts:580-595`), so nothing downstream re-checks. It then returns the row body at `:512`. Any caller
  can soft-delete and read back any other desk's unplaced item by id. The sibling
  `handlePostEditUnplacedPlace` (`:458-499`) does it correctly: `foldProject(projectId, tenant.workspaceId)`
  at `:462`, then `item.projectId !== projectId` at `:466-468`. **Fix first, in lane A.**

**Latent — safe only because every caller happens to be correct:**

- `edit/jobs.ts:105-112` `getEditJob(jobId)` — `eq(editJobs.id, jobId)`, no project or tenant filter.
- `edit/jobs.ts:96-103` `patchJob(id, values)` — `eq(editJobs.id, id)`, no filter.
- `edit/ops.ts:66-76` `loadProjectRow(projectId, workspaceId?)` — base query is id-only at `:67`; the workspace
  check at `:72-74` is skipped entirely when the optional argument is omitted, which `edit/jobs.ts:128,135,152`
  and `edit/undo.ts:49,81` all do.
- `edit/ops.ts:130-251` `appendOps` — mutates `edit_ops` / `edit_snapshots` by `project_id` alone.
- `edit/undo.ts:36,76` `undoCard` / `keepCard` — `eq(editCards.id, cardId)`, with the ownership test in
  application code at `:38` and `:78` rather than in the `WHERE`.

All five become real the moment a second tenant exists and one handler forgets its `foldProject`. Lane A makes
the workspace argument required and pushes the filter into the `WHERE`.

---

## 6. Test plan

**`packages/host/src/tenancy-harness.test.ts`** (row T3). Not 55 hand-written tests — one table
(`BY_ID_ROUTES`, an entry of `{ method, path, seed }` per by-id registration in `router.ts:158-291`) plus one
loop. For each row: seed the resource as tenant A through the real handler; call `dispatch` with tenant B's session
and A's ids; assert `status === 404`, assert the body is exactly the `not_found` envelope, and assert no field
of A's record appears in the serialised response (substring check on A's id and on a marker planted in the
record's text fields — this catches a 200 leaking through a nested object). A completeness assertion re-derives
the list from the router table, so a new by-id route cannot ship without a tenancy test.

**Migration test** — `packages/db/src/migrate-0015.test.ts`. Copy a real single-owner SQLite (fixture built by
running `ensureSchema` + `ensureLocalOwner` against the `0014` journal), run `ensureSchema`, then assert:
exactly one `tenants` row, `id = 'local-tenant'`; every `organizations` row has that `tenant_id`; the `user`
row still has `id = 'local-owner'`; workspace ids unchanged; row counts in `threads`, `artifacts` and
`datasets` unchanged. Repeat against a **baseline-stamped** copy (journal rows present, `tenants` absent) to
prove the healer covers `ensure-schema.ts:209-213`.

**Desktop-mode test** — extend `packages/host/src/tenant.test.ts`: with no `AGENTFORGE_SERVER` and no
`request.session`, `getTenant(request)` returns the personal org, `userId = "local-owner"`
(`local-owner.ts:1`), `role = "owner"`, `tenantId = "local-tenant"`, and `workspace-id.txt` is still written
(`workspace.ts:21-23`). Plus a server-mode test that the file is **not** written.

**CSRF binding** — a token minted under session A is rejected on a mutating call carrying session B
(`csrf.ts:84-101`), which is the gap `csrf.ts:89-91` names.

**webdev `:3000` unchanged.** Every new behaviour is behind `isServerMode()` (`server-mode.ts:12`). The existing
suites are the regression net: `packages/host` and `apps/web` must stay green with no environment set, and the
Playwright config (`apps/web/playwright.config.ts:15-25`) is not touched. Drive the result on the running
isolated webdev; do not start a second port.

---

## 7. Work breakdown — five non-overlapping lanes

No two lanes write the same file. Order: **A and B first and in parallel**, then C, D, E in parallel behind them.

**Lane A — close the IDOR, harden the edit store.** *No dependencies. Start immediately.*
Files: `packages/host/src/handlers/edit.ts`, `edit/ops.ts`, `edit/jobs.ts`, `edit/undo.ts`,
`edit/projects.ts` + their tests. Work: fix `handlePostEditUnplacedDiscard` (`handlers/edit.ts:501-516`) to
mirror `…Place` (`:458-499`); make `loadProjectRow`'s second argument required (`edit/ops.ts:66`); add
`projectId` to the `WHERE` in `getEditJob` / `patchJob` (`edit/jobs.ts:96-112`) and `undoCard` / `keepCard`
(`edit/undo.ts:36,76`). **Done when:** a foreign `itemId` 404s on discard; every edit store function taking an
id also takes and uses a scope; the edit suite is green.

**Lane B — schema, migration, `TenantContext`.** *No dependencies.*
Files: `packages/db/src/schema.ts`, `drizzle/0015_tenants.sql`, `drizzle/meta/_journal.json`,
`packages/db/src/ensure-schema.ts`, `ensure-local-owner.ts`, `client.ts` (the `busy_timeout` pragma),
`migrate-0015.test.ts` (new), `packages/core/src/local-owner.ts`, `tenancy/types.ts`, `index.ts`.
**Done when:** the migration test passes on a real copy and a baseline-stamped copy; `TenantContext` has
`tenantId`; `ensureLocalOwner` returns `LOCAL_TENANT_ID`; the desktop boots against an existing database.

**Lane C — `getTenant`, the session seam, the workspace cookie.** *Depends on B.*
Files: `packages/host/src/tenant.ts`, `workspace.ts`, `http-adapter.ts`, `router.ts`, `csrf.ts`, `types.ts` +
their tests. Work: the overloaded `getTenant`; session-backed resolution; `requireTenant` at the top of
`dispatch` (`router.ts:352`); 404 on a foreign workspace cookie; `workspace-id.txt` desktop-only; CSRF bound to
the session id. **Done when:** two sessions on one server resolve to two different `organizationId`s; the
desktop resolves the local owner with no session; a foreign `WORKSPACE_COOKIE` 404s.

**Lane D — per-tenant state and storage prefixes.** *Depends on B.*
Files: `packages/host/src/settings-store.ts`, `gateway-gate.ts`, `desk-usage.ts`, `account-usage.ts`,
`media.ts`, `media-root.ts`, `datasets.ts`, `legal/store.ts`, `edit/ffmpeg/paths.ts`.
**Done when:** two tenants hold different gateway keys and get different verdicts;
`clearGatewayKeyEverywhere` clears one tenant; new media/datasets/legal/scratch writes land under
`tenants/<tenantId>/`; existing `storage_path` rows still resolve.

**Lane E — the harness and the call-site sweep.** *Depends on A, B, C.*
Files: `packages/host/src/tenancy-harness.test.ts` (new), `handlers/*.ts` (mechanical
`getTenant(request.workspaceId)` → `getTenant(request)`), `log.ts` (tenant id and request id as fields, row L1).
**Done when:** all 55 by-id routes are in the harness and green; the completeness assertion is on; no handler
passes a bare workspace id; the log carries a tenant id.

Everything except the sign-in screen and the portal contract is inside these five lanes. The sign-in screen is
Phase 2 debt and stays out of Phase 3 — `dispatch` 401s without it, which is a correct hosted server with no
front door, not a broken one.

---

## 8. Risks and open questions for Kyo

1. **The portal browser-login contract is invented.** `portal-client.ts:20,213` posts
   `grant_type=authorization_code`, which appears nowhere in `portal/device-code-login.md:83-262`. If the portal
   has no such grant, Phase 3 resolves tenants from a session that cannot be created. Confirm the grant, the
   redirect-URI registration and the response field names (`portal-client.ts:140-142` expects `org_id` and
   `tenant_id`) before lane C starts. *(Plan open question 2.)*
2. **Tenant provisioning.** Nothing creates a `tenants` row except `0015`'s `local-tenant`. At first sign-in, by
   an operator, or by the billing webhook? Lane C cannot resolve a tenant that does not exist. *(Plan q9.)*
3. **`user.email` is globally unique** (`schema.ts:18`), so two tenants with the same person's email collide on
   the second sign-in. §3(a) recommends keying on the portal `user_id`; confirm, because the alternative
   changes a unique index on a table the desktop already populates.
4. **Media is org-scoped, not desk-scoped** (`media.ts:24,73`, deliberate per `knowledge.ts:627-628`). Correct
   at the tenant boundary, but every desk in one org shares an image pool. Intended? If not, `media` gains
   `workspace_id` and that belongs in this phase, not Phase 6.
5. **`market_cache` is shared across tenants by design** (`market/repo.ts:225,292,350`). Confidentiality is fine
   (public ticker data), but tenant A's stale or poisoned fetch is served to tenant B. Accept, or key per tenant
   at the cost of N× the upstream fetches?
6. **Concurrency caps stay global** (`concurrency.ts:288,290`); row T9 puts per-tenant caps at Phase 5. One
   tenant can occupy every ffmpeg slot for the queue timeout (`concurrency.ts:34`, 60 s). Acceptable for the
   first tenants, or does the per-tenant cap move forward into lane D?
7. **`settings.enc` per tenant is a file, not a row** (§3e). Confirm the two-step is intended — Phase 3 splits
   the file per tenant, Phase 4 swaps the backend behind the same interface
   (`web-migration-plan.md:186-190`) — so it is not re-litigated mid-Phase-4. The plan now records the same
   two-step, so this is a confirmation, not a conflict between the two docs.
8. **SQLite write concurrency is unmeasured.** §3(b) proposes `busy_timeout = 5000` and a Postgres trigger. Who
   runs the measurement, against what load? *(Plan q1.)*
9. **The `0015` rollback story.** SQLite cannot drop a column before 3.35 and the runner
   (`ensure-schema.ts:160-176`) is forward-only with no `down`. A bad `0015` means restoring the data volume.
   Is a backup-before-migrate step in `webapp-deploy/` in place before this ships?
10. **`GET /api/v1/organizations`** (`router.ts:290`) is the one route that lists orgs directly. Should a tenant
    admin see every org in their tenant, or only the orgs they belong to? The portal answers per user
    (`portal/schema.md:97-103`); the host has no admin role beyond `MembershipRole` (`tenancy/types.ts:1-2`).

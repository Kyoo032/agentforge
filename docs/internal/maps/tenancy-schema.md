# Map — Tenancy schema and TenantContext

Last verified: 2026-09-20 at c204e5e

## Overview

The tenant is the whitelabel partner from the portal, and it is the root of every data scope in the
host. Phase 3 lane B puts it in the schema: one `tenants` table, one `tenant_id` column on
`organizations`, and a `tenantId` on the `TenantContext` every handler already carries.

This page is the data model only. Resolving a tenant from a browser session is lane C
(`getTenant(request)`), per-tenant files and storage prefixes are lane D, and the by-id route
harness is lane E. None of those exist yet, so on `main` today every request still resolves to the
one `local-tenant` row.

## How it works

**The shape.** `tenants` (`packages/db/src/schema.ts:32`) is one row per portal `tenants.id`:
`id`, a unique `slug`, `name`, a `status` of `active | inactive`, and `created_at`.
`organizations` (`:41`) gains `tenant_id` (`:45`), `notNull`, referencing `tenants.id` with
`onDelete: "cascade"`.

**Why one column and not thirty-six.** Every table holding user data already reaches an
organization — directly, or through `workspaces.organization_id`, or through
`edit_projects.organization_id` — so `organizations.tenant_id` is the single hop that puts every
row inside a tenant. A `tenant_id` on all 36 tables would be redundant on the 13 that already carry
`organization_id`, would need a backfill through a join the other 19 do not have, and would create
an invariant ("`tenant_id` agrees with the tenant of `organization_id`") that nothing enforces.

Three tables sit outside that reachability and are documented rather than fixed here:
`market_cache` and `market_news_fts` are a read-through cache of public ticker data and stay shared;
`tools.organization_id` is nullable, and a null row is a shared built-in visible to every tenant.

**Slug uniqueness moved.** `organizations.slug` was globally unique
(`packages/db/drizzle/0000_smiling_skin.sql:91`). Two tenants both having a "personal" org is
normal, so `0015` drops `organizations_slug_unique` and creates
`organizations_tenant_slug` on `(tenant_id, slug)`.

**The migration.** `packages/db/drizzle/0015_tenants.sql` creates the table, inserts the
deterministic `local-tenant` row, adds the column, backfills it, and swaps the indexes. It is
additive: it touches neither `user`, `organizations.id`, `workspaces` nor any content table, so an
existing database opens with no re-seed. The column lands nullable because SQLite cannot
`ADD COLUMN ... NOT NULL REFERENCES` without a non-null default; `notNull` is a drizzle-level claim
plus `packages/db/src/migrate-0015.test.ts`.

**Two paths apply it.** `ensureSchema` (`packages/db/src/ensure-schema.ts:192`) runs pending
migrations against the journal. A database that was **baseline-stamped** (`:208-213` — every kernel
table present, zero journal rows) has `0015` marked applied without ever running, so
`ensureTenantTables` (`:418`, called at `:235`) re-creates the table, re-inserts the row and
backfills the column. Same idempotent `PRAGMA table_info` shape as the knowledge and workspace
healers beside it.

**`tenants` is deliberately not in `REQUIRED_TABLES`** (`:8`). That list drives the partial-init
refusal at `:197`. An existing desktop database has every current kernel table and no `tenants`,
which would make `present.length > 0 && missing.length > 0` true and throw "Refusing to migrate or
baseline-stamp" on the frozen desktop's first launch. The healer covers that case instead.

**The context.** `TenantContext` (`packages/core/src/tenancy/types.ts:15`) gains
`tenantId: string` ahead of `organizationId`. `ensureLocalOwner`
(`packages/db/src/ensure-local-owner.ts:116`) returns the tenant of the org it resolved, and looks
that org up by `(tenant_id, slug)` (`:48`) rather than slug alone, because slug alone would pick an
arbitrary tenant's "personal" org once a second tenant exists.

**Engine.** `packages/db/src/client.ts:50` adds `busy_timeout = 5000` beside
`journal_mode = WAL` and `foreign_keys = ON`. WAL gives concurrent readers with one writer, but
without a busy timeout a second writer gets `SQLITE_BUSY` immediately instead of waiting. That is
the entire Phase 3 database-engine change.

**Failure modes.** A `SQLITE_BUSY` still reaching a client after the timeout is the stated trigger
for revisiting SQLite. A row inserted with a null `tenant_id` is possible at the SQLite level (the
column is nullable there) and would be invisible to any tenant-scoped query — the drizzle type is
what prevents it, so a raw `db.$client.prepare(...)` insert into `organizations` is the one path
that could create one.

## Where things live

| File | Role |
|---|---|
| `packages/db/src/schema.ts:32` | `tenants` table |
| `packages/db/src/schema.ts:41` | `organizations`, now with `tenant_id` and the composite unique index |
| `packages/db/drizzle/0015_tenants.sql` | The migration: table, local row, column, backfill, index swap |
| `packages/db/drizzle/meta/_journal.json` | Journal entry `idx: 15`, `when: 1788820000007` |
| `packages/db/src/ensure-schema.ts:418` | `ensureTenantTables`, the baseline-stamp healer |
| `packages/db/src/ensure-local-owner.ts` | Resolves the local owner inside `local-tenant` |
| `packages/db/src/tenants.ts` | `ensureTenant` / `getTenantById` / `getLocalTenant`, for lane C |
| `packages/db/src/client.ts:50` | `busy_timeout = 5000` |
| `packages/core/src/local-owner.ts:7` | `LOCAL_TENANT_ID`, beside `LOCAL_OWNER_ID` |
| `packages/core/src/tenancy/types.ts:15` | `TenantContext.tenantId` |
| `packages/db/src/migrate-0015.test.ts` | Fresh, single-org and baseline-stamped proofs |

## Gotchas

- **`local-tenant` is a literal, not a UUID.** A desktop that already migrated and a fresh install
  have to agree on the id, and the migration writes it as SQL text. Changing the constant in
  `packages/core/src/local-owner.ts:7` without a new migration orphans every existing row.
- **The healer runs on every boot, after `foreign_keys = ON`.** `ADD COLUMN ... REFERENCES` is only
  legal there because the column has no default other than null. Adding a `NOT NULL` to that
  statement would throw on every existing database.
- **The healer does not assume `organizations.slug` exists.** It guards the unique-index swap on the
  column being present: this code runs before anything else can report a problem, so throwing here
  bricks the open rather than repairing it.
- **`auth_sessions.tenant_id` (`schema.ts:692`) is not this column.** It predates Phase 3, comes
  from the portal session, and has no foreign key to `tenants`. Lane C is what joins them.
- **Nothing creates a tenant row but the migration.** `ensureTenant` exists and is exported, but no
  route calls it; who is allowed to provision a tenant is still open.

## Verify

No `verify-agentforge` feature file covers the schema — these are not user-facing behaviours and
there is no testid to press. The proofs are the suite:

- `packages/db/src/migrate-0015.test.ts` — the migration on a fresh database; on a database built by
  replaying migrations `0000`-`0014` and seeded like today's single-org install; and on a
  baseline-stamped copy. Asserts the local row, the backfill, the index swap, the cascade, the
  `busy_timeout`, and that the owner, desk and content row counts are unchanged.
- `packages/db/src/ensure-schema.test.ts` — the `drizzle-kit check` drift guard, which fails if
  `schema.ts` and the migration disagree.

`features/settings.md` and `features/workspaces.md` are the nearest user-facing proofs that an
existing database still opens; neither asserts anything about tenancy.

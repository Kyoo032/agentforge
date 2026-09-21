# Map — Database and migrations

Last verified: 2026-09-20 at a053245 + the Phase 4 branch `feat/web-phase4-tenant-secrets-rcbu9c` (through e37b3a1)

## Overview

`packages/db` is the whole persistence layer: one SQLite file, one Drizzle schema, one committed
migration folder, and the handful of functions that decide *where* that file lives and *which key*
wraps the secrets inside it. Every other package reaches storage through it — `@agentforge/host`
imports `db` for rows and `@agentforge/db/vault-key` for paths.

It is not a database abstraction. Postgres is refused out loud, not fallen back from
(`packages/db/src/vault-key.ts:23-27`), and there is no connection pool and no migration CLI in the
boot path. The tenant dimension landed with Phase 3 lane B and is deliberately narrow: one `tenants`
table (`packages/db/src/schema.ts:32-39`) and exactly one `tenant_id` foreign key, on `organizations`
(`:45-47`), because every content table already reaches an organization directly or through
`workspaces.organization_id`. `auth_sessions` carries a `tenant_id` as well (`:692`), but as a plain
string copied off the session rather than a reference. The data model itself is mapped on its own
page: [tenancy-schema.md](tenancy-schema.md).

## How it works

### Where the data dir is

`localDataDir(env)` (`packages/db/src/vault-key.ts:6-19`) is the one answer to "where does this
install keep its files", and three inputs decide it, in strict precedence:

1. `AGENTFORGE_SETTINGS_PATH` (`:7-13`). If it ends in `.json` or `.enc` the **directory holding it**
   is the data dir (`:9-11`); otherwise the value itself is (`:12`). A settings *file* path and a
   settings *directory* path are both accepted, which is why the extension test exists.
2. `AGENTFORGE_DATA_DIR` (`:14-17`). What the packaged Electron shell sets, to Electron's
   `userData` (`apps/desktop/main.cjs:622-624`).
3. `resolve(process.cwd(), "../../data")` (`:18`) — the repo's `data/` folder, resolved **relative to
   the current working directory**, not to the module. Running a script from the repo root instead of
   from a package directory therefore resolves a different data dir.

Only trimmed, non-empty values win: both reads are `?.trim()` and fall through when the result is
empty (`:7`, `:14`).

### Where the SQLite file is

`sqliteFilePath()` (`packages/db/src/vault-key.ts:21-35`) layers `DATABASE_URL` on top of that:

- a `postgres://` or `postgresql://` URL **throws**, with a message that names both supported
  alternatives (`:23-27`). This is the only database-engine decision in the repo, and it is a hard
  refusal rather than a fallback, so a leftover Postgres URL in an environment file fails loudly at
  the first import instead of silently writing to a second SQLite file.
- a `file:` URL has the scheme stripped and is used as a path (`:28-30`);
- any other non-empty `DATABASE_URL` is treated as a bare path (`:31-33`);
- otherwise `<localDataDir()>/agentforge.sqlite` (`:34`).

### The wrap key

`getLocalVaultKey(env)` (`packages/db/src/vault-key.ts:123-135`) returns the AES-256 wrapping key for
every sealed envelope on the install. Its behaviour splits on `isServerMode(env)`, which is
`AGENTFORGE_SERVER` being `1` or `true` (`packages/core/src/server-mode.ts:12-15`):

- **On a desk** (not server mode, `:125-127`): `AGENTFORGE_SECRETS_KEY` when set, else the
  `.master-key` file. `readOrCreateMasterKeyFile` (`:107-114`) creates the data dir, and on first use
  writes 32 random bytes as hex with mode `0o600` (`:111`), then reads it back trimmed (`:113`). No
  strength check is applied on a desk at all — a one-character `AGENTFORGE_SECRETS_KEY` is accepted.
- **In server mode** (`:128-134`): the env key is mandatory (`:128-130`, message at `:76-79`), and it
  must measure at least `MIN_VAULT_KEY_BYTES` = 32 (`:40`, checked at `:131-133`). The `.master-key`
  fallback is never reached, because a file invented on a container layer disappears with the
  container and takes every sealed envelope with it.

`vaultKeyEntropyBytes(secret)` (`:90-105`) is the measurement: hex with an even digit count counts
half its length (`:95-98`), canonical base64 / base64url counts its decoded length (`:99-104`), and
everything else counts **zero**. "Canonical" means re-encoding the decoded bytes reproduces the same
string modulo padding (`isCanonical`, `:80-82`) — that is what stops `Buffer.from(x, "base64")` from
laundering a typed passphrase into "32 bytes". The known limit is written down at `:75-78`: a
43-character alphanumeric passphrase *is* valid base64 of 32 bytes and passes.

Whatever comes back is hashed, not used raw: `wrappingKeyFromSecret` is
`sha256(secret)` (`packages/core/src/crypto/envelope.ts:14-16`), so any secret length produces a
32-byte key — which is precisely why the entropy check has to exist separately.

### Opening the connection

`packages/db/src/client.ts` is a module with side effects, and importing it *is* opening the database.
In order:

1. Four `dotenv` loads — `../../.env`, `../../.env.local`, `./.env`, `./.env.local` (`:11-14`).
2. `sqliteFilePath()` and `mkdirSync(dirname(file))` (`:16-17`).
3. **The pending-reset hook** (`:35-37`): when `AGENTFORGE_APPLY_PENDING_RESET === "1"` *and* no
   connection is cached, `applyPendingDataReset(localDataDir())` runs here — the last moment before
   SQLite takes a handle on the files. It is deliberately gated rather than unconditional (`:23-34`):
   importing this module must never delete data as a side effect of a test or a tool that only wanted
   `db`.
4. The connection, cached on `globalThis` outside production so hot reload does not open a second
   handle (`:19-21`, `:39-42`).
5. Two pragmas: `journal_mode = WAL` and `foreign_keys = ON` (`:44-45`).
6. `ensureSchema(sql)` (`:46`), then `drizzle(sql, { schema })` (`:48`).

The two processes allowed to set `AGENTFORGE_APPLY_PENDING_RESET=1` are the webdev server
(`apps/web/server-env.ts:14`, imported first precisely because ESM hoists imports — `:9-13`) and the
packaged shell's `bootstrapPackaged()` (`apps/desktop/main.cjs:631`).

### The schema

`packages/db/src/schema.ts` (706 lines) is Drizzle `sqliteTable` declarations only — no queries. Two
helpers set the house conventions: `uuidPk()` gives a text primary key defaulted from
`crypto.randomUUID()` (`:3-7`), and `createdAt()` gives a `timestamp_ms` integer (`:9-13`). Newer
tables skip both and declare plain `text("id").primaryKey()` with raw integer timestamps
(`artifacts`, `:623-639`).

The families:

| Family | Tables | Scope columns |
|---|---|---|
| Identity and tenancy | `tenants` (`:32`), `user` (`:15`), `organizations` (`:41`), `organization_members` (`:60`), `workspaces` (`:78`), `workspace_members` (`:97`) | `organizations.tenant_id` (`:45`) is the only foreign key into `tenants`; `organization_id` from `organization_members` down; `workspaces` carries `organization_id` (`:82`) |
| Agents | `agents` (`:118`), `agent_versions` (`:142`), `tools` (`:163`), `agent_tool_bindings` (`:177`) | `agents` carries both (`:122`, `:125`); `tools.organization_id` is **nullable** (`:167`) because platform tools are global |
| Conversation | `threads` (`:194`), `messages` (`:214`), `runs` (`:231`), `tool_invocations` (`:256`) | `threads` carries both (`:198`, `:201`); the other three carry `organization_id` only |
| Knowledge | `knowledge_soul` (`:274`), `knowledge_memories` (`:283`), `knowledge_sources` (`:295`), `knowledge_workspace_backend` (`:326`), `knowledge_backend_outbox` (`:347`), `knowledge_settings` (`:364`), `knowledge_vectors` (`:372`), `knowledge_retrievals` (`:397`), `knowledge_graph_nodes` (`:426`), `knowledge_graph_edges` (`:445`), `knowledge_verify` (`:463`), `knowledge_maps` (`:470`) | `workspace_id` on every one, as primary key on the singleton tables |
| Media | `media` (`:478`) | `organization_id` only (`:482`) — no workspace column |
| Edit | `edit_projects` (`:496`), `edit_ops` (`:520`), `edit_snapshots` (`:541`), `edit_jobs` (`:555`), `edit_cards` (`:582`), `edit_unplaced` (`:605`) | only `edit_projects` carries `organization_id` + `workspace_id` (`:500`, `:503`); the other five hang off `project_id` |
| Job outputs | `artifacts` (`:623`), `datasets` (`:642`) | `workspace_id` only (`:627`, `:646`) |
| Market | `market_cache` (`:666`) | **neither** — keyed `(ticker, kind)`, shared across the install (`:659-664`) |
| Hosted sessions | `auth_sessions` (`:688`) | `tenant_id`, `user_id`, `org_id` as plain strings (`:692-694`); desktop and webdev never write it (`:686`) |

Two tables exist only in SQL and have no Drizzle declaration, because they are FTS5 virtual tables:
`knowledge_chunks` (`packages/db/drizzle/0003_knowledge.sql`) and `market_news_fts`
(`packages/db/drizzle/0009_market.sql`). The schema file says so at `:662-664`.

### Migrations

`ensureSchema(sqlite)` (`packages/db/src/ensure-schema.ts:201-251`) runs on **every boot**, from
`client.ts:51`. There is no separate migrate step in the app's start path.

`migrationsFolder()` (`:64-79`) resolves the committed folder: `AGENTFORGE_MIGRATIONS_DIR` when set
*and existing* (`:66-72`), else `../../packages/db/drizzle` relative to `process.cwd()` (`:73-77`),
else a throw that lists what it tried (`:87`). The packaged shell sets the env var to
`process.resourcesPath/drizzle` (`apps/desktop/main.cjs:256-261`, assigned at `:626`).

What `ensureSchema` then does:

1. Reads `meta/_journal.json` and hashes each `.sql` file with SHA-256, matching
   `drizzle-orm/migrator.js` (`readMigrations`, `:81-103`, hash at `:99`).
2. Counts the 20 `REQUIRED_TABLES` (`:8-29`). A database with *some* but not all of them **refuses to
   run** — `"SQLite schema is partially initialized"` (`:197-202`) — unless the only missing ones are
   the six edit tables (`missingOnlyEditTables`, `:40-42`), which are healed below.
3. Turns `foreign_keys` **off** for the DDL (`:206`), because generated migrations are not
   topologically ordered and SQLite validates parents on `CREATE` when FKs are on. Back on at `:224`.
4. Either **baseline-stamps** (all kernel tables present but zero journal rows: insert every
   migration's hash without running it, `:209-213`, `stampMigrations` at `:146-152`) or **applies
   pending** ones in one transaction, skipping anything whose `when` is not strictly greater than the
   newest applied `created_at` (`applyPendingMigrations`, `:154-176`, the comparison at `:163-165`).
5. Runs twelve idempotent `ensure*` healers (`:225-236`) that re-declare or `ALTER` their way to the
   current shape for databases that were baseline-stamped past a migration they never actually ran.
   `ensureTenantTables` (`:235`, defined `:418-452`) is the newest, and its header explains why
   `tenants` is deliberately **not** in `REQUIRED_TABLES` (`:410-413`): an existing desktop database
   has every other kernel table and no `tenants`, which would make step 2 throw on first launch.
6. `assertKernelTables` (`:237`, defined `:693-699`) throws if anything is still missing.

The committed migrations, in journal order (`packages/db/drizzle/meta/_journal.json`):

| File | Adds |
|---|---|
| `0000_smiling_skin.sql` | The whole kernel: `user`, `organizations`, `organization_members`, `workspaces`, `workspace_members`, `agents`, `agent_versions`, `tools`, `agent_tool_bindings`, `threads`, `messages`, `runs`, `tool_invocations`, `media`, with their indexes |
| `0001_mysterious_ricochet.sql` | `workspaces.template_pack` |
| `0002_workspace_product_modes.sql` | `workspaces.product_modes` |
| `0003_knowledge.sql` | `knowledge_soul`, `knowledge_memories`, `knowledge_sources`, and the FTS5 `knowledge_chunks` |
| `0004_knowledge_rag.sql` | `knowledge_settings`, `knowledge_vectors`, `knowledge_maps` |
| `0005_overconfident_bromley.sql` | The six Edit tables: `edit_projects`, `edit_ops`, `edit_snapshots`, `edit_jobs`, `edit_cards`, `edit_unplaced` |
| `0006_artifacts.sql` | `artifacts` + `artifacts_ws_mode_idx` |
| `0007_datasets.sql` | `datasets` + `datasets_ws_idx` |
| `0008_knowledge_source_origin.sql` | Declares `knowledge_sources` **with** `origin_kind` / `origin_id` for fresh installs only; the columns and their unique index on existing tables are added by `ensureKnowledgeSourceOrigin` instead, because SQLite has no `ALTER TABLE IF EXISTS` (`0008_knowledge_source_origin.sql:1-4`) |
| `0009_market.sql` | `market_cache` + the FTS5 `market_news_fts` |
| `0010_knowledge_retrievals.sql` | `knowledge_retrievals` + two workspace indexes |
| `0011_knowledge_graph.sql` | `knowledge_graph_nodes`, `knowledge_graph_edges`, `knowledge_verify` |
| `0012_knowledge_vectors_model_idx.sql` | `knowledge_vectors_ws_model_idx` on `(workspace_id, model)` — the hybrid-retrieval lookup was a full table scan without it (`0012_knowledge_vectors_model_idx.sql:1-4`) |
| `0013_knowledge_weknora.sql` | `knowledge_workspace_backend` and `knowledge_backend_outbox`. `knowledge_sources.external_id` is deliberately **not** here — a bare `ALTER` would fail on a second application, so `ensureKnowledgeBackendTables` owns it (`0013_knowledge_weknora.sql:13-18`) |
| `0014_auth_sessions.sql` | `auth_sessions` + `auth_sessions_user_seen_idx`, `auth_sessions_expires_idx` |
| `0015_tenants.sql` | `tenants` + `tenants_slug_unique`, the `local-tenant` row, `organizations.tenant_id` backfilled to it, and the move of organization slug uniqueness from `organizations_slug_unique` to `organizations_tenant_slug` (`0015_tenants.sql:42-46`). Additive and one-way: the runner has no `down` and SQLite before 3.35 cannot drop a column (`0015_tenants.sql:12-13`) |
| `0016_tenant_usage.sql` | `tenant_usage` — one row per gateway call, priced in USD micros. See [`tenant-usage-ledger.md`](tenant-usage-ledger.md) |
| `0018_tenant_state.sql` | `tenant_state` + `tenant_state_key_idx` — a tenant's sealed settings and gateway verdict as rows on the hosted server, keyed `(tenant_id, key)` and cascading on tenant delete. See [`tenant-secrets-backend.md`](tenant-secrets-backend.md) |

**There is no `0017`, and the gap is deliberate.** Phase 5 lane B reserved that number while Phase 4 was in
flight, so the journal jumps from `idx: 16` (`when: 1788820000008`) to `idx: 18` (`when: 1788820000010`).
This matters because the runner is forward-only on `when`, not on `idx`: it applies an entry when
`lastAppliedCreatedAt < entry.when` (`applyPendingMigrations`, `packages/db/src/ensure-schema.ts:163-199`). A `0017` added later with
a `when` **below** `1788820000010` would be silently skipped on every database that has already run `0018`.
Lane B's migration must carry a `when` above it. `packages/db/src/migrate-0018.test.ts` asserts the journal
stays in ascending `when` order and that no `0017` tag has appeared without one.

From `0010` onward each file re-declares its tables with `CREATE TABLE IF NOT EXISTS`, on the stated
reasoning that a baseline-stamped database has the journal row but not necessarily the table
(`0012_knowledge_vectors_model_idx.sql:6-8`).

### The single local owner

There is exactly one user row, and it is a constant, not a login:
`LOCAL_OWNER_ID = "local-owner"`, `PERSONAL_ORG_SLUG = "personal"`, `HOME_WORKSPACE_SLUG = "home"`,
`HOME_WORKSPACE_NAME = "Default"`, `LEGACY_HOME_WORKSPACE_NAME = "Home"`
(`packages/core/src/local-owner.ts:1-14`). Phase 3 added the tenant trio beside them:
`LOCAL_TENANT_ID = "local-tenant"`, `LOCAL_TENANT_SLUG = "local"`, `LOCAL_TENANT_NAME = "Local"`
(`:7-9`). The id is deterministic rather than a UUID so a migrated desktop and a fresh install agree
on it (`:2-6`).

`ensureLocalOwner(db, preferredWorkspaceId?)` (`packages/db/src/ensure-local-owner.ts:20-124`) is
idempotent and runs on every tenant resolution (`packages/host/src/tenant.ts:120`). It, in order:
inserts the owner row if absent (`:21-29`, email `local@agentforge.local`); re-asserts the
`local-tenant` row (`:31-41`) for a test schema built without migration 0015 or the healer; looks up
the `personal` org **by tenant and slug together** and inserts it with `tenantId: LOCAL_TENANT_ID`
if absent (`:43-61`, the reason at `:43-44`: slug alone would pick an arbitrary tenant's "personal"
org once a second tenant exists); creates the `home` workspace named `Default` with
`WORK_PRODUCT_MODES` if the org owns none (`:63-75`); **renames a leftover `Home` to `Default`** on
the home slug (`:77-81`); ensures the org membership (`:83-94`) and the workspace membership
(`:101-113`); and returns the `TenantContext`, now carrying `tenantId: org.tenantId` (`:115-123`).
The workspace is chosen by `pickWorkspaceId` (`packages/core/src/local-owner.ts:24-39`): the
preferred id when it exists, else the `home` slug, else the first row, else
`throw new Error("workspace_missing")`.

The same file owns the workspace CRUD the rail uses: `listLocalWorkspaces` (`:126-128`),
`createLocalWorkspace` (`:130-168`, slug collisions get a random 8-char suffix, up to 8 attempts,
`:139-149`), `updateLocalWorkspace` (`:170-193`) and `deleteLocalWorkspace` (`:214-233`), which
**refuses to delete the `home` desk** with `code: "protected"` (`:227-229`) and wipes that
workspace's knowledge rows through raw `db.$client` statements first (`wipeKnowledgeForWorkspace`,
`:199-212`).

`packages/db/src/seed.ts` is the `db:seed` entry point: it registers the platform and university tool
catalogs (`:14-15`), inserts any tool key not already present with `organizationId: null` (`:17-30`),
then calls `ensureLocalOwner(db)` (`:32`) and exits.

### Start over, applied at next boot

`packages/db/src/reset.ts` implements a wipe that is **queued while the app runs and applied on the
next boot**, because the database is open and ffmpeg may still be writing.

- `requestDataReset(dir, entries)` (`:91-105`) validates every entry first (`rejectReason`, `:43-61`:
  must be a non-empty relative string, no drive letter, no leading separator, no `..`) and throws
  before writing anything if one fails. It then writes `reset-pending.json` (`:26`) as a temp file and
  renames it (`:99-104`) — a half-written marker would be read as malformed on the next boot and
  silently cancel the wipe. The caller is the Settings handler:
  `requestDataReset(localDataDir(), [...HOST_RESET_ENTRIES])`
  (`packages/host/src/handlers/settings.ts:352`, list at `:274-293`).
- `applyPendingDataReset(dir)` (`:248-283`) is safe on every boot. No marker → no-op (`:252-256`). A
  marker that is unreadable or not a valid v1 object is **deleted and the data kept** (`:257-268`) —
  a wipe is never inferred. Otherwise it removes each listed entry plus the SQLite trio
  (`SQLITE_ENTRIES`, `:29`), deletes the marker, and returns what went (`:270-282`).
- `removeEntry` (`:152-183`) never throws. Beyond the name check it resolves the parent's real path
  (`realTarget`, `:140-149`) and re-checks containment (`:168-171`) before `rmSync`, then deletes the
  **resolved** path rather than the spelling (`:174`), so a junction swap between check and delete
  cannot redirect it.
- `removeDatabaseElsewhere` (`:193-242`) covers a `DATABASE_URL` pointing outside the data dir, which
  the relative entries would otherwise miss entirely. It only runs when the directory being wiped
  *is* this install's data dir (`:196-198`), skips a refused (Postgres) URL (`:200-204`), and uses
  `lstat` so a symlink parked at the database path is reported and left alone (`:212-229`).
- The directory itself is never removed, because in the packaged app it is also Electron's userData /
  Chromium profile dir (`:8-10`).

`hasPendingDataReset` (`:291-293`) and `pendingResetPath` (`:286-288`) are what Settings uses to show
and cancel a queued wipe.

### The repository layer

`DrizzleAgentRepository` (`packages/db/src/repos/drizzle-agent-repository.ts:77-163`) is the only repo
in this package, implementing `AgentRepository` from core. Every method takes `organizationId` as its
first argument and `and()`s it into the `where` clause (`:96-141`), so a lookup by id alone is not
expressible through this class.

It also seals one column: `insertVersion` writes `systemPrompt` through `sealText`
(`:87`, `:16-18` — `sealPayload(value, getLocalVaultKey())` serialized to JSON) and `toVersion` reads
it back through `openText` (`:57`, `:20-33`). `openText` is deliberately forgiving: unparseable JSON
is treated as the raw value (`:22-26`) so a legacy plaintext prompt still opens, but a value that
parses and then fails to unseal returns the **empty string** (`:27-32`, the `catch` at `:30-31`), not
the ciphertext.

### Scripts

The root `package.json` exposes three, each a `pnpm --filter @agentforge/db` passthrough
(`package.json:13-15`) to a script in `packages/db/package.json:11-17`:

| Root script | Runs | Notes |
|---|---|---|
| `db:push` | `drizzle-kit push` | Pushes `src/schema.ts` straight at the database, bypassing the journal. Not what boot does. |
| `db:seed` | `tsx src/seed.ts` | Tools catalog + local owner; calls `process.exit(0)` on success (`packages/db/src/seed.ts:34`). |
| `db:studio` | `drizzle-kit studio` | Browser inspector. |

All three resolve the database through `packages/db/drizzle.config.ts:5-16`, which is a **second,
independent** implementation of the path rules — see Gotchas. `generate` (`drizzle-kit generate`) is
a package script only, not exposed at the root (`packages/db/package.json:12`).

## Where things live

| File | Role |
|---|---|
| `packages/db/src/vault-key.ts` | `localDataDir()`, `sqliteFilePath()`, `getLocalVaultKey()`, `vaultKeyEntropyBytes()`. Exported as the `@agentforge/db/vault-key` subpath so a path-only consumer does not open the database. |
| `packages/db/src/client.ts` | Opens better-sqlite3, sets pragmas, runs the reset hook and `ensureSchema`, exports `db` / `sql` / `Database`. |
| `packages/db/src/schema.ts` | Every Drizzle table. No queries. |
| `packages/db/src/ensure-schema.ts` | `migrationsFolder()`, `ensureSchema()`, baseline stamping, the `ensure*` healers, `assertKernelTables`. |
| `packages/db/drizzle/` | The 18 committed `.sql` migrations (numbered `0000`-`0018` with `0017` reserved) plus `meta/_journal.json`. |
| `packages/db/src/ensure-local-owner.ts` | The single owner, org, home workspace, and workspace CRUD. |
| `packages/core/src/local-owner.ts` | The id/slug/name constants and `pickWorkspaceId`. |
| `packages/db/src/seed.ts` | `db:seed` entry point. |
| `packages/db/src/reset.ts` | Queue, validate and apply a "Start over" wipe. |
| `packages/db/src/repos/drizzle-agent-repository.ts` | `AgentRepository` over Drizzle, with the `systemPrompt` seal. |
| `packages/db/src/index.ts` | The public surface: `db`, `sql`, schema re-export, reset API, `ensureLocalOwner` family, `DrizzleAgentRepository`. |
| `packages/db/drizzle.config.ts` | `drizzle-kit`'s own view of the database URL, for `push` / `studio` / `generate`. |

## Gotchas

**Importing `@agentforge/db` opens the database.** `client.ts` is all top-level side effects — dotenv,
`mkdirSync`, possibly a data wipe, the connection, the pragmas, the migrations (`:11-48`). Anything
that only wants a *path* must import `@agentforge/db/vault-key` instead
(`packages/db/package.json:8`), which is what the host does throughout
(`packages/host/src/datasets.ts:5`, `packages/host/src/components/paths.ts:22`,
`packages/host/src/components/log.ts:13`).

**The data dir depends on the working directory.** The last fallback is
`resolve(process.cwd(), "../../data")` (`packages/db/src/vault-key.ts:18`), which only lands on the
repo's `data/` when cwd is a package directory two levels down. A script run from the repo root gets
`<repo-parent>/../data`. Set `AGENTFORGE_DATA_DIR` rather than relying on it.

**`drizzle.config.ts` re-implements the path rules and disagrees.** It reads only
`AGENTFORGE_DATA_DIR` (never `AGENTFORGE_SETTINGS_PATH`) and it *silently falls back* on a Postgres
URL instead of throwing (`packages/db/drizzle.config.ts:6-11`). So `db:push` and `db:studio` can open
a different file than the app does, on exactly the environments where the app would have refused to
start.

**`db:push` is not how the schema is applied.** Boot uses `ensureSchema` over the committed journal
(`packages/db/src/client.ts:51`). `drizzle-kit push` diffs `src/schema.ts` against the live database
and writes no journal row, so a pushed database and a migrated one can end up stamped differently.

**Baseline stamping means a journal row is not proof a migration ran.** A database with all 20 kernel
tables and an empty journal gets every hash inserted without executing anything
(`packages/db/src/ensure-schema.ts:218-222`). That is the whole reason the `ensure*` healers and the
defensive `CREATE TABLE IF NOT EXISTS` in `0010`-`0018` exist. When you add a migration that
`ALTER`s a table, add a matching healer — a bare `ALTER` will fail on a second application.

**A partially initialized database refuses to boot rather than repairing itself**
(`packages/db/src/ensure-schema.ts:206-211`), with one carve-out for the six edit tables
(`:40-42`). The error names the missing tables; the fix is to restore or delete the file, not to
re-run migrations.

**`meta/` holds only four snapshots** — `0000`, `0001`, `0002`, `0005` — for sixteen journal entries.
`ensureSchema` never reads snapshots (it reads `_journal.json` and the `.sql` files,
`packages/db/src/ensure-schema.ts:90-112`), so boot is unaffected; `drizzle-kit generate` is the tool
that wants them, and it should be expected to behave oddly here.

**Foreign keys are off during migration and on afterwards** (`:215`, `:233`), and `client.ts` sets
`foreign_keys = ON` *before* calling `ensureSchema` (`:45`, `:51`). The pragma you observe at runtime is
the post-migration one.

**`busy_timeout` is 5 s since Phase 3, and that is the whole concurrency story.** The pragmas are
`journal_mode = WAL` (`packages/db/src/client.ts:44`), `foreign_keys = ON` (`:45`) and
`busy_timeout = 5000` (`:50`). WAL gives concurrent readers with one writer; without the timeout a
second writer got `SQLITE_BUSY` immediately instead of waiting. The comment above it (`:46-49`) makes
a `SQLITE_BUSY` that still reaches a client the trigger for revisiting the engine choice, so treat
one as a finding, not a flake.

**The connection is cached on `globalThis` only outside production** (`:40-42`). In production every
import of a fresh module graph opens a new handle — and skips the reset hook, which is gated on the
cache being empty (`:35`).

**The desk path applies no key strength check at all.** `getLocalVaultKey` measures entropy only in
server mode (`packages/db/src/vault-key.ts:125-133`), so `AGENTFORGE_SECRETS_KEY=x` is accepted on a
desk and `wrappingKeyFromSecret` will happily hash it into 32 bytes
(`packages/core/src/crypto/envelope.ts:14-16`).

**`docs/internal/web-security-spec.md:74` is stale on this subsystem.** Row S1 says the `.master-key`
fallback "throws when `NODE_ENV=production`" and cites `packages/db/src/vault-key.ts:37-51`. The code
gates on `isServerMode` — `AGENTFORGE_SERVER` being `1`/`true`
(`packages/db/src/vault-key.ts:125`, `packages/core/src/server-mode.ts:12-15`) — and `NODE_ENV`
appears nowhere in the file; lines `37-51` are the constant declarations. Read the code, not the row.

**`seed.ts` prints the wrong desk name.** Its success line says "Seeded local owner, Default
workspace, and tools" (`packages/db/src/seed.ts:33`), which happens to match
`HOME_WORKSPACE_NAME = "Default"` (`packages/core/src/local-owner.ts:12`) — but the workspace *slug*
is `home` (`:11`), and `Home` is the legacy **name** that `ensureLocalOwner` migrates away from
(`packages/db/src/ensure-local-owner.ts:77-81`). Name, slug and legacy name are three different
strings; do not match on the printed one.

**A "Start over" removes `.master-key`** (`packages/host/src/handlers/settings.ts:284`). Anything
still sealed with the old wrap key after that is unreadable by design — which is why the SQLite trio
goes with it (`packages/db/src/reset.ts:29`, `:270`).

**`market_cache` has no scope column** (`packages/db/src/schema.ts:857-868`). It is a read-through
cache keyed `(ticker, kind)` shared by every workspace on the install; it is not per-desk data and a
desk wipe does not isolate it.

## Verify

Nothing in `.cursor/skills/verify-agentforge/features/` drives `packages/db` directly — the feature
files are user-POV and this subsystem has no screen. The two that come closest exercise it from
above:

- [`features/settings.md`](../../../.cursor/skills/verify-agentforge/features/settings.md) — the
  **Start over** card is the only user-facing path into `reset.ts`. Its recipe deliberately stops at
  proving the `RESET` typed-confirm enables `settings-reset-all-submit` and then cancels, so the walk
  never actually reaches `requestDataReset`. `settings-reset-pending` / `settings-reset-pending-cancel`
  cover `hasPendingDataReset` and the marker's deletion.
- [`features/data.md`](../../../.cursor/skills/verify-agentforge/features/data.md) — uploading a CSV
  and reopening it from `data-saved` is the cheapest end-to-end proof that the `datasets` table was
  created and is workspace-scoped, and it works with no gateway key.

The real coverage is the unit suite, `pnpm --filter @agentforge/db test`
(`packages/db/package.json:16`, `packages/db/vitest.config.ts`):

| Test file | Proves |
|---|---|
| `packages/db/src/vault-key.test.ts` | The Postgres refusal and `file:` handling (`:40-50`), every entropy case including the documented passphrase limit (`:52-121`), server mode's two refusals and what it accepts (`:123-178`), and that a desk still creates and reuses `.master-key` and still accepts a short env key (`:180-193`). |
| `packages/db/src/ensure-schema.test.ts` | Fresh create, idempotence, baseline stamping, each healer, and `drizzle-kit check` as an anti-drift gate (`:447-475`) — which **skips itself with a warning when `drizzle-kit` is not installed** (`:459-462`), so a green run in a workspace without dependencies proves less than it looks. |
| `packages/db/src/reset.test.ts` | Marker atomicity, escape rejection, the malformed-marker keep-data path, the `DATABASE_URL`-elsewhere trio, and the symlink defenses. |
| `packages/db/src/ensure-local-owner.test.ts` | `Default`/`home` naming, the `Home` → `Default` rename, and that the home desk cannot be deleted. |
| `packages/db/src/auth-sessions.test.ts` | `auth_sessions` is created by the migration, matches the Drizzle table, survives a second `ensureSchema`, and is healed on a baseline-stamped database. |
| `packages/db/src/repos/drizzle-agent-repository.test.ts` | `systemPrompt` is written as a `sealPayload` envelope and reopens, and a legacy plaintext prompt still opens. |

## Why

**Claim: SQLite is a deliberate choice for the first hosted deployment, not a leftover.**
`docs/internal/web-data-placement-tencent.md:40` — "It is what the code runs today, one server serves
the closed beta … WAL is already on (`packages/db/src/client.ts:44`)". `[Direct]`

**Claim: the Postgres throw is a stated Phase 3 decision point, not an oversight.**
`docs/internal/web-migration-plan.md:31` names the throw and records "Stays SQLite for Phase 0-2.
Phase 3 is the decision point: one file with a tenant column, or a file per tenant, or Postgres", and
`docs/internal/web-pivot-2026-09-18.md:26` restates the rule as "SQLite until the tenancy design says
otherwise" with the tenancy model listed as an open decision at `:36`. `[Supported]`

**Claim: the server-mode wrap key requirement exists to stop a container-local `.master-key`.**
`docs/internal/web-security-spec.md:74` (row S1) lists it as a **before traffic** Phase 1 requirement.
The row's own wording about `NODE_ENV` no longer matches the code (see Gotchas), so this is the
*intent* the row records, not a description of the current gate. `[Supported]`

**Claim: the tenant dimension is real in the schema and now also in request resolution, and the two
arrived as separate lanes.** The schema half is lane B: `tenants` and `organizations.tenant_id`
exist (`packages/db/src/schema.ts:32-39`, `:45-47`) and migration 0015 backfills every existing row
to `local-tenant`. The resolution half is lane C: `getTenant` now takes the verified browser session
and resolves the tenant from it, falling back to the single local owner only off the hosted path
(`packages/host/src/tenant.ts:88-103`, `resolveFromSession` at `:105`, `resolveLocalOwner` at
`:117-132`). In server mode a request with no session is a 401 rather than a fall back to
`local-tenant` (`:96-101`). `ensureTenant`, which lane B defined and left uncalled, has a caller
now: `ensurePortalOwner` writes the tenant row on sign-in (`packages/db/src/portal-owner.ts:89-94`).

What has *not* moved is "Start over": it is still refused on the server, and the reason is still
that a data-dir wipe is every tenant's work rather than the caller's
(`packages/host/src/handlers/settings.ts:339-346`), which is scoping, not resolution. The full
resolution path is its own page: [tenant-resolution.md](tenant-resolution.md). `[Direct]`

# Portal control-plane migrations

Target: PostgreSQL 16 on TencentDB for PostgreSQL, ap-jakarta. One database, one schema
(`public`), RLS everywhere. See `../schema.md` for the design rationale.

## Ordering

Run in numeric order. Each file is wrapped in a single transaction and is safe to re-run
(`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS` before every `CREATE POLICY`).

| # | File | Contents | Depends on |
|---|------|----------|-----------|
| 0001 | `0001_extensions_and_roles.sql` | `pgcrypto`, `citext`, roles `portal_admin` / `portal_app` / `tenant_readonly`, `app_tenant_id()`, `create_tenant_role()` | — |
| 0002 | `0002_core_tables.sql` | tenants, tenant_config, orgs, users, devices, sessions, refresh_tokens, device_codes, login_otps, jwks_keys, api_keys | 0001 |
| 0003 | `0003_billing_and_usage.sql` | wallet_ledger, partitioned usage (+3 months + default), audit_log, append-only triggers | 0002 |
| 0004 | `0004_rls.sql` | `ENABLE`/`FORCE ROW LEVEL SECURITY`, policies, grants, ownership (`jwks_keys` is portal-wide and deliberately excluded — see the comment in the file) | 0003 |
| 0005 | `0005_functions.sql` | `count_active_users`, `login_precheck`, `revoke_session_chain`, `rotate_refresh_token`, `append_wallet_entry`, `wallet_balance`, `expire_device_codes`, `prune_login_otps` | 0004 |

## How to run

As the instance's privileged account (the one that can `CREATE ROLE`):

```sh
export PGHOST=... PGDATABASE=tokotoken_portal PGUSER=portal_admin_login
for f in 0001_extensions_and_roles.sql 0002_core_tables.sql 0003_billing_and_usage.sql \
         0004_rls.sql 0005_functions.sql; do
  psql -v ON_ERROR_STOP=1 -f "$f" || exit 1
done
```

Then provision the per-tenant roles, once per partner, with passwords read from the secret
manager (never from a file in git):

```sh
psql -v ON_ERROR_STOP=1 -c "SELECT create_tenant_role('jast', '<tenant uuid>', '<secret>')"
```

Post-install cron (any external scheduler; `pg_cron` is not guaranteed on TencentDB):

- nightly: `SELECT ensure_usage_partitions(3);`
- every minute: `SELECT expire_device_codes();`
- hourly: `SELECT prune_login_otps();`

Key rotation is **not** a cron job in the database: `jwks_keys` rows are minted, promoted and
retired as `portal_admin` by the ops runbook, because the private half of every key lives in the
KMS and `portal_app` has `SELECT` only.

## Recommended migration tool

Plain `psql -f` is enough to bootstrap, but for ongoing work use **[golang-migrate]-style
numbered, transactional, up/down pairs — concretely, `migrate`** (golang-migrate). It is a single
static binary with no runtime in the application's language, it records applied versions in a
`schema_migrations` table with a dirty flag that refuses to proceed after a failed apply, and it
treats SQL files as the source of truth rather than generating them from an ORM model — which
matters here because the interesting parts of this schema (RLS policies, partition DDL, plpgsql
functions, column-level grants) are things no ORM migration generator round-trips correctly. If
the backend team is Node-only and wants one fewer binary in CI, `node-pg-migrate` in its raw-SQL
mode is an acceptable substitute for the same reasons; what is not acceptable is a
model-diffing tool, because it will silently drop the policies and grants on the next autogenerate.

## Rollback notes

There is no `.down.sql` for the initial set: these files create the database from nothing, and the
rollback for a failed bootstrap is to drop and recreate the database. Per file, if you must undo a
partially applied change:

- **0001** — `DROP FUNCTION create_tenant_role(text, uuid, text), app_tenant_id();` then
  `DROP ROLE tenant_readonly, portal_app, portal_admin;`. Roles only drop once every object they
  own has been reassigned, so run this after 0002–0005 have been rolled back. Extensions can stay.
- **0002** — `DROP TABLE api_keys, jwks_keys, login_otps, device_codes, refresh_tokens, sessions,
  devices, users, orgs, tenant_config, tenants CASCADE;` in that order (reverse FK order), then
  `DROP FUNCTION set_updated_at() CASCADE;`. Dropping `jwks_keys` invalidates every outstanding
  access token, since the `kid` they carry no longer resolves — expected for a bootstrap rollback,
  never acceptable on a live instance.
- **0003** — `DROP TABLE audit_log, usage, wallet_ledger CASCADE;` (dropping the partitioned
  `usage` parent drops every partition), then
  `DROP FUNCTION ensure_usage_partitions(integer), create_usage_partition(date), reject_mutation() CASCADE;`.
  **Destructive**: this deletes billing evidence. Take a per-tenant export first (see
  `../schema.md`, "Nightly exports") and keep it for the retention period.
- **0004** — reversible without data loss: `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` plus
  `DROP POLICY` per policy and `REVOKE ALL ... FROM portal_app, tenant_readonly;`. Do **not**
  leave a deployed system in this state — with RLS off, `portal_app` reads every tenant.
- **0005** — `DROP FUNCTION` each of the eight by full signature. Safe at any time; the login flow
  fails closed (500s on refresh and login) until they are restored, which is the intended
  behaviour: nothing in the application re-implements these checks.

The one irreversible step in normal operation is a partition `DETACH` + drop during retention
maintenance. That path is documented in `../schema.md` and requires an archived export first.

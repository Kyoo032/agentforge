# @agentforge/portal

A **stand-in for the Toko Token portal** — the control plane at `api.tokotokenai.com` that the
backend team owns. This one exists so the hosted DPSBuddy web app has a real login to build and
review against today, and it is **wire-compatible with
[`docs/internal/portal/`](../../docs/internal/portal/)**: the flow in `device-code-login.md`, the
data model in `schema.md`, and the schema itself from `migrations/0001-0005`, which it runs
unchanged.

It is not part of the product. It never imports `@agentforge/db` or `@agentforge/host`, and
nothing in `apps/web`, `packages/host` or `packages/core` ever imports it — the product reaches it
over HTTP through `AGENTFORGE_PORTAL_URL`, exactly as it will reach the real one.

It serves the whole login: the browser flow (`/authorize` and its two form posts), the
device-code flow (`/auth/device/code`, `/activate`, `/auth/device/approve`,
`/auth/device/token`), `/auth/token` for both grants, `/auth/logout`, `/auth/session`,
`/tenant/config`, `/.well-known/jwks.json` and `/healthz`. How each one behaves and which test
pins it is in the map page,
[`docs/internal/maps/portal-service.md`](../../docs/internal/maps/portal-service.md) — read that
before changing anything here.

## Running it

```sh
# Postgres 16 on 127.0.0.1:5433 and Mailpit on 127.0.0.1:1025 (UI: http://127.0.0.1:8025).
# The password has no default in compose.yml, so it has to be in the environment first.
export PORTAL_POSTGRES_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
export PORTAL_APP_DB_PASSWORD="$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")"
docker compose -f apps/portal/compose.yml up -d

export PORTAL_DATA_DIR=/tmp/portal
# Two roles: the schema owner migrates, the server serves (see "Database roles" below).
export PORTAL_MIGRATE_DATABASE_URL="postgres://portal:$PORTAL_POSTGRES_PASSWORD@127.0.0.1:5433/tokotoken_portal"
export PORTAL_DATABASE_URL="postgres://portal_app_login:$PORTAL_APP_DB_PASSWORD@127.0.0.1:5433/tokotoken_portal"

pnpm portal:dev                                   # migrates as the owner, then listens on 127.0.0.1:4000
pnpm portal:seed -- --email you@example.com       # first tenant, org, user, OAuth client
```

**An existing dev volume keeps its old password.** `POSTGRES_PASSWORD` is read by `initdb` on the
first start of an empty `portal-pgdata` and never again, so a machine whose volume predates this
change still wants the password it was created with (`portal`). Change it in place with
`docker compose -f apps/portal/compose.yml exec postgres psql -U portal -c "\password portal"`,
or drop the volume with `docker compose -f apps/portal/compose.yml down -v` — which deletes every
local portal row. The test suite is unaffected either way: it runs its own PostgreSQL.
`scripts/review-instance.ps1` exports `PORTAL_POSTGRES_PASSWORD` around its own `docker compose up`.

The seed prints the OAuth client secret **once** — only its sha256 is stored, so there is no second
chance. Put it in the product's `AGENTFORGE_PORTAL_CLIENT_SECRET`. To replace it, re-run with
`--rotate-secret`.

```sh
pnpm portal:seed -- --email you@example.com \
  --tenant dpsbuddy --org Kyo --seat-cap 20 \
  --redirect https://localhost:3443/auth/callback
```

While the team hands sign-in codes to users by hand, an operator can mint one:

```sh
PORTAL_ALLOW_MANUAL_OTP=1 pnpm portal:otp -- you@example.com
```

That issues a fresh code, prints it once, stores only its hash, and records `otp.issued_manually`
in the audit log. It is refused in production. Codes that are *sent* land in Mailpit.

## Environment

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PORTAL_DATABASE_URL` | yes | — | The **server's** connection. Must be `postgres://`, and must be a plain member of `portal_app` — `portal_app_login`. Production refuses to boot on a superuser, a `BYPASSRLS` role or a member of `portal_admin`. **Never** `DATABASE_URL` — that is the product's SQLite desk. |
| `PORTAL_MIGRATE_DATABASE_URL` | **in production** | `PORTAL_DATABASE_URL` | The schema owner's connection, for migrations and nothing else. It is opened, used and closed before the server listens. Outside production an unset value falls back to `PORTAL_DATABASE_URL`, the old one-DSN setup, which then boots with a `portal_db_role_bypasses_rls` warning. |
| `PORTAL_DATA_DIR` | yes | — | Absolute path the portal may write to. |
| `PORTAL_PORT` | no | `4000` | |
| `PORTAL_HOST` | no | `127.0.0.1` | Loopback by default; the portal sits behind the reverse proxy. |
| `PORTAL_SIGNING_KEY` | in production | — | Ed25519 seed: 32 bytes as base64url, base64 or hex. Without it, development mints an ephemeral key and warns loudly; production refuses to start. |
| `PORTAL_PUBLIC_URL` | **in production** | `http://<host>:<port>` | The **origin** a browser reaches this portal on — https anywhere, http on loopback only, no path, no query, no credentials. It is the access token's `iss`, the device flow's `verification_uri`, and what decides whether the session cookie is `Secure`. A token minted with the wrong issuer verifies nowhere, so production refuses to start without it. |
| `PORTAL_TRUST_PROXY` | no | off | `1` lets the portal believe `X-Forwarded-For`. Every rate-limit bucket is keyed on that address, so leave it off unless a proxy really is in front. Read through the same flag parser as every other flag: `ture` is a boot error, not a silent off. |
| `PORTAL_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_FROM` | host required in production | Mailpit on `127.0.0.1:1025` | Production refuses to start on the sandbox default. See the TLS rule below. |
| `PORTAL_SMTP_SECURE` | no | off | `1` for implicit TLS from the first byte (port 465). Leave it off for STARTTLS on 587 — which is then **required**, not optional. |
| `PORTAL_DEV_OUTBOX` | no | off | Development switch; refused in production. |
| `PORTAL_ALLOW_MANUAL_OTP` | no | off | Lets `portal:otp` mint a code. Refused in production. |
| `PORTAL_LOG_LEVEL` | no | `info` | |

Every problem is reported at once, with the variable named and the accepted shape spelled out; the
process does not start half-configured.

### Database roles

Every tenant policy in `0004_rls.sql` is skipped for a superuser, for a `BYPASSRLS` role, and in
practice for a member of `portal_admin`, whose policy on every table is `USING (true)`. The portal
used to migrate and serve on one DSN, and the compose file handed that DSN the cluster superuser.
The policies therefore held in the test suite and nowhere else. There are two roles now:

| Role | DSN | What it may do |
|---|---|---|
| the schema owner (compose: `portal`) | `PORTAL_MIGRATE_DATABASE_URL` | run the migrations, once per boot, on a connection that is closed before anything listens |
| `portal_app_login` | `PORTAL_DATABASE_URL` | serve: a `LOGIN` member of `portal_app` and nothing else, created by `migrations/0010_app_login_role.sql` |

`src/boot.ts` reads `pg_roles` for the server's own role before the server listens. In production
it **refuses to boot** if that role is a superuser, has `BYPASSRLS`, is a member of `portal_admin`,
can `SET ROLE` to any role that is, or is not a member of `portal_app`. Outside production the same
findings are a warning.

**Where the password comes from.** `0001_extensions_and_roles.sql:53-55` keeps login-role passwords
out of migration files, so 0010 creates `portal_app_login` without one.

- **Production:** provision it out of band from the secret manager, once, as the owner:
  `psql "$PORTAL_MIGRATE_DATABASE_URL" -c '\password portal_app_login'` (`\password` sends a SCRAM
  verifier, so the plaintext never reaches the server's statement log). The portal never sets it.
- **Development only:** every migrate (`pnpm portal:dev`, `portal:migrate`, `portal:seed`) sets it
  from the password in `PORTAL_DATABASE_URL`. It does that for that role name only, and only when
  the owner's DSN names a different role, so no DSN can be used to reset any other role's password.

### Mail is never sent in the clear

There are exactly two honest SMTP shapes, and `loadConfig` derives which one you are in rather than
letting the transport guess:

| Host | `PORTAL_SMTP_SECURE` | What happens |
|---|---|---|
| anything off loopback | `1` | implicit TLS from the first byte (465) |
| anything off loopback | off | **STARTTLS, required** — the send fails rather than falling back to cleartext |
| loopback (`127.0.0.0/8`, `localhost`, `::1`) | off | plain SMTP, for the Mailpit sandbox only — and **refused in production** |

There is no configuration in which a non-loopback host receives a sign-in code or an SMTP AUTH
password without TLS, and a production process pointed at a cleartext loopback listener refuses to
start. This is [SR-39](../../docs/internal/security-register.md#sr-39): the transport used to pass
`ignoreTLS` whenever `PORTAL_SMTP_SECURE` was off, which does not mean "TLS if offered" — it means
"never attempt STARTTLS" — so a provider on 587 got the credentials and the code in the clear.

## How it is put together

```
migrations/          0006+ — what the browser login needs and 0001-0005 do not have yet
locales/{en,id}/     every user-facing string, including the reason-code table
src/config.ts        validated environment, fail fast
src/boot.ts          migrate as the owner, then serve as portal_app_login; refuses a privileged role
src/process-guards.ts  an unhandled rejection or exception is logged, then the process exits 1
src/log.ts           one JSON line per call; drops credential-named fields, scrubs token-shaped values
src/crypto.ts        sha256, constant-time compare, token / user_code / OTP minting
src/server.ts        node:http + a route table; createPortalServer({config, store, clock})
src/store/types.ts   the store contract — read this first
src/store/postgres/  the one driver
src/mail/            SMTP transport + the OTP message in en and id
src/seed/            what `pnpm portal:seed` does
src/jwt/             Ed25519 keys, the access token, the JWKS document
src/security/        cookies, the portal's own session, CSRF, rate limits, headers, body caps
src/views/           one escaping helper, the locale catalogs, the five screens
src/otp/             the enumeration-resistant send, and the audited verify
src/flows/           the decisions: authorize, token, device, session, the reason table
src/routes/          thin handlers over those flows; registerPortalRoutes is the whole surface
                     — including /logout, the way out of the portal's own browser session
src/testing/         the portal_app_test role, and a real portal on an ephemeral port
scripts/             the three CLIs
```

Two things are worth knowing before reading the store:

**Tenant scope is explicit.** Every RLS policy in `0004_rls.sql` reads `app.tenant_id`, and
`SET LOCAL` only exists inside a transaction, so `store.tx(tenantId, ops => …)` is the only way in.
`tx(null, …)` is the pre-authentication window and reaches only the two tables whose policies
expose it.

**The database's own functions do the security-critical work.** `rotate_refresh_token`,
`login_precheck` and `count_active_users` come from `0005_functions.sql` and are called, not
re-implemented — so reuse detection and the definition of a seat exist in exactly one place.

## Migrations

`store.migrate()` applies, in order, `docs/internal/portal/migrations/0001-0005` (read from their
directory, never copied) and then `apps/portal/migrations/0006+`. Applied files are recorded in
`portal_meta.migrations` — its own schema, because `0004_rls.sql` re-owns every table in `public`.
Editing a file that has already been applied is refused; add a new numbered one.

`0006_browser_login.sql` adds `oauth_clients`, `auth_codes`, `device_codes.platform` and the
poll-window counters. `0007_tenant_resolvers.sql` adds the `portal_admin`-owned `SECURITY DEFINER`
tenant resolvers that `schema.md` and `device-code-login.md` both flag as missing from 0005.
`0008_oauth_client_scope.sql` closes the pre-authentication window 0006 opened on `oauth_clients`.
`0009_web_session_revocation.sql` adds `web_session_versions`, the per-user counter that makes the
portal's own 30-day browser cookie revocable, and corrects 0006's claim that an authorization code
is bound to `sha256(state)` — it is bound to the client and the `redirect_uri`, and the `state`
binding is the host's own `__Host-` cookie check.
`0010_app_login_role.sql` creates `portal_app_login`, the server's role that 0001 describes and
nobody had created. It has no password, and an existing role is left alone (see "Database roles").

## Tests

```sh
pnpm --filter @agentforge/portal test
```

Real PostgreSQL, never a fake: `PORTAL_TEST_DATABASE_URL` when it is set, otherwise
`embedded-postgres` (real PG 16 binaries, no Docker needed). One server per run builds a template
with every migration applied; each test file takes a private database from it.

**The store connects as `portal_app_test`, a non-superuser member of `portal_app`** — not as the
cluster superuser, which bypasses row-level security and would make every isolation assertion pass
with the policies dropped. `src/security/rls.test.ts` proves the policies from that connection, and
`src/boot.test.ts` proves a production boot refuses the roles that would bypass them.
Two suites (`src/routes/{browser,api}.test.ts`) drive a real server on an ephemeral port with a
captured mail transport and an array log sink, which is what lets them assert that no OTP, code or
token ever reached a log line.

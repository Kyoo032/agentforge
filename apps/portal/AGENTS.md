# apps/portal — agent rules

**This is a stand-in for the backend team's portal** (`api.tokotokenai.com`), built so the hosted
DPSBuddy web app has a real login to develop and review against before that service exists. It is
wire-compatible with [`docs/internal/portal/`](../../docs/internal/portal/) — `device-code-login.md`
for the flow, `schema.md` for the data model, `migrations/0001-0005` for the schema itself.

Read [`docs/internal/web-phase9-portal-login.md`](../../docs/internal/web-phase9-portal-login.md)
before working here. It is the plan of record and it names the lanes.

## The three rules that make this safe to keep in the repo

1. **The portal never imports the product.** No `@agentforge/db`, no `@agentforge/host`, no
   `@agentforge/core`. It has its own store, its own data directory, its own logger and its own
   config. If something here needs a helper the host already has, it gets its own copy — the idiom
   is borrowed, the module is not.
2. **The product never imports the portal.** `apps/web`, `packages/host` and `packages/core` reach
   it only over HTTP, through `AGENTFORGE_PORTAL_URL`. A `from "@agentforge/portal"` anywhere
   outside this directory is a bug.
3. **`docs/internal/portal/migrations/0001-0005` are the backend team's files.** They are read at
   runtime, never copied and never edited. Anything the browser login needs that they do not have
   goes in a new numbered file under [`migrations/`](migrations/) — today `0006_browser_login.sql`
   (oauth_clients, auth_codes, device_codes.platform and the poll-window counters),
   `0007_tenant_resolvers.sql` (the `SECURITY DEFINER` tenant resolvers `schema.md` says are
   missing) and `0008_oauth_client_scope.sql` (closing the pre-authentication window 0006 opened
   on `oauth_clients`, which nothing needed). Same style: one transaction per file,
   `IF NOT EXISTS`, `DROP POLICY` before `CREATE POLICY`, and every new table placed explicitly
   into one of the three RLS shapes `0004_rls.sql` defines.

## Postgres, and only Postgres

`PORTAL_DATABASE_URL` is required and must be `postgres://`. There is no SQLite driver and there
should not be one: the interesting parts of this schema are RLS policies, plpgsql functions and a
partitioned table, and a second driver would mean a second definition of reuse detection and a
second definition of a seat. `PORTAL_DATABASE_URL` is also never `DATABASE_URL` — that one is the
product's SQLite desk and the two must not be able to point at each other.

`docker compose -f compose.yml up -d` gives you Postgres 16 on `127.0.0.1:5433` and Mailpit on
`127.0.0.1:1025` (UI at `http://127.0.0.1:8025`). Both are loopback-only.

## Tenant scope is not optional

Every RLS policy in `0004_rls.sql` reads `app.tenant_id`, and `SET LOCAL` only exists inside a
transaction — so `store.tx(tenantId, ops => …)` is the only way to reach a row, and there is
deliberately no "just run one query" escape hatch. `tx(null, …)` is the pre-authentication window
and reaches exactly the two tables whose policies expose it (`device_codes`, `oauth_clients`).

When the tenant is not known yet — a refresh token, an authorization code, a `client_id`, an
e-mail address — use `store.resolve.*`. Those are the `SECURITY DEFINER` resolvers in 0007 and each
returns **at most a tenant id**, so none of them tells a caller whether a value was ever valid.

## Secrets

- Raw codes and tokens are **never** stored. Only `sha256(raw)`, in a `bytea` column with a
  `CHECK (octet_length(...) = 32)`. That covers refresh tokens, device codes, OTPs, authorization
  codes and client secrets.
- Comparisons of secret material use `hashEquals` (constant time), never `===`.
- `user_code`, `device_code`, refresh tokens, JWTs, OTPs and client secrets are **never logged**.
  `src/log.ts` enforces that at the sink: any field whose name carries a credential word is
  dropped, and any string value shaped like a token is scrubbed. Do not work around it — rename
  the field.
- There is no plaintext outbox and no "log the code" path. Mail goes over SMTP to Mailpit in
  development and to a provider in production; `loadConfig` refuses to start a production process
  that has no `PORTAL_SMTP_HOST`.
- `pnpm portal:otp <email>` **issues** a new code for an operator to read out (it cannot read a
  stored one back — only the hash exists). It needs `PORTAL_ALLOW_MANUAL_OTP=1`, is refused in
  production, and writes `otp.issued_manually` to the audit log.

## Lanes

This directory is split between two lanes of the Phase 9 plan.

| Owned by | Files |
|---|---|
| Lane A (done) | `package.json`, `src/{config,log,crypto,server,main,index,manual-otp}.ts`, `src/store/**`, `src/mail/**`, `src/seed/**`, `scripts/**`, `test/**` |
| Lane B (done) | `src/{routes,flows,views,otp,security,jwt}/**`, `locales/**`, `migrations/0008+`, `src/testing/**`, `compose.yml`, these two files |

Lane B extended the server through `createPortalServer(...).register(route)` — the route table is
the seam, so `/authorize`, `/activate`, `/auth/device/*` and `/auth/token` are a list of route
objects (`src/routes/index.ts`) rather than a rewrite of `src/server.ts`.

## Where the login lives

Read [`docs/internal/maps/portal-service.md`](../../docs/internal/maps/portal-service.md) before
changing any of it — it carries the wire contract, every security control with the test that pins
it, and the gotchas. The shape in one paragraph: **routes are thin** (`src/routes/**`: parse,
limit, check CSRF, call a flow, render), **flows hold the decisions** (`src/flows/**`), **guards
live in one place each** (`src/security/**`), and every user-facing string is a key in
`locales/{en,id}/portal.json` — including the reason-code table, which the JSON error bodies and
the HTML pages both read so there is one copy of it.

Four rules that are easy to break here:

- **One `Set-Cookie` per response.** `PortalResponse.headers` is `Record<string, string>`, so a
  second cookie silently has nowhere to go. `htmlResponse` / `redirectResponse` take one `cookie`.
- **Nothing redirects before the client and the `redirect_uri` are validated**, on every hop,
  including the form posts — a hidden field is a field the user edits.
- **Every interpolation into a page goes through the `html` tag** (`src/views/escape.ts`).
  `raw()` is the only escape hatch and exists to be greppable.
- **The tests connect as `portal_app_test`**, a non-superuser member of `portal_app`
  (`src/testing/pg.ts`). Do not "fix" a failing isolation test by giving that role more; a policy
  refusing it is the test working.

## Tests

`pnpm --filter @agentforge/portal test`. Real PostgreSQL, always:

- `PORTAL_TEST_DATABASE_URL` if it is set (point it at the compose service);
- otherwise `embedded-postgres`, which ships real PG 16 binaries and needs no Docker.

`test/global-setup.ts` starts one server per run and builds `portal_template` with every migration
applied; each test file then takes a private database from that template. Two reasons, both worth
keeping: suites cannot see each other's rows, and the cluster-wide `CREATE ROLE` in 0001 happens
once instead of racing across parallel workers.

Copy nothing from the product's test setup into here, and never point a test at the compose volume
you are also using by hand — the suite drops every `portal_test_*` database it finds at the end.

`src/testing/server.ts` starts a **real** portal on an ephemeral port with a captured mail
transport and an array log sink; `src/routes/{browser,api}.test.ts` drive it over HTTP, which is
the only way to prove "a browser can sign in and the host can redeem the code" — and the only way
to assert that no OTP, code or token reached a log line.

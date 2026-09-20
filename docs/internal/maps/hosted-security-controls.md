# Map — Hosted security controls

Last verified: 2026-09-20 at b482611 (working tree)

## Overview

Everything that is true of a DPSBuddy request on the hosted web app and not true of the same
request on a desk. One environment variable decides which of the two the process is, and roughly
a dozen controls hang off it: the session gate, CSRF, the Origin and Host allowlist, the
HTTPS-only refusal, three rate limiters, the response headers, error masking, and the routes that
are simply turned off.

The thing to hold onto: **`isServerMode()` is the whole switch, and it is read at the point of
use rather than captured once.** There is no `SecurityConfig` object, no middleware stack, no
registry of controls. Each control asks the environment itself. That makes the controls easy to
read one at a time and makes the switch a single point of failure, which is why
`apps/web/lib/hosted-mode-guard.ts` exists to refuse a production build that answers `false`.

This page is the hosted perimeter: how a request is admitted and what a response carries. It is
not the secrets-at-rest story — that is [`docs/internal/maps/pii-and-key-security.md`](pii-and-key-security.md) — and
it is not the gateway key gate, which is
[`docs/internal/maps/settings-and-gateway-gate.md`](settings-and-gateway-gate.md). Tenant scoping *inside* an
admitted request is Phase 3's and is not described here.

## How it works

### 1. The switch

`packages/core/src/server-mode.ts:12` — `isServerMode(env = process.env)` is true when
`AGENTFORGE_SERVER` is set to `1`. `trustedOrigins` (`:22`) reads `AGENTFORGE_TRUSTED_ORIGINS`,
a comma-separated list normalised by `normaliseOrigin` (`:58`).

Two things pin the flag on for a real deployment:

| Where | What it does |
|---|---|
| `webapp-deploy/compose.yml:38` | `AGENTFORGE_SERVER: "1"` under `environment:`, which beats `env_file:` — and `.env` is `required: false`, so it can be absent |
| `apps/web/server.ts:41` | `assertHostedModeCoherent(process.env)`, the first statement of `main()`, throws before `server.listen` if `NODE_ENV=production` and server mode is off |

The second exists because the first only covers this compose file. A `NODE_ENV=production` build
that is not in server mode serves every `GET /api/v1/*` without a session **and passes its health
check**, because that is exactly how the desktop app is meant to behave.

### 2. Admission — the order in `handleNodeRequest`

`packages/host/src/http-adapter.ts` is mounted as the **first** middleware in
`apps/web/server.ts`, above `express.static` and the vite middlewares, so the page, the built
bundles and every 404 probe pass through it before anything serves them. The order below is
load-bearing; if that mount ever moves, the controls move with it.

| # | Line | Control | Applies to |
|---|---|---|---|
| 1 | `:424` | `applySecurityHeaders(res, serverMode)` | every request, before any handler writes a header |
| 2 | `:435-437` | `mintRequestId()` → `X-Request-Id` | every request (header in server mode only) |
| 3 | `:455` | `transportRejection` — TLS, method allowlist, path filter, header cap, per-IP and per-session buckets | **every** request, not only `/api` |
| 4 | `:461` | non-`/api` paths return `false`; Express serves the page | — |
| 5 | `:470` | `mutatingRejection` — Origin/Host allowlist, double-submit CSRF, `x-agentforge-transport` | non-safe methods on `/api` |
| 6 | `packages/host/src/router.ts:326-330` | `requireSessionFor` — the session gate, before the route table | `/api` minus the exempt paths |
| 7 | `:533` | `logAuthFailure` | a 401 coming back out |
| 8 | `:384` | `maskServerError` | any 5xx, in server mode |

Step 3 covering non-`/api` traffic is the part people get wrong: the TLS rule, the method
allowlist and the per-IP bucket would otherwise be off for the bulk of the traffic. Only the
Origin / CSRF / session rules are API-only, because those are about a call the renderer makes
rather than about the hop it arrived on.

### 3. Origin, Host and CSRF

`mutatingRejection` chooses between two rules (`packages/host/src/http-adapter.ts:353` onward and the block at
`:470`):

- **Off server mode**, unchanged from the desk: a missing `Origin` means same-machine, and `Host`
  must be loopback.
- **In server mode**: `Origin` must be on the allowlist and a missing one is refused; `Host` must
  be one of those origins' hosts; and the double-submit CSRF token must match — cookie
  `__Host-agentforge_csrf` against header `x-agentforge-csrf` (`packages/host/src/csrf.ts`).

HTTPS is required via `X-Forwarded-Proto` (`:52-54`, `HTTPS_REQUIRED` at `:90`); a direct hit on
the app's own loopback port with no such header is refused in server mode.

### 4. Sessions

`packages/host/src/auth/session.ts`. Opaque 32-byte ids (`SESSION_ID_BYTES` at `:16`,
`mintSessionId` at `:99`) stored server-side in `auth_sessions` — no JWT, nothing signed, nothing
the client can forge or read. Cookie is `__Host-agentforge_session` in server mode (`:30`),
`agentforge_session` off it (`:29`, chosen by `sessionCookieName` at `:36`).

`verifySession` (`:122`) enforces 12 hours idle (`IDLE_TIMEOUT_MS`, `:40`) and 30 days absolute
(`ABSOLUTE_LIFETIME_MS`, `:41`), sliding at most every 5 minutes (`SLIDE_INTERVAL_MS`, `:43`) so a
busy tab does not write a row per request.

The gate runs in `packages/host/src/router.ts:317-344`, **before the route table is consulted** — an
unauthenticated caller learns nothing about which paths exist.

### 5. Rate limits

`packages/host/src/rate-limit.ts`. Three token buckets, all server-mode only:

| Bucket | Rate | Burst | Keyed on |
|---|---|---|---|
| per-IP | 600 rpm (`:23`) | 100 (`:24`) | client IP from `X-Forwarded-For` |
| per-session | 300 rpm (`:25`) | 50 (`:26`) | session cookie |
| auth routes | 30 rpm (`:27`) | 10 (`:28`) | client IP |

Each is overridable by env (`:30-32`). `MAX_RATE_KEYS` (`:35`) caps the map at 50 000 so the
limiter cannot itself become the memory exhaustion.

### 6. What goes back out

- **Headers.** `packages/host/src/security-headers.ts` writes CSP, HSTS, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, both COOP/CORP and a `Permissions-Policy` that turns every
  powerful feature off. Server mode only: webdev's inline module preloads and the desktop's custom
  protocol would both break under a CSP written for the built bundle. `webapp-deploy/Caddyfile`
  sets the same set; Caddy's `header` directive **replaces** rather than appends, so the proxy's
  value wins on the real deployment and nothing is duplicated. The app is the floor, the proxy is
  the ceiling.
- **Identity headers stripped.** `X-Powered-By` and `Server` are removed in the adapter
  (`IDENTITY_HEADERS`, `packages/host/src/http-adapter.ts:43`) and again at the proxy.
- **Errors masked.** `maskServerError` (`:384`) replaces any 5xx message with a fixed string and
  keeps only a code matching `/^[a-z0-9_]+$/` (`:49`), so a SQLite error naming a column or a path
  never reaches the client. Off server mode it is a no-op and webdev's error path is untouched.
- **Downloads.** `packages/host/src/content-disposition.ts` builds every attachment header —
  quoted ASCII `filename` plus an RFC 5987 `filename*` when the name is not Latin-1. Applied in
  the adapter (`:273`) so a new download route cannot forget it.

### 7. Outbound — the SSRF guard

`packages/core/src/security/safe-fetch.ts`. Any fetch to a caller-supplied URL goes through
`assertPublicHttpsUrl` (HTTPS only, no credentials in the URL, host not private) and
`fetchPublicHttps`, which re-checks **per redirect hop** (`:179-203`).

`packages/core/src/security/ip-range.ts` is the address half: it parses to bytes and compares CIDR
prefixes, covering the ranges a string match misses — `100.64.0.0/10` CGNAT, `198.18.0.0/15`, the
TEST-NETs, multicast, and the IPv6 blocks including the whole of `fe80::/10`. Addresses that carry
an IPv4 inside an IPv6 (`::ffff:`, 6to4, NAT64) recurse onto the embedded address (`:225-246`).

`assertResolvesPublic` (`packages/core/src/security/safe-fetch.ts:110-128`) resolves the hostname and refuses a private
answer, so a public name pointing at `169.254.169.254` does not pass.

### 8. Routes that are off in server mode

| Route | Where | Why |
|---|---|---|
| `POST /api/v1/settings` — operator keys | `packages/host/src/handlers/settings.ts:166-231` | gateway key, provider keys, `toolKeys`, `toolBackends` and `injectionGuardBypass` are the operator's, not a tenant's |
| `POST /api/v1/settings/reset` and its cancel | `packages/host/src/handlers/settings.ts:346-438` | "Start over" deletes the data directory, which on a host is everyone's |
| component install stream | `packages/host/src/handlers/components.ts:45-67` | the image bakes anydoc in; the download path has nothing to do, and turning it off is what unblocks `noexec` on `/data` |

### 9. The container

`webapp-deploy/compose.yml`: read-only root filesystem, `/data` the only writable mount, `/tmp` a
`nosuid,nodev,noexec` tmpfs, `no-new-privileges`, `cap_drop: ALL` (the app binds 3000, a high
port, so it needs none back), `pids_limit`, `mem_limit`, and bounded rotated logs. Caddy shares the
app's network namespace so `127.0.0.1:3000` *is* the app and nothing is exposed on a bridge.

## Where things live

| File | Role |
|---|---|
| `packages/core/src/server-mode.ts` | `isServerMode`, `trustedOrigins`, `normaliseOrigin` — the switch |
| `apps/web/lib/hosted-mode-guard.ts` | Refuses to boot a production build that is not in server mode |
| `packages/host/src/http-adapter.ts` | Admission order, request id, error masking, auth-failure log |
| `packages/host/src/local-request.ts` | `filterHttpRequest`: method allowlist, path filter, header and body caps |
| `packages/host/src/csrf.ts` | Double-submit token mint and check |
| `packages/host/src/rate-limit.ts` | The three token buckets |
| `packages/host/src/auth/session.ts` | Opaque session ids, expiry, cookie names |
| `packages/host/src/auth/routes.ts` | `requireSessionFor`, the sign-in routes |
| `packages/host/src/router.ts` | `gate()` — the session check, ahead of the route table |
| `packages/host/src/security-headers.ts` | The response header set, and the Caddyfile parity test |
| `packages/host/src/content-disposition.ts` | Attachment headers for every download |
| `packages/core/src/security/safe-fetch.ts` | Outbound URL guard, per-hop redirect check |
| `packages/core/src/security/ip-range.ts` | CIDR membership for IPv4 and IPv6 |
| `packages/db/src/vault-key.ts` | Wrap-key sourcing, length and randomness floors |
| `webapp-deploy/compose.yml` | Container hardening, the pinned `AGENTFORGE_SERVER` |
| `webapp-deploy/Caddyfile` | TLS, HSTS, the same header set, access log |
| `scripts/audit-deployed.mjs` | Advisory gate scoped to the closure the image installs |

## Gotchas

- **`isServerMode()` is read per call, not captured.** A test that flips `AGENTFORGE_SERVER`
  changes behaviour for every control in the same process, which is why
  `packages/host/src/http-adapter.test.ts` saves and restores the two env keys around every case.
- **The adapter must stay the first middleware.** Almost every control in section 2 applies to
  non-`/api` traffic, and it can only do that from above `express.static`.
- **Duplicated headers are intentional.** The app and the Caddyfile both set the full set. Caddy
  replaces rather than appends, so nothing is sent twice on the real deployment, and the app is
  what protects any *other* deployment. `packages/host/src/security-headers.test.ts` parses the Caddyfile and fails
  on drift — if you change one, change both or that test will say so.
- **`maskServerError` keeps the code and drops the message.** A 500 in webdev still shows the real
  error; in server mode the same 500 shows `internal_error`. If you are debugging a hosted 500,
  the message is in the `request_failed` log line, found by the `X-Request-Id` the caller was
  given.
- **The health check is not a security check.** It passed in every misconfiguration this pass
  found, including the one where every control was off.
- **`assertResolvesPublic` fails open on a resolution error.** Deliberate: an offline suite with a
  stubbed `fetchImpl` must still pass, and a name that does not resolve cannot be connected to.
  It does *not* close DNS rebinding — the name is resolved again by `fetch` to connect. See
  `../security-owasp-2026-09.md`, A10-6.
- **`getTenant` is not this page's job.** Being admitted says nothing about which rows a request
  may touch. Phase 3 owns that, and `../security-owasp-2026-09.md` A01-1 and A01-2 record where it
  is currently thin.

## Verify

Automated, and these are what actually prove this page:

| Suite | Proves |
|---|---|
| `packages/host/src/http-adapter.test.ts` (98) | admission order, Origin/Host/CSRF, rate limits, masking, request id, `auth_failed` |
| `packages/host/src/security-headers.test.ts` (10) | the header set, and Caddyfile parity |
| `packages/core/src/security/ip-range.test.ts` (14) | CIDR membership, the v4-in-v6 forms |
| `packages/core/src/security/safe-fetch.test.ts` (19) | scheme, credentials, per-hop redirects, DNS resolution |
| `packages/db/src/vault-key.test.ts` (26) | length and randomness floors, `.master-key` corruption |
| `apps/web/lib/hosted-mode-guard.test.ts` | the production-build refusal, and that compose still pins the flag |
| `.github/workflows/ci.yml` | runs all of the above on every push and pull request |

**There is no `verify-agentforge` feature file for this page, and that is a gap rather than a
choice.** The existing `features/security.md` covers the key-fingerprint UI and
`features/gateway-gate.md` the gate; neither drives the hosted perimeter, because on a desk none
of it is on. A feature file for it needs a deployed host to point at, so it belongs with the
Phase 0 deploy. Until then this page is proved by the suites above and not by a harness run.

## Why

- **One flag rather than a config object.** `[Inferred]` No commit or doc states the decision. The
  shape is consistent across every control — each calls `isServerMode()` at the point of use — and
  `packages/core/src/server-mode.ts` carries no other export for composing them, so the design
  appears to be deliberate simplicity rather than an unfinished abstraction. The cost is stated in
  `docs/internal/security-owasp-2026-09.md` A05-1: a single point of failure, now guarded at boot.
- **Headers in two places.** `[Direct]` `packages/host/src/security-headers.ts:1-20` states the
  reasoning: the Caddyfile was the only copy, so any deployment behind a different proxy had no
  CSP at all.
- **The audit gate is scoped to the deployed closure, not the workspace.** `[Direct]`
  `scripts/audit-deployed.mjs:1-26` and `docs/internal/security-owasp-2026-09.md` A06-1: the
  workspace's 1 critical and 19 high advisories are all reachable only from `apps/desktop`, which
  `webapp-deploy/Dockerfile:59` never installs.

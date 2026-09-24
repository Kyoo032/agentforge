# Map — Hosted security controls

Last verified: 2026-09-21 at 4938747 + working tree. The boot guards and the response headers were
re-verified against that tree ([SR-14](../security-register.md#sr-14),
[SR-04](../security-register.md#sr-04)); the boot-guard path, the ffmpeg failure detail and the
top-up link were re-checked again after the fix pass of the same day. Anything not named in those
sections was last walked on 2026-09-20 at `a053245`, on the Phase 4 branch.

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
`apps/web/server/hosted-mode-guard.ts` exists to refuse a production build that answers `false`.

This page is the hosted perimeter: how a request is admitted and what a response carries, **as it
stands after the OWASP pass**. Four neighbouring pages own the parts it does not:

- [`hosted-server-mode.md`](hosted-server-mode.md) describes the same perimeter **as PR #56 built
  it**, commit by commit. Where the two disagree about a detail, this page is the newer reading —
  the OWASP pass changed several of these controls — but that page carries the history and the
  reasoning behind the original design, which is not repeated here.
- [`portal-session-auth.md`](portal-session-auth.md) owns the session itself: minting, verifying,
  refreshing and revoking. This page covers only where the gate sits in the admission order.
- [`pii-and-key-security.md`](pii-and-key-security.md) owns secrets at rest.
- [`settings-and-gateway-gate.md`](settings-and-gateway-gate.md) owns the gateway key gate.

Tenant scoping *inside* an admitted request is Phase 3's and is not described here.

## How it works

### 1. The switch

`packages/core/src/server-mode.ts:12` — `isServerMode(env = process.env)` is true when
`AGENTFORGE_SERVER` is set to `1`. `trustedOrigins` (`:52`) reads `AGENTFORGE_TRUSTED_ORIGINS`,
a comma-separated list normalised by `normaliseOrigin` (`:88`).

Three things pin the flag on for a real deployment, and check that the deployment behind it is
usable:

| Where | What it does |
|---|---|
| `webapp-deploy/compose.yml:44` | `AGENTFORGE_SERVER: "1"` under `environment:`, which beats `env_file:` — and `.env` is `required: false`, so it can be absent |
| `apps/web/server.ts:41` | `assertHostedModeCoherent(process.env)`, the first statement of `main()`, throws before `server.listen` if `NODE_ENV=production` and server mode is off |
| `apps/web/server.ts:45` | `assertHostedEnvComplete(process.env)`, the second statement, throws before `server.listen` when the server mode flag IS on but the environment behind it is not usable |

The second exists because the first only covers this compose file. A `NODE_ENV=production` build
that is not in server mode serves every `GET /api/v1/*` without a session **and passes its health
check**, because that is exactly how the desktop app is meant to behave.

The third exists because a *correctly* flagged server was still allowed to start with nothing
behind the flag. Every hosted variable was read at first use, so a container with no wrap key
answered `/healthz` (which routes before anything and opens no database), passed Caddy's active
check, and failed for the first person who signed in — `../security-register.md` SR-04. Since
2026-09-21 the check is `packages/host/src/hosted-env.ts`: in server mode it refuses to listen
unless `AGENTFORGE_SECRETS_KEY` passes `getLocalVaultKey`, at least one https origin survives
`trustedOrigins`, `AGENTFORGE_PORTAL_URL` passes `portalBaseUrl` → `assertAllowedEndpointUrl`, both
portal client credentials pass `portalClientCredentials`, an explicitly set `AGENTFORGE_PUBLIC_URL`
passes `publicBaseUrl`, and — on `NODE_ENV=production` only — `AGENTFORGE_BILLING_WEBHOOK_SECRET`
is set. Off production a missing billing secret is a startup warning instead. **It borrows every
rule from the code that will later enforce it and restates none**, which is the point: a second
copy of "what a good wrap key looks like" is how two answers to the same question appear. The
message names every broken variable at once and never prints a value. It lives in the host package
rather than in `apps/web` because those rules sit in three packages and `apps/web` can see only
two; `apps/web/server/hosted-mode-guard.ts:28` re-exports it so `server.ts` reaches both guards
through one module. Off server mode both calls return immediately, so webdev, the e2e run and the
desktop are untouched.

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
| 6 | `packages/host/src/router.ts:455-461` | `requireSessionFor` — the session gate, before the route table | `/api` minus the exempt paths |
| 7 | `:533` | `logAuthFailure` | a 401 coming back out |
| 8 | `:384` | `maskServerError` | any 5xx, in server mode |

Step 3 covering non-`/api` traffic is the part people get wrong: the TLS rule, the method
allowlist and the per-IP bucket would otherwise be off for the bulk of the traffic. Only the
Origin / CSRF / session rules are API-only, because those are about a call the renderer makes
rather than about the hop it arrived on.

### 3. Origin, Host and CSRF

`mutatingRejection` (`packages/host/src/http-adapter.ts:682-711`) chooses between two rules — the
hosted branch at `:612-620` and the desk branch at `:621-623`:

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

The gate runs in `packages/host/src/router.ts:434-442`, **before the route table is consulted** — an
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
  powerful feature off **except the two Meeting recording needs**: since 2026-09-21
  (`../security-register.md` SR-14) `microphone=(self)` and `display-capture=(self)` are allowed
  and the other sixteen stay `()`, `camera` included. `(self)` is this origin and nothing else —
  `apps/web` renders no `<iframe>`, so no `allow=` attribute exists to delegate either feature; an
  artifact body is served under `Content-Security-Policy: sandbox` (`handlers/artifacts.ts:72`),
  which puts it in an opaque origin that `self` never matches; and `frame-ancestors 'none'` keeps
  the app out of anyone else's frame. Server mode only: webdev's inline module preloads and the
  desktop's custom protocol would both break under a CSP written for the built bundle.
  `webapp-deploy/Caddyfile` sets the same set; Caddy's `header` directive **replaces** rather than
  appends, so the proxy's value wins on the real deployment and nothing is duplicated. The app is
  the floor, the proxy is the ceiling — and `security-headers.test.ts` parses the Caddyfile and
  fails if the two policies stop agreeing, so "changed one, forgot the other" is a red test rather
  than a header nobody sends.
- **Identity headers stripped.** `X-Powered-By` and `Server` are removed in the adapter
  (`IDENTITY_HEADERS`, `packages/host/src/http-adapter.ts:53`) and again at the proxy.
- **Errors masked.** `maskServerError` (`:384`) replaces any 5xx message with a fixed string and
  keeps only a code matching `/^[a-z0-9_]+$/` (`:49`), so a SQLite error naming a column or a path
  never reaches the client. Off server mode it is a no-op and webdev's error path is untouched.
- **4xx is NOT masked, which is where the leaks live.** `maskServerError` only touches 5xx, and a
  deliberately malformed upload is answered `400`. The one that got through was ffmpeg: a failed
  run put `execFile`'s own message — the absolute path of the binary followed by every argument,
  which for this app is the absolute path of a tenant's media inside the data dir — plus 300
  characters of raw stderr into `ApiError("ffmpeg_failed", …)`, which `jsonError` serialises to the
  browser and Meeting streams as an SSE `job.error` frame. Since 2026-09-21 the detail goes to
  `log.warn("ffmpeg_failed", …)` — redacted, structured, server-side — and the client gets a fixed
  sentence plus a reason class chosen from the failure rather than copied out of it: `unreadable
  input`, `an unsupported codec`, `the tool could not be started`, `an invalid run request`, `too
  much output`, or `exit code N` (`packages/host/src/edit/ffmpeg/run.ts:80-138`, `:195-199`).
  `run-failure-detail.test.ts` asserts that no absolute path, argv fragment or tenant filename
  survives into the message.
- **An operator's string is not a URL.** `AGENTFORGE_BILLING_TOPUP_URL` was echoed to the browser
  verbatim and turned into an `href` on a page inside the tenant's session, so a `javascript:` or
  `data:` value in the deployment's environment would have been script execution. It is validated
  at the source now (`packages/host/src/billing/topup-url.ts`): anything that is not an absolute
  http(s) URL answers `available: false`, and the operator is warned at boot and on first use by
  **variable name only** — never the value, in case a secret was pasted into the wrong slot. The
  renderer's own `safeCheckoutUrl` (`apps/web/lib/plans-api.ts`) stays: a control at the source and
  a control at the sink are the two ends of one string, not a duplicate.
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
| `POST /api/v1/settings` — operator keys | `packages/host/src/handlers/settings.ts:168-201` | gateway key, provider keys, `toolKeys`, `toolBackends` and `injectionGuardBypass` are the operator's, not a tenant's |
| `POST /api/v1/settings/reset` scope `all`, and its cancel | `resetEverything`, `packages/host/src/handlers/settings.ts:423-440` | "Start over" deletes the data directory, which on a host is everyone's. Scope `key` is **allowed** on the server since Phase 4 — it only forgets the caller's own key (`resetGatewayKey`, `:400-415`) |
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
| `apps/web/server/hosted-mode-guard.ts` | Refuses to boot a production build that is not in server mode; re-exports the environment check below |
| `packages/host/src/hosted-env.ts` | Refuses to boot a server-mode process whose hosted environment is incomplete, naming every variable at once |
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
| `packages/host/src/security-headers.test.ts` (14) | the header set, the exact `Permissions-Policy` string, and Caddyfile parity |
| `packages/core/src/security/ip-range.test.ts` (14) | CIDR membership, the v4-in-v6 forms |
| `packages/core/src/security/safe-fetch.test.ts` (19) | scheme, credentials, per-hop redirects, DNS resolution |
| `packages/db/src/vault-key.test.ts` (26) | length and randomness floors, `.master-key` corruption |
| `apps/web/server/hosted-mode-guard.test.ts` (13) | the production-build refusal, that compose still pins the flag, and that both boot guards run before `server.listen` |
| `packages/host/src/hosted-env.test.ts` (32) | one row per hosted variable, the aggregated message, that no value is printed, and that local mode is untouched |
| `scripts/ci-local.mjs` (`pnpm ci:local`) | runs all of the above, one package at a time. Since 2026-09-24 it is the only CI: `.github/workflows/` is deleted, and nothing runs these unless someone runs it (`../security-register.md`, SR-80) |

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

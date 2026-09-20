# Map — Portal browser session (hosted server)

Last verified: 2026-09-20 at a053245 + the Phase 4 branch `feat/web-phase4-tenant-secrets-rcbu9c` (through e37b3a1)

## Overview

The server-side half of signing in to the hosted deployment: four `/api/v1/auth/*` routes, an opaque
cookie, a SQLite row per session, and a gate in the router that refuses every other `/api` call
without one. It landed in PR #56 (`6ae177a`) and runs **only** when `AGENTFORGE_SERVER` is `1`
(`packages/core/src/server-mode.ts:12-15`, read per request at `packages/host/src/router.ts:410`), so
the desktop IPC path and webdev never mint, read or require a session.

It is a backend. There is no sign-in screen — see **Not built** below. The verified session rides on
`request.session` for Phase 3, but `getTenant()` does not read it yet, so the hosted server is
single-tenant until Phase 3 lands (`packages/host/src/tenant.ts:42-47`).

## How it works

### Sign in — `POST /api/v1/auth/login`

Routed at `packages/host/src/router.ts:222` to `handleLogin`
(`packages/host/src/auth/routes.ts:233-265`).

1. `readCode` (`packages/host/src/auth/routes.ts:193-199`) demands a non-empty string `code` in the
   JSON body. Anything else is `invalid_request` at 400 — the portal is never called.
2. `portal.exchangeCode({ code })` posts `{ grant_type: "authorization_code", code }` to
   `{AGENTFORGE_PORTAL_URL}/auth/token` (`packages/host/src/auth/portal-client.ts:212-214`,
   `packages/host/src/auth/portal-client.ts:199-209`). The base URL comes from the environment only,
   trailing slashes stripped, and is put through the same endpoint validator as every other outbound
   URL — which refuses plain HTTP off loopback and any URL carrying credentials
   (`packages/host/src/auth/portal-client.ts:85-92`, `packages/core/src/security/tls.ts:9-32`). It
   **throws** when the variable is absent, which is why every portal dependency in this module is
   constructed lazily (`packages/host/src/auth/index.ts:64-76`).
3. `toTokens` (`packages/host/src/auth/portal-client.ts:134-157`) requires `access_token`,
   `refresh_token`, `session_id`, `user_id`, `org_id` and `tenant_id`. A 200 missing any of them is
   `portal_unavailable` at 502: the portal misbehaving, not the user's fault.
4. `createSession` (`packages/host/src/auth/session.ts:103-116`) mints 32 random bytes as base64url
   (`packages/host/src/auth/session.ts:99-101`) and stamps `createdAt = lastSeenAt = now`,
   `expiresAt = now + 12 h`, `absoluteExpiresAt = now + 30 days`, `revokedAt = null`
   (`packages/host/src/auth/session.ts:40-41`).
5. The row goes to the store (`packages/host/src/auth/routes.ts:258`); the portal's access and
   refresh tokens and `device_id` go to the in-memory vault keyed by session id
   (`packages/host/src/auth/routes.ts:259-263`).
6. The answer is `sessionSummary` — `{ signedIn: true, userId, orgId, tenantId, expiresAt }`, with no
   token in it (`packages/host/src/auth/session.ts:152-160`) — plus the session cookie
   (`packages/host/src/auth/routes.ts:264`).

**Failure mode.** A portal refusal arrives as a `PortalError` and is converted by `fromPortal` into
the host's `ApiError`, keeping the portal's reason code, its HTTP status and its `message_en`
(`packages/host/src/auth/routes.ts:87-100`, `packages/host/src/auth/routes.ts:83-85`). Every handler
is wrapped in `guarded` (`packages/host/src/auth/routes.ts:202-212`), so that leaves as the standard
`{ error: { code, message } }` envelope with the reason as the code
(`packages/host/src/errors.ts:17-32`). No token ever reaches a message: `PortalError` composes its own
text from the reason alone (`packages/host/src/auth/portal-client.ts:72-73`), and a `fetch` rejection
is swallowed without attaching the cause, because that cause can carry the request body
(`packages/host/src/auth/portal-client.ts:183-187`).

### Every other call — the session gate

`dispatch` upper-cases the method and strips trailing slashes once
(`packages/host/src/router.ts:406-407`), resolves server mode **per request** rather than at import
(`packages/host/src/router.ts:408-410`), and runs the gate only in server mode
(`packages/host/src/router.ts:412-418`).

`gate` (`packages/host/src/router.ts:375-403`) lets a path through untouched when it is not under
`/api/` (`packages/host/src/router.ts:351`, `packages/host/src/router.ts:381`) or when
`isSessionExemptPath` says so. That function
(`packages/host/src/auth/routes.ts:108-113`) exempts exactly three things:

| Exempt | Why |
|---|---|
| anything under `/api/v1/auth/`, **any** method | nobody has a session yet (`packages/host/src/auth/routes.ts:39`) |
| `GET /api/v1/ping` | the health probe the proxy polls (`packages/host/src/auth/routes.ts:45`) |
| `GET /api/v1/components` | the first-run installer's status read (`packages/host/src/auth/routes.ts:45`) |

Nothing else, for any method. A read is not safe here — a GET returns settings, threads, artifact
bytes and event streams — so the method alone never exempts anything, and the same path with a
different method is a different answer: `GET /api/v1/components` is exempt while
`POST /api/v1/components/install/stream` is not (`packages/host/src/auth/routes.ts:102-113`).

Everything else calls `requireSessionFor` (`packages/host/src/auth/routes.ts:150-156`), which throws
`authError(reason, 401)` on any bad verdict. That 401 is produced **before the route table is
consulted** (`packages/host/src/router.ts:398-402`), so an unauthenticated caller cannot learn which
paths exist: an unknown path and a real one both answer `401 session_required`.

On success the four identifiers are attached to the request as `request.session`
(`packages/host/src/router.ts:389-397`, `packages/host/src/types.ts:32-37`). `dispatch` destructures
any `session` the caller supplied off the request first and re-adds only the gate's own
(`packages/host/src/router.ts:434-435`), so an invented session can never reach a handler as identity,
and the caller's request object is never written to.

### Verify, slide, expire

`loadSession` (`packages/host/src/auth/routes.ts:133-147`) reads the cookie, looks the row up and
runs `verifySession`. The cookie read is `readSessionCookie`
(`packages/host/src/auth/session.ts:193-210`): it splits the raw `Cookie` header, matches this mode's
name exactly, and returns null for a value that will not `decodeURIComponent`
(`packages/host/src/auth/session.ts:178-184`) — an attacker-controlled `%` must answer 401, not throw
a `URIError` that surfaces as a 500. `mode` is a required parameter with no default, on purpose: a
caller that read the plain name on the hosted server would hand back the session fixation the
`__Host-` prefix exists to prevent (`packages/host/src/auth/session.ts:186-192`).

`verifySession` (`packages/host/src/auth/session.ts:122-136`) decides in this order:

| Condition | Verdict |
|---|---|
| no row | `session_required` |
| `revokedAt !== null` | `session_revoked` — revoked beats expired, so a forced sign-out reports itself |
| `now >= expiresAt` or `now >= absoluteExpiresAt` | `refresh_expired` |
| `now - lastSeenAt < 5 min` | ok, `slid: false` — no write |
| otherwise | ok, `slid: true` — a slid copy |

A slide re-opens the 12 h idle window but is clamped to the absolute expiry
(`packages/host/src/auth/session.ts:139-145`), and it is persisted only when it actually happened
(`packages/host/src/auth/routes.ts:143-145`), so a busy tab does not write a row per request.

### Refresh — `POST /api/v1/auth/refresh`

`handleRefresh` (`packages/host/src/auth/routes.ts:292-322`) needs a live session first, then the
vault entry behind it.

- **No vault entry** — the host restarted since this browser signed in. The session is ended and the
  answer is `refresh_expired` at 401 (`packages/host/src/auth/routes.ts:295-300`).
- **Portal refresh** posts `{ grant_type: "refresh_token", refresh_token, device_id? }`, omitting
  `device_id` entirely when the session has none
  (`packages/host/src/auth/portal-client.ts:215-221`).
- **`portal_unavailable`** is offline, not refused: the error is rethrown and the session *survives*
  (`packages/host/src/auth/routes.ts:306-309`).
- **Every other reason** is terminal. The session is ended and the answer carries the cleared cookie
  alongside the error envelope (`packages/host/src/auth/routes.ts:310-312`).
- **Success** replaces the vault entry with the rotated pair, saves a slid session and re-issues the
  cookie with a fresh `Max-Age` (`packages/host/src/auth/routes.ts:314-321`).

### Sign out — `POST /api/v1/auth/logout`

`handleLogout` (`packages/host/src/auth/routes.ts:267-281`) is idempotent at both ends. An absent or
stale cookie still returns 200 `{ signedIn: false }` with the cleared cookie and never calls the
portal (`packages/host/src/auth/routes.ts:269-273`). With a row, the portal's
`POST /auth/logout` (Bearer access token, body `{ all_devices: false }`) is called best-effort and its
refusal is swallowed twice over — once in the client
(`packages/host/src/auth/portal-client.ts:222-230`) and once at the call site
(`packages/host/src/auth/routes.ts:277`) — because an unreachable or unhappy portal must not block
the local wipe. `endSession` (`packages/host/src/auth/routes.ts:228-231`) then saves a revoked copy
and deletes the vault entry. Re-revoking keeps the **first** revocation time, so an audit reads the
moment the session actually died (`packages/host/src/auth/session.ts:148-150`).

### Status — `GET /api/v1/auth/session`

`handleSession` (`packages/host/src/auth/routes.ts:283-290`) always answers 200. A live session
returns the summary. A visitor who never signed in is not an error and gets `{ signedIn: false }`
with **no** reason to render; a visitor who presented a cookie that failed gets
`{ signedIn: false, reason }`.

### The cookie

Two names for one cookie (`packages/host/src/auth/session.ts:29-30`), chosen by
`sessionCookieName` (`packages/host/src/auth/session.ts:36-38`):

| Mode | Name |
|---|---|
| hosted server (`serverMode`, HTTPS) | `__Host-agentforge_session` |
| webdev and the desktop shell (plain http) | `agentforge_session` |

The prefix is not decoration: a browser accepts a `__Host-` cookie only when it is `Secure`,
`Path=/` and carries no `Domain`, and nothing but that exact origin can write it — no sibling
subdomain, no `document.cookie` on a related host
(`packages/host/src/auth/session.ts:18-28`). Off server mode the prefix is impossible, because a
browser silently drops a `__Host-` cookie over plain http.

The routes build a `HostCookie`, never a `Set-Cookie` string:
`{ path: "/", sameSite: "Lax", httpOnly: true, secure: serverMode, maxAge }`
(`packages/host/src/auth/routes.ts:164-177`). `maxAge` tracks the **absolute** expiry in whole
seconds, floored and never negative (`packages/host/src/auth/session.ts:169-171`) — the 12 h idle
timeout is enforced server-side only. `Lax` rather than `Strict` because sign-in returns through a
top-level navigation from the portal (`packages/host/src/auth/session.ts:162-168`). Clearing uses the
same attributes with `maxAge: 0` (`packages/host/src/auth/routes.ts:179-191`).

The adapter serialises it once, and is the only place any cookie of this app becomes a header:
`Path`, then `Max-Age` when set, then `SameSite` (defaulting to `Strict`), then `HttpOnly` unless
explicitly false, then `Secure` when set — and never a `Domain`, which `__Host-` also requires
(`packages/host/src/http-adapter.ts:209-218`).

### How it relates to the CSRF cookie and `WORKSPACE_COOKIE`

Three cookies, one serialiser, one origin:

| Cookie | Name(s) | Attributes | Set by |
|---|---|---|---|
| session | `__Host-agentforge_session` / `agentforge_session` (`packages/host/src/auth/session.ts:29-30`) | `HttpOnly; SameSite=Lax; Path=/; Secure` on the server | the auth routes (`packages/host/src/auth/routes.ts:164-177`) |
| CSRF | `__Host-agentforge_csrf` / `agentforge_csrf` (`packages/host/src/csrf.ts:23`, `packages/host/src/csrf.ts:26`) | `Path=/; SameSite=Lax; Secure` on the server — deliberately **not** `HttpOnly` (`packages/host/src/csrf.ts:133-136`) | the adapter itself, on the first GET that arrives without one, or whose token is bound to a different session (`packages/host/src/http-adapter.ts:447-450`) |
| workspace | `agentforge_workspace` (`packages/core/src/local-owner.ts:14`) | `SameSite=Strict; HttpOnly` by the serialiser's defaults (`packages/host/src/http-adapter.ts:214-215`) | handlers; read back into `request.workspaceId` (`packages/host/src/http-adapter.ts:488`) |

The session cookie and the CSRF cookie make exactly the same `secure`-picks-the-name split, for the
same reason, and neither reads the other's mode. They are otherwise independent controls in series:
the CSRF double-submit check runs **in the adapter**, before dispatch, on every non-safe method
(`packages/host/src/http-adapter.ts:435-440`, `packages/host/src/http-adapter.ts:534-557`), while the
session gate runs inside `dispatch`. **Since Phase 3 lane C the token is bound to the session**: it
is `<salt>.<HMAC(key, sessionId.salt)>` rather than bare randomness
(`mintCsrfTokenFor`, `packages/host/src/csrf.ts:87-90`; `sign`, `:56-58`), so a token minted for one
session is refused when another echoes it — the double-submit pair alone proves same-origin script,
not same-signed-in-person (`packages/host/src/csrf.ts:14-19`). Off server mode there is no session
and the binding is to the empty id, so webdev and the desktop behave exactly as before. The adapter
re-mints on a GET whose cookie does not match the presented session
(`packages/host/src/http-adapter.ts:448-450`).

The adapter forwards the raw `Cookie` header to the host request alongside the jar it parses for
itself (`packages/host/src/http-adapter.ts:481`), which is what `readSessionCookie` reads.

### The table

`auth_sessions`, created by **`packages/db/drizzle/0014_auth_sessions.sql`** (statements at
`packages/db/drizzle/0014_auth_sessions.sql:12-27`, journal entry at
`packages/db/drizzle/meta/_journal.json:103-109`). Nine columns, epoch milliseconds throughout, and
two indexes: `auth_sessions_user_seen_idx` on `(user_id, last_seen_at)` for the Phase 5 seat counter,
and `auth_sessions_expires_idx` on `expires_at`. The drizzle definition is
`packages/db/src/schema.ts:754-772`.

Every statement is `IF NOT EXISTS`, and the same DDL is mirrored in
`ensureAuthSessionTables` (`packages/db/src/ensure-schema.ts:397-463`, called at
`packages/db/src/ensure-schema.ts:243`), because a database baseline-stamped past this migration has
the journal row without the table.

`createDrizzleSessionStore` (`packages/host/src/auth/session-store.ts:103-132`) is the SQLite
implementation of a four-method interface (`packages/host/src/auth/session-store.ts:14-23`) whose
other implementation is an in-memory map for tests
(`packages/host/src/auth/session-store.ts:29-53`). `save` writes only the four mutable columns —
`last_seen_at`, `expires_at`, `absolute_expires_at`, `revoked_at`
(`packages/host/src/auth/session-store.ts:114-125`). The `@agentforge/db` import is deferred to first
use, twice over (`packages/host/src/auth/session-store.ts:98-101`,
`packages/host/src/auth/session-store.ts:138-143`), because that entry point opens the SQLite file as
an import side effect and neither the desktop nor a unit test that never signs in should pay for it.

Nothing deletes a row on the request path: sign-out revokes, a slide rewrites, an expiry is only
read. A 15-minute sweep is what keeps the table bounded — `startSessionPurge`
(`packages/host/src/auth/index.ts:90-104`, interval at `packages/host/src/auth/index.ts:79`) fires
once at first use and then on an `unref()`'d timer, logging and retrying a failed sweep rather than
taking the process down. It is wired to the process-wide store
(`packages/host/src/auth/index.ts:112-118`).

**The vault is not in the database.** The portal's refresh and access tokens live in process memory
only (`packages/host/src/auth/session-store.ts:66-92`,
`packages/host/src/auth/index.ts:121-124`), because the server has no at-rest envelope for them until
Phase 4, and a raw refresh token in SQLite would be the one plaintext secret in the schema
(`packages/host/src/auth/session-store.ts:55-65`). The cost is stated and implemented: a restart
drops every vault entry, and each browser's next refresh answers `refresh_expired`
(`packages/host/src/auth/routes.ts:295-300`).

### The tighter auth rate bucket

Three token buckets, all server-mode only, all in memory, all LRU-bounded at `MAX_RATE_KEYS = 50 000`
so a key-rotating attacker cannot turn the limiter into the leak
(`packages/host/src/rate-limit.ts:4-14`, `packages/host/src/rate-limit.ts:35`,
`packages/host/src/rate-limit.ts:107-115`):

| Bucket | Default rpm / burst | Keyed on | Env override |
|---|---|---|---|
| `ip` | 600 / 100 | client IP | `AGENTFORGE_RATE_IP_RPM` |
| `auth` | **30 / 10** | client IP, only on `/api/v1/auth/` | `AGENTFORGE_RATE_AUTH_RPM` |
| `session` | 300 / 50 | SHA-256 prefix of the session cookie | `AGENTFORGE_RATE_SESSION_RPM` |

Defaults at `packages/host/src/rate-limit.ts:23-28`, env names at
`packages/host/src/rate-limit.ts:30-32`, resolution at `packages/host/src/rate-limit.ts:165-171`.
Junk in the variable falls back to the default rather than switching the limiter off — a typo in
`.env` must not quietly remove a limit — while an explicit non-positive number is the documented
escape hatch (`packages/host/src/rate-limit.ts:178-182`, `packages/host/src/rate-limit.ts:82-84`).

The auth bucket catches **every** path under `/api/v1/auth/`
(`packages/host/src/rate-limit.ts:38`, `packages/host/src/rate-limit.ts:155-157`) because each of
those routes is a portal round trip. It is keyed on the IP, not on a session — a caller trying to
sign in has no session to key on (`packages/host/src/rate-limit.ts:237-241`). The order in that same
list is deliberate: the general IP bucket is spent first so the refusal is still reported as `auth`
when an auth flood is what tripped it (`packages/host/src/rate-limit.ts:227-230`).

The session bucket never sees a cookie value in the clear — it keys on the first 32 hex characters of
its SHA-256 (`packages/host/src/rate-limit.ts:147-153`), read with this mode's cookie name
(`packages/host/src/http-adapter.ts:404`, hashed at `:420`). All three run in the adapter before the Origin, CSRF and
session rules, and before the body is read
(`packages/host/src/http-adapter.ts:419-425`, `packages/host/src/http-adapter.ts:324-347`). A refusal
is 429 `rate_limited` with `Retry-After` in whole seconds, never 0
(`packages/host/src/rate-limit.ts:102-105`, `packages/host/src/http-adapter.ts:302-305`).

### The reason vocabulary

`AUTH_REASONS` is thirteen codes (`packages/host/src/auth/session.ts:52-66`): eleven taken from the
portal doc's own table (`docs/internal/portal/device-code-login.md:407-425`) and two minted here —
`session_required`, the gate's 401, and `portal_unavailable`, which the portal by definition cannot
report about itself (`packages/host/src/auth/session.ts:45-51`). Four rows of the doc's table are
deliberately absent because they belong to the device-code polling loop this deployment does not run:
`device_code_expired`, `device_code_denied`, `authorization_pending` and `slow_down`
(`docs/internal/portal/device-code-login.md:420-423`).

`mapPortalError` (`packages/host/src/auth/portal-client.ts:115-132`) reduces any refusal to one of
them: a recognised `reason` wins; a 5xx or a dead socket is `portal_unavailable`; `invalid_request`
in the RFC 6749 `error` slot survives as itself; everything else is `invalid_grant`. An **unknown**
`reason` string is not passed through — `isAuthReason` gates it
(`packages/host/src/auth/session.ts:70-72`) — so the host never invents a code, and never forwards
one it cannot render.

English fallback copy lives in `REASON_COPY_EN` (`packages/host/src/auth/routes.ts:62-76`) and is
used only when the portal sent no `message_en` (`packages/host/src/auth/routes.ts:83-85`). The same
thirteen keys exist in both renderer catalogs, `apps/web/locales/en/auth.json` and
`apps/web/locales/id/auth.json`, registered as the `auth` namespace
(`apps/web/lib/i18n.ts:69`, `apps/web/lib/i18n.ts:97`, `apps/web/lib/i18n.ts:121`) — and nothing reads
them yet.

### What of the portal contract is assumed, not verified

Say this plainly: **no part of this contract has been exercised against a live portal from this
repo.** `docs/internal/portal/device-code-login.md:8` states "Status: design, not implemented." Every
test that touches the portal uses a fake or a stubbed `fetch`
(`packages/host/src/auth/portal-client.ts:254-284`). So the strongest claim available for anything
below is "matches the design document".

| Piece | Standing |
|---|---|
| `POST /auth/token` with `grant_type=authorization_code` and `{ code }`, answering with the device-code token body | **Assumed.** The doc describes only the Electron device-code flow and says the web needs a browser-session variant of it; that is open decision 2 (`docs/internal/portal/device-code-login.md:3-6`, `docs/internal/web-pivot-2026-09-18.md:37`). The assumption is written down at the point it is made (`packages/host/src/auth/portal-client.ts:14-23`) and isolated in one function (`packages/host/src/auth/portal-client.ts:212-214`). |
| `POST /auth/token` with `grant_type=refresh_token`, carrying the server-side `device_id` rather than the client `install_id` | Matches the doc (`docs/internal/portal/device-code-login.md:196-200`), which is itself unimplemented. |
| `POST /auth/logout`, Bearer token, `{ all_devices: false }`, idempotent | Matches the doc (`docs/internal/portal/device-code-login.md:228-230`). The code does not rely on the "always 204" half — it swallows any answer. |
| The error body `{ error, reason, message_en, message_id, retry_after }` | Matches the doc (`docs/internal/portal/device-code-login.md:85-94`). `retry_after` is parsed onto `PortalError` (`packages/host/src/auth/portal-client.ts:65`, `packages/host/src/auth/portal-client.ts:117-121`) and then **never read** by any route. |
| The reason codes and their English copy | Matches the doc's table (`docs/internal/portal/device-code-login.md:407-425`). |
| The portal's own `GET /auth/session` (`docs/internal/portal/device-code-login.md:232-234`) | **Not implemented.** `PortalClient` has three methods (`packages/host/src/auth/portal-client.ts:49-56`); the host answers `/api/v1/auth/session` from its own row and never asks the portal for status. |
| The doc's 7-day offline grace (`docs/internal/portal/device-code-login.md:484`) | **Not implemented as a window.** What exists is narrower: a refresh that fails with `portal_unavailable` leaves the session alive (`packages/host/src/auth/routes.ts:306-309`). There is no `lastRefreshOkAt`, no counter and no banner anywhere under `packages/host/src/auth/`. |

### Not built: there is no browser sign-in screen

Stated as a fact, from four reads:

- `apps/web/src/App.tsx:150-175` is the whole route table. There is no `/login`, no `/signin`, no
  auth route; the catch-all sends everything unknown to `/chat`.
- `apps/web/src/pages/` contains one file, `chat-page.tsx`.
- Nothing in `apps/web/` references `signedIn`, `session_required` or `/api/v1/auth/` — a grep over
  every `.ts` and `.tsx` in that tree returns no hits, and `apps/web/lib/api-client.ts` has no auth
  call.
- The `auth` namespace is registered and both catalogs are complete
  (`apps/web/lib/i18n.ts:69`), but no component reads a key from it: the only match for `"auth"` in
  the whole app is that registration line.

The plan says the same: "backend landed … no UI yet … The sign-in screen and the Playwright project
are still open" (`docs/internal/web-migration-plan.md:111`).

The practical consequence: with `AGENTFORGE_SERVER=1` and no sign-in screen, the hosted renderer's
own API calls all answer `401 session_required`, because the gate exempts only ping and components.
The hosted deployment is not usable through a browser until that screen exists.

## Where things live

| File | Role |
|---|---|
| `packages/host/src/auth/session.ts` | Pure session logic: cookie names, mint, verify, slide, revoke, summary, `Max-Age`, cookie parsing, the reason vocabulary |
| `packages/host/src/auth/session-store.ts` | The `SessionStore` interface, the SQLite and in-memory implementations, and the process-memory token vault |
| `packages/host/src/auth/portal-client.ts` | The portal contract: exchange, refresh, logout, error → reason mapping, the test double |
| `packages/host/src/auth/routes.ts` | The four handlers, the exemption predicate, `loadSession` / `requireSessionFor`, the cookie shapes, the English fallback copy |
| `packages/host/src/auth/index.ts` | Public surface and the server's composition root: SQLite store, memory vault, lazy portal client, the purge timer, `resetHostAuthForTests` |
| `packages/host/src/router.ts` | The route table (`:159-164`) and the server-mode-only gate (`:305-360`) |
| `packages/host/src/http-adapter.ts` | Cookie parsing and serialisation, the CSRF check, the rate-limit call, the raw `Cookie` header forwarded to the host request |
| `packages/host/src/csrf.ts` | The sibling double-submit cookie: same name split, different flags, checked before dispatch |
| `packages/host/src/rate-limit.ts` | The three buckets, including the tight `/api/v1/auth/` one |
| `packages/db/drizzle/0014_auth_sessions.sql` | The migration that creates `auth_sessions` and its two indexes |
| `packages/db/src/schema.ts` | The drizzle table (`:663-681`) |
| `packages/db/src/ensure-schema.ts` | The mirrored DDL for databases stamped past 0014 (`:385-401`) |
| `docs/internal/portal/device-code-login.md` | The portal contract this implements — a design document, not a running service |

## Gotchas

- **Comment citations into `http-adapter.ts` are stale.** `packages/host/src/auth/routes.ts:17` says
  the adapter forwards the raw cookie at `http-adapter.ts:263`; it is at
  `packages/host/src/http-adapter.ts:481`. `packages/host/src/auth/routes.ts:160-161` says the
  attributes are serialised at `http-adapter.ts:138-146`; `serialiseCookie` is at
  `packages/host/src/http-adapter.ts:209-218`, and `packages/host/src/auth/routes.test.ts:370`
  repeats the same stale reference. The behaviour described is right; the line numbers are not. Grep for the identifier, never trust a line number in prose.
- **`DispatchOptions.serverMode` does not pick the cookie name.** The gate passes only `store` and
  `now` into `requireSessionFor` (`packages/host/src/router.ts:413-416`), so `cookieMode` falls back
  to `isServerMode()` (`packages/host/src/auth/routes.ts:124-126`). A test that passes
  `serverMode: true` while `AGENTFORGE_SERVER` is unset is gated but reads the **plain** cookie name
  — which is exactly what `packages/host/src/auth/session-gate.test.ts:205-212` does, deliberately.
  `createAuthRoutes` does inject the flag (`packages/host/src/auth/routes.ts:51-52`), so the four
  routes and the gate can disagree about the name in a mixed setup.
- **A 403 comes before the 401.** An unauthenticated mutating call that carries no CSRF token is
  refused by the adapter with `csrf_missing` at 403 before `dispatch` ever runs
  (`packages/host/src/http-adapter.ts:435-440`). `session_required` is what an unauthenticated *read*
  gets. Do not read a 403 here as "the session gate is broken".
- **`session_revoked` beats `refresh_expired`.** A revoked row that is also past its expiry reports
  `session_revoked` (`packages/host/src/auth/session.ts:126-131`), because the copy differs and the
  user's recovery differs.
- **A server restart signs everyone out at their next refresh, not immediately.** The rows survive;
  the tokens do not (`packages/host/src/auth/session-store.ts:55-65`). Sessions keep verifying until
  a refresh finds an empty vault and ends them
  (`packages/host/src/auth/routes.ts:295-300`).
- **`sessionCookieMaxAge` tracks the absolute expiry, not the idle one.** The browser keeps the
  cookie for up to 30 days while the server may have idled the session out after 12 h
  (`packages/host/src/auth/session.ts:162-171`). A cookie that still exists is not a session that
  still works.
- **Sign-out never deletes a row.** It sets `revokedAt` so the next request can say `session_revoked`
  rather than `session_required` (`packages/host/src/auth/routes.ts:228-231`,
  `packages/db/drizzle/0014_auth_sessions.sql:4-7`). Only the 15-minute purge removes anything, and
  only past the absolute expiry (`packages/host/src/auth/session-store.ts:126-131`).
- **`hostSessionStore()` starts a timer as a side effect of first use**
  (`packages/host/src/auth/index.ts:112-118`). A test that touches it must call
  `resetHostAuthForTests()` (`packages/host/src/auth/index.ts:144-151`) or it leaks an interval —
  `unref()`'d, so the process still exits, but the sweep keeps firing.
- **`portalBaseUrl` throws when `AGENTFORGE_PORTAL_URL` is unset**
  (`packages/host/src/auth/portal-client.ts:86-89`). That is correct on a server and wrong
  everywhere else, which is why nothing in this module may be constructed at import time
  (`packages/host/src/auth/index.ts:1-8`). Importing the router must never open the database or read
  the portal URL.
- **`retry_after` is parsed and then dropped.** `PortalError` carries it
  (`packages/host/src/auth/portal-client.ts:65`) but no route puts it on the answer; the only
  `Retry-After` a client sees from this subsystem is the rate limiter's
  (`packages/host/src/http-adapter.ts:302-305`).
- **The 401 body is not masked; a 500 is.** `maskServerError` only rewrites status ≥ 500
  (`packages/host/src/http-adapter.ts:355-364`), so the reason code and its copy reach the browser
  intact — which is the whole point of the vocabulary.

## Verify

**No feature file drives sign-in.** `.cursor/skills/verify-agentforge/features/` has 32 files and
none of them covers it; a grep of that whole tree for `session_required`, `/auth/login`, `sign in`,
`signin` or `sign-in` matches one unrelated line in `features/models.md`. That is honest rather than
accidental: there is no sign-in screen to press (see **Not built**), so there is nothing for a
user-POV feature file to describe. When the screen lands, this page needs a feature file naming it,
and the `Verified by` row in `docs/internal/maps/README.md` is empty until then.

What actually proves this page today is unit tests — read, not run, at this commit:

| Test file | Proves |
|---|---|
| `packages/host/src/auth/session.test.ts` | 32-byte base64url ids that never repeat; the 12 h / 30 day windows; the verdict order including revoked-beats-expired; the 5-minute slide and its absolute clamp; `Max-Age` never outliving the absolute expiry; the `__Host-` name split and that each mode ignores the other's cookie; a malformed percent-escape read as no cookie; `AUTH_REASONS` being the portal list plus this phase's additions |
| `packages/host/src/auth/session-store.test.ts` | Both store implementations against one shared suite: round-trip, unknown id, slide persistence, revocation leaving the row findable, purge by absolute expiry, and the vault forgetting a rotated token |
| `packages/host/src/auth/portal-client.test.ts` | `AGENTFORGE_PORTAL_URL` handling including the plain-HTTP refusal; the timeout signal on every call; reason mapping including unknown-reason → `invalid_grant`, 5xx and malformed body → `portal_unavailable`; the refresh grant with and without `device_id`; logout idempotence; and that no token reaches the console or an error message |
| `packages/host/src/auth/routes.test.ts` | All four routes end to end against fakes, the exemption table (`:305-338`), `requireSessionFor`, and the cookie's attributes per mode including the cleared cookie (`:372-436`) |
| `packages/host/src/auth/session-gate.test.ts` | The gate itself: off server mode it never runs; on, it 401s a POST, a HEAD and a DELETE alike, 401s before deciding whether the route exists, 401s a malformed cookie rather than 500ing, lets ping / components / the auth routes through, still gates the component install, slides through the gate, reads `isServerMode()` per request, and attaches `request.session` while dropping any the caller invented |
| `packages/host/src/auth/session-purge.test.ts` | The sweep: once at first use, then every 15 minutes, `unref()`'d, surviving a throwing store, wired into and torn down with the composition root |
| `packages/db/src/auth-sessions.test.ts` | The migration: the table is a kernel table, its exact column list and both index names, `revoked_at` nullable, and that `ensure-schema` re-creates it after a `DROP TABLE` |
| `packages/host/src/rate-limit.test.ts` | `isAuthPath` (including that `/api/v1/authors` is not one) and the auth bucket's arithmetic |
| `packages/host/src/http-adapter.test.ts:1310-1352` | The tight auth bucket end to end: `DEFAULT_AUTH_BURST` requests to `/api/v1/auth/session` then a 429 while the rest of the app still answers; the session bucket keyed on the `__Host-` name across changing IPs; the plain name ignored in server mode; and the refusal logged without the cookie value |

A live check, once an instance exists, is two curls: `GET /api/v1/ping` answers 200 with no cookie,
and `GET /api/v1/settings` answers `401 session_required` with the same envelope.

## Why

**The hosted server gates reads as hard as writes.**
`[Direct]` — `packages/host/src/router.ts:367-374` and
`packages/host/src/auth/routes.ts:102-107` both record the reasoning: a GET returns settings, threads,
artifact bytes and event streams, so "safe method" is not a meaningful category here, and the method
is part of the exemption key rather than an exemption of its own.

**The browser login exchange is an assumption, isolated in one function.**
`[Direct]` — `docs/internal/web-pivot-2026-09-18.md:37` lists the browser login flow as open decision
2, owner Kyo, status open; `docs/internal/portal/device-code-login.md:3-6` says the hosted app needs
a browser-session variant of the device-code flow. `packages/host/src/auth/portal-client.ts:14-23`
states the assumed shape and commits to "if the portal team picks another shape, this one function
changes and nothing else does".

**The refresh token stays in process memory rather than going into SQLite.**
`[Direct]` — `packages/host/src/auth/session-store.ts:55-65`: the server has no at-rest envelope for
it until Phase 4, and writing a raw refresh token into the database would make it the one plaintext
secret in the schema. The cost — a restart forces every browser to sign in again at its next refresh
— is written down in the same comment.

**Sign-out revokes instead of deleting.**
`[Direct]` — `packages/db/drizzle/0014_auth_sessions.sql:4-7`: so the next request can answer
`session_revoked` rather than `session_required`, which is different copy and a different recovery.

**The hosted server is single-tenant until Phase 3, even though the gate knows who the caller is.**
`[Direct]` — the PR #56 commit message (`6ae177a`) states it outright, and
`packages/host/src/tenant.ts:42-47` records why it was not done in the same change: the tenant must
come from `request.session` rather than a client-supplied workspace id, and moving it means moving
102 by-id call sites and the tenancy suite of row T3 with it.

**The `__Host-` prefix, not merely `Secure`.**
`[Supported]` — `packages/host/src/auth/session.ts:18-28` and the matching note in
`packages/host/src/csrf.ts:63-70` give the same reason twice: the prefix is the only cookie attribute
that stops a sibling subdomain or a related host writing the cookie, which is session fixation
rather than mere interception. `packages/host/src/http-adapter.test.ts:1321-1341` pins the
consequence — the hosted server keys its session bucket on the prefixed name and ignores the plain
one, because no browser there can set it.

**Phase 2 tracked this work as landed-but-uncommitted before PR #56.**
`[Supported]` — `docs/internal/web-migration-plan.md:111` describes exactly this subsystem, including
migration `0014`, the three exemptions and the assumed grant, under a "Status 2026-09-18: backend
landed, uncommitted; no UI yet" line, and the commit message of `6ae177a` reports the same scope as
committed. The plan's own file-and-line references in the surrounding paragraphs are stale; its
description of the shape is not.

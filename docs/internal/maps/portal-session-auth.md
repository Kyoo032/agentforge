# Map — Portal browser session (hosted server)

Last verified: 2026-09-23 at d4561b8 + working tree, in two passes the same day. The first: the
gate's portal re-check, digest session ids, refresh-first sign-out. The second: the refresh token
kept sealed at rest so a restart signs nobody out, and every refresh authenticated as the
confidential client. The sections those passes changed — the session gate, Verify / slide / expire,
the portal re-check, Refresh, Sign out, The table, the refresh token at rest, the reason vocabulary,
the assumed-contract table, Where things live, Gotchas, Verify and Why — were rewritten against the
code after the second pass and their citations re-anchored. Everything else keeps its 2026-09-21
reading at 4938747: grep for the identifier before trusting a line number there.

## Overview

The server-side half of signing in to the hosted deployment: five `/api/v1/auth/*` routes, an opaque
cookie, a SQLite row per session, and a gate in the router that refuses every other `/api` call
without one. Four of them landed in PR #56 (`6ae177a`); the fifth, `GET /api/v1/auth/start`, and the
`state` binding on login are Phase 9 lane F (2026-09-21, section below). It runs **only** when
`AGENTFORGE_SERVER` is `1`
(`packages/core/src/server-mode.ts:12-15`, read per request at `packages/host/src/router.ts:434`), so
the desktop IPC path and webdev never mint, read or require a session.

It is a backend. There is no sign-in screen — see **Not built** below. The verified session rides on
`request.session` for Phase 3, but `getTenant()` does not read it yet, so the hosted server is
single-tenant until Phase 3 lands (`packages/host/src/tenant.ts:42-47`).

## How it works

### Sign in — `POST /api/v1/auth/login`

Routed at `packages/host/src/router.ts:245` to `handleLogin`
(`packages/host/src/auth/routes.ts:261-307`).

1. `readCode` demands a non-empty string `code` in the JSON body, and since lane F `readState`
   demands a `state` that matches the cookie. Either failing is `invalid_request` at 400 — the
   portal is never called. See the lane F section below for both.
2. `portal.exchangeCode` posts
   `{ grant_type: "authorization_code", code, redirect_uri, client_id, client_secret }` to
   `{AGENTFORGE_PORTAL_URL}/auth/token` (`packages/host/src/auth/portal-client.ts:278-288`). The
   base URL comes from the environment only,
   trailing slashes stripped, and is put through the same endpoint validator as every other outbound
   URL — which refuses plain HTTP off loopback and any URL carrying credentials
   (`packages/host/src/auth/portal-client.ts:85-92`, `packages/core/src/security/tls.ts:9-32`). It
   **throws** when the variable is absent, which is why every portal dependency in this module is
   constructed lazily (`packages/host/src/auth/index.ts:64-76`).
3. `toTokens` (`packages/host/src/auth/portal-client.ts:200-224`) requires `access_token`,
   `refresh_token`, `session_id`, `user_id`, `org_id` and `tenant_id`. A 200 missing any of them is
   `portal_unavailable` at 502: the portal misbehaving, not the user's fault.
4. `createSession` (`packages/host/src/auth/session.ts:129`) mints 32 random bytes as base64url
   and stamps `createdAt = lastSeenAt = now`, `expiresAt = now + 12 h`,
   `absoluteExpiresAt = now + 30 days`, `revokedAt = null` and, since 2026-09-23,
   `portalCheckedAt = now`: signing in is the portal vouching, so the first re-check is ten minutes
   out.
5. The row goes to the store under the SHA-256 of the id, never the id itself (migration 0021), in
   the same insert as the refresh token and `device_id` sealed for it (see **The refresh token at
   rest**); the portal's access and refresh tokens and `device_id` also go to the in-memory vault
   keyed by session id. The access token is never written anywhere.
6. The answer is `sessionSummary` — `{ signedIn: true, userId, orgId, tenantId, expiresAt }`, with no
   token in it (`packages/host/src/auth/session.ts:152-160`) — plus the session cookie
   (`packages/host/src/auth/routes.ts:306`).

**Failure mode.** A portal refusal arrives as a `PortalError` and is converted by `fromPortal` into
the host's `ApiError`, keeping the portal's reason code, its HTTP status and its `message_en`
(`packages/host/src/auth/routes.ts:111-124`, `packages/host/src/auth/routes.ts:107-109`). Every handler
is wrapped in `guarded` (`packages/host/src/auth/routes.ts:230-240`), so that leaves as the standard
`{ error: { code, message } }` envelope with the reason as the code
(`packages/host/src/errors.ts:17-32`). No token ever reaches a message: `PortalError` composes its own
text from the reason alone (`packages/host/src/auth/portal-client.ts:72-73`), and a `fetch` rejection
is swallowed without attaching the cause, because that cause can carry the request body
(`packages/host/src/auth/portal-client.ts:183-187`).

### Every other call — the session gate

`dispatch` upper-cases the method and strips trailing slashes once
(`packages/host/src/router.ts:430-431`), resolves server mode **per request** rather than at import
(`packages/host/src/router.ts:432-434`), and runs the gate only in server mode
(`packages/host/src/router.ts:436-442`).

`gate` (`packages/host/src/router.ts:399-427`) lets a path through untouched when it is not under
`/api/` (`packages/host/src/router.ts:375`, `packages/host/src/router.ts:405`) or when
`isSessionExemptPath` says so. That function
(`packages/host/src/auth/routes.ts:132-141`) exempts exactly three things:

| Exempt | Why |
|---|---|
| anything under `/api/v1/auth/`, **any** method | nobody has a session yet (`packages/host/src/auth/routes.ts:39`) |
| `GET /api/v1/ping` | the health probe the proxy polls (`packages/host/src/auth/routes.ts:45`) |
| `GET /api/v1/components` | the first-run installer's status read (`packages/host/src/auth/routes.ts:45`) |

Nothing else, for any method. A read is not safe here — a GET returns settings, threads, artifact
bytes and event streams — so the method alone never exempts anything, and the same path with a
different method is a different answer: `GET /api/v1/components` is exempt while
`POST /api/v1/components/install/stream` is not (`packages/host/src/auth/routes.ts:126-141`).

Everything else calls `requireSessionFor` (`packages/host/src/auth/routes.ts:228`), which throws
`authError(reason, 401)` on any bad verdict. That 401 is produced **before the route table is
consulted** (`gate`, `packages/host/src/router.ts:456`), so an unauthenticated caller cannot learn
which paths exist: an unknown path and a real one both answer `401 session_required`.

**The row is not the whole answer since 2026-09-23.** The router hands `requireSessionFor` the
process-wide portal check (`portalCheck: options.portalCheck ?? hostPortalCheck()`,
`packages/host/src/router.ts:469`), and a session whose `portalCheckedAt` is ten minutes old or more
is checked with the portal before the request goes on — see **The portal re-check** below. A
terminal answer is a 401 with the portal's own reason (`device_revoked`, `org_past_due`, …), which
the renderer's 401 signal already reads as "this session is over".

On success the four identifiers are attached to the request as `request.session`
(`packages/host/src/types.ts:32-37`). `dispatch` destructures any `session` the caller supplied off
the request first and re-adds only the gate's own, so an invented session can never reach a
handler as identity, and the caller's request object is never written to. The same scope that
carries the session also carries the person's locale (`withRequestLocale`,
`packages/host/src/router.ts:535`), so `localeForRun()` answers in that person's language in every
mode — see [`locale-boot-and-run-harness.md`](locale-boot-and-run-harness.md).

### Verify, slide, expire

`loadSession` (`packages/host/src/auth/routes.ts:180-195`) reads the cookie, looks the row up and
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

A slide re-opens the 12 h idle window but is clamped to the absolute expiry (`slidSession`,
`packages/host/src/auth/session.ts`), and it is persisted only when it actually happened
(`loadSession`, `packages/host/src/auth/routes.ts:194`), so a busy tab does not write a row per
request.

### The portal re-check (2026-09-23)

`packages/host/src/auth/portal-check.ts`. Before it, the gate trusted the host's own row for up to
12 h idle and 30 days absolute and nothing called the portal after sign-in, so a session the portal
revoked, a user it disabled or an organisation that fell past due kept working here. The portal
has no status call the host can make with what it holds, but a refresh runs the same login checks
and refuses with the reason, so the check **is** a refresh-token rotation.

- **When.** `portalCheckDue` (`packages/host/src/auth/session.ts:147`): `portalCheckedAt` null, or
  `PORTAL_CHECK_INTERVAL_MS` (ten minutes, `:23`) or older. Sign-in stamps it (`createSession`,
  `:129`), so the first check is ten minutes after sign-in.
- **How long a request waits.** `gate` (`packages/host/src/auth/portal-check.ts:376`) waits at most
  `PORTAL_CHECK_WAIT_MS` (2 s, `:60`) and then lets the request through. The portal call itself
  keeps the client's 5 s budget and its answer is applied when it comes: dropping a rotated token
  would make the next check a replay, which the portal reads as theft.
- **What it presents.** `heldTokens` (`:254`): the vault's tokens, or — the first check after a
  restart, when the vault is empty — the refresh token sealed on the row, opened and put back in the
  vault with no access token until this rotation lands (see **The refresh token at rest**). Every
  refresh carries the deployment's confidential client when both `AGENTFORGE_PORTAL_CLIENT_ID` and
  `AGENTFORGE_PORTAL_CLIENT_SECRET` are set (`clientCredentials`, `:201`): the portal then counts
  it against the client, 20,000 per 10 minutes, instead of against the host's one address.
- **Rotated** → the pair goes to the vault exactly as sign-in puts it there (the device id held is
  kept when an answer omits one), and `recordRotation` writes the new sealed refresh token and the
  `portalCheckedAt` stamp in one `UPDATE` (`run`, `:286`; `sealRotated`, `:277`). A token that
  cannot be sealed clears the stored one rather than leave the spent token behind.
- **Terminal** — `TERMINAL_PORTAL_REASONS` (`:77`): `tenant_inactive`, `org_inactive`,
  `org_past_due`, `user_inactive`, `seat_cap_reached`, `device_revoked`, `session_revoked`,
  `refresh_reused`, `refresh_expired`, `invalid_grant` → the session is revoked here, its tokens
  dropped (the stored one in the same write as the revocation), and the request answered 401 with
  the portal's reason and `message_en` (`end`, `:238`). One that lands after the request stopped
  waiting still ends the session, so the next request is refused.
- **No answer** — `portal_unavailable`; `invalid_request`, which is what the portal narrows a
  rate-limited `/auth/token` to at 429; and `invalid_client`, the portal refusing this
  deployment's own client id or secret (mapped to `portal_unavailable`, logged as
  `portal_client_rejected`) → the session stands, and that session is not asked again for
  `PORTAL_CHECK_RETRY_MS` (60 s, `:62`) or the portal's `retry_after`, whichever is longer (capped
  at 15 min). Neither an outage nor a misconfigured secret signs anybody out.
- **Nothing usable to present** — no token in the vault and none sealed on the row, or a sealed one
  that does not open under this wrap key (changed without the rotation drill) → the session ends as
  `refresh_expired`, the answer `POST /auth/refresh` has always given. A wrap key that cannot be
  read at all is the deployment's fault, not the session's: that is no answer, and the session
  stands.
- **One refresh at a time per session, whoever asks** (`refresh`, `:355`). The portal answers a
  spent token presented twice by revoking the whole chain (`rotate_refresh_token`,
  `docs/internal/portal/migrations/0005_functions.sql`), so the gate, `/auth/refresh` and sign-out
  share one in-flight promise per session id, through one process-wide instance
  (`hostPortalCheck`, `packages/host/src/auth/index.ts:216`).

No verdict, log line or error carries a token or the client secret. The log lines are
`portal_session_ended` (reason code, tenant id, and `cause: no_tokens | unreadable` when that is
why), `portal_check_unanswered`, `portal_client_rejected`, `portal_check_slow`,
`portal_check_not_recorded` and `session_refresh_not_sealed`. A storage failure is logged by name
and SQLite code only (`faultOf`, `:170`), because a failed drizzle query puts its bound parameters —
a sealed token among them — in its own message.

### Refresh — `POST /api/v1/auth/refresh`

`handleRefresh` (`packages/host/src/auth/routes.ts:584`) needs a verified row
(`verifiedSession`, `:224` — deliberately not `requireSessionFor`, whose check would rotate once and
this route again), then goes through the same single-flight `check.refresh`, which also applies the
answer — including after a restart, from the token sealed on the row. The handler only reports it:

- **Nothing usable to present** — `refresh_expired` at 401, the session already ended by the check.
- **Terminal** — the error envelope with the portal's reason and status, plus the cleared cookie.
- **No answer** — the portal's error is thrown and the session *survives*: `portal_unavailable` at
  503, or `invalid_request` at 429 for a rate-limited portal (it used to end the session).
- **Rotated** — a slid session is saved and the cookie re-issued with a fresh `Max-Age`.

The wire: `{ grant_type: "refresh_token", refresh_token, device_id?, client_id?, client_secret? }`
(`packages/host/src/auth/portal-client.ts:337`). `device_id` is omitted when the session has none —
the stand-in portal now refuses that as `invalid_request`, and every browser session has one. The
client pair is sent both or neither (`PortalRefreshInput`, `:87`), read by `configuredClientCredentials`
(`packages/host/src/auth/portal-config.ts:130`) from the same two variables the code exchange uses,
which answers null rather than refusing where they are not set.

### Sign out — `POST /api/v1/auth/logout`

`handleLogout` (`packages/host/src/auth/routes.ts:554`) is idempotent at both ends. An absent or
stale cookie still returns 200 `{ signedIn: false }` with the cleared cookie and never calls the
portal. With a row, `endPortalSession` (`:409`) **refreshes first**, through the gate's own
single-flight path, and signs out at the portal with the access token that comes back. It used to
present the token the vault held, which lives an hour: after an idle afternoon the portal answered
401, the client swallowed it, and the portal session and its refresh token outlived the sign-out.

- rotated → `POST /auth/logout` with the live token — after a restart too, since the refresh opens
  the token sealed on the row;
- a terminal refresh answer, or no token in the vault or on the row → no portal call: there is no
  portal session left to end;
- no answer → the access token held in memory is tried anyway, since it may still be inside its
  hour; after a restart there is none, and nothing is sent.

The client's `logout` now **rejects** on any non-2xx answer (`packages/host/src/auth/portal-client.ts:347`)
instead of resolving, and the route logs `portal_logout_failed` with the reason code only. The local
wipe runs in a `finally` whatever happened: `endSession` saves a revoked copy — which wipes the
stored refresh token in the same write — and deletes the vault entry. Re-revoking keeps the
**first** revocation time, so an audit reads the moment the session actually died
(`revokedSession`, `packages/host/src/auth/session.ts`), and the store keeps it too: `save` never
clears a revocation (see **The table**).

### Status — `GET /api/v1/auth/session`

`handleSession` (`packages/host/src/auth/routes.ts:428-435`) always answers 200. A live session
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
(`packages/host/src/auth/routes.ts:215-225`). `maxAge` tracks the **absolute** expiry in whole
seconds, floored and never negative (`packages/host/src/auth/session.ts:169-171`) — the 12 h idle
timeout is enforced server-side only. `Lax` rather than `Strict` because sign-in returns through a
top-level navigation from the portal (`packages/host/src/auth/session.ts:162-168`). Clearing uses the
same attributes with `maxAge: 0` (`packages/host/src/auth/routes.ts:207-219`).

The adapter serialises it once, and is the only place any cookie of this app becomes a header:
`Path`, then `Max-Age` when set, then `SameSite` (defaulting to `Strict`), then `HttpOnly` unless
explicitly false, then `Secure` when set — and never a `Domain`, which `__Host-` also requires
(`packages/host/src/http-adapter.ts:210-219`).

### How it relates to the CSRF cookie and `WORKSPACE_COOKIE`

Three cookies, one serialiser, one origin:

| Cookie | Name(s) | Attributes | Set by |
|---|---|---|---|
| session | `__Host-agentforge_session` / `agentforge_session` (`packages/host/src/auth/session.ts:29-30`) | `HttpOnly; SameSite=Lax; Path=/; Secure` on the server | the auth routes (`packages/host/src/auth/routes.ts:192-205`) |
| CSRF | `__Host-agentforge_csrf` / `agentforge_csrf` (`packages/host/src/csrf.ts:23`, `packages/host/src/csrf.ts:26`) | `Path=/; SameSite=Lax; Secure` on the server — deliberately **not** `HttpOnly` (`packages/host/src/csrf.ts:133-136`) | the adapter itself, on the first GET that arrives without one, or whose token is bound to a different session (`packages/host/src/http-adapter.ts:555-561`) |
| workspace | `agentforge_workspace` (`packages/core/src/local-owner.ts:14`) | `SameSite=Strict; HttpOnly` by the serialiser's defaults (`packages/host/src/http-adapter.ts:248-249`) | handlers; read back into `request.workspaceId` (`packages/host/src/http-adapter.ts:603`) |

The session cookie and the CSRF cookie make exactly the same `secure`-picks-the-name split, for the
same reason, and neither reads the other's mode. They are otherwise independent controls in series:
the CSRF double-submit check runs **in the adapter**, before dispatch, on every non-safe method
(`packages/host/src/http-adapter.ts:546-551`, `packages/host/src/http-adapter.ts:682-711`), while the
session gate runs inside `dispatch`. **Since Phase 3 lane C the token is bound to the session**: it
is `<salt>.<HMAC(key, sessionId.salt)>` rather than bare randomness
(`mintCsrfTokenFor`, `packages/host/src/csrf.ts:87-90`; `sign`, `:56-58`), so a token minted for one
session is refused when another echoes it — the double-submit pair alone proves same-origin script,
not same-signed-in-person (`packages/host/src/csrf.ts:14-19`). Off server mode there is no session
and the binding is to the empty id, so webdev and the desktop behave exactly as before. The adapter
re-mints on a GET whose cookie does not match the presented session
(`packages/host/src/http-adapter.ts:449-451`).

The adapter forwards the raw `Cookie` header to the host request alongside the jar it parses for
itself (`packages/host/src/http-adapter.ts:481`), which is what `readSessionCookie` reads.

### The table

`auth_sessions`, created by **`packages/db/drizzle/0014_auth_sessions.sql`** and rebuilt by
**`packages/db/drizzle/0021_auth_session_hardening.sql`** (journal entry `when` 1788820000014, last
in `packages/db/drizzle/meta/_journal.json`). Eleven columns since 0021, epoch milliseconds
throughout, and two indexes: `auth_sessions_user_seen_idx` on `(user_id, last_seen_at)` for the
Phase 5 seat counter, and `auth_sessions_expires_idx` on `expires_at`. The drizzle definition is
`authSessions` (`packages/db/src/schema.ts:935` for its last column).

**What 0021 changed.** `id` holds `sha256(cookie id)` in lowercase hex (`hashSessionId`,
`packages/host/src/auth/session.ts:125`), never the cookie value, so a copy of the table — a backup,
a copied data directory — replays no session, and a digest presented as a cookie finds nothing. A
new nullable `portal_checked_at` records when the portal last vouched for the session, and a new
nullable `refresh_sealed` holds the portal refresh token, sealed (see **The refresh token at
rest**). The migration **drops and recreates** the table rather than altering it: every existing
row was keyed by a raw cookie id no lookup can match any more, so every signed-in browser signs in
once after the upgrade, and a rebuild (unlike an `ALTER TABLE ... ADD`) can be replayed on a
database whose journal was rewound past it. Nothing references the table by foreign key.
`refresh_sealed` was folded into 0021 on the day it was written, before 0021 had been committed or
deployed anywhere; a database that ran the earlier draft gets the column from the healer.

The same DDL is mirrored in `ensureAuthSessionTables` (`packages/db/src/ensure-schema.ts:405`,
called at `:243`), because a database baseline-stamped past these migrations has the journal rows
without the table; it adds `portal_checked_at` and `refresh_sealed` to a table that lacks them and
never deletes a row.

`createDrizzleSessionStore` (`packages/host/src/auth/session-store.ts:183`) is the SQLite
implementation of the `SessionStore` interface (`:29`) whose other implementation is an in-memory map
for tests. Both key a row by the digest and hand the presented id back from `find`, which reads
named columns only, so the sealed token never rides out on a `SessionRecord`. Two requests can race
on one session and each writes what it read, so:

- `create(session, refreshSealed?)` inserts the row and its sealed token in one statement.
- `save` writes `last_seen_at`, `expires_at`, `absolute_expires_at` and
  `revoked_at = coalesce(revoked_at, ?)` — it never clears a revocation, and the first revocation
  time stands. A row that is revoked once the write lands keeps no sealed token (`:223`).
- `recordRotation(id, at, refreshSealed)` is the only writer of `portal_checked_at` after sign-in: it
  moves the stamp forward only (`max(coalesce(portal_checked_at, ?), ?)`) and replaces the sealed
  token in the same `UPDATE`, storing nothing on a row revoked meanwhile (`:227`).
- `readRefreshSealed(id)` answers the sealed token of a live, unrevoked row, or null (`:237`).
- `purgeExpired(before)` deletes the rows past their absolute expiry and nulls the sealed token of
  every row that has idled out (`:246`): the row stays to report `refresh_expired`, the token it can
  no longer use does not.

The `@agentforge/db` import is deferred to first use, twice over, because that entry point opens the
SQLite file as an import side effect and neither the desktop nor a unit test that never signs in
should pay for it.

Nothing deletes a row on the request path: sign-out revokes, a slide rewrites, an expiry is only
read. A 15-minute sweep is what keeps the table bounded — `startSessionPurge`
(`packages/host/src/auth/index.ts`) fires once at first use and then on an `unref()`'d timer,
logging and retrying a failed sweep rather than taking the process down. It is wired to the
process-wide store (`hostSessionStore`, `packages/host/src/auth/index.ts:177`).

### The refresh token at rest (2026-09-23)

Owner decision: a restart or a deploy signs nobody out. Until this, the portal's refresh and access
tokens lived in process memory only, so a restart emptied the vault and every session ended at its
next portal check. Now the refresh token is also kept on the row, sealed; the access token still is
not, and never is (it lives an hour, and a cold start simply refreshes).

- **The key** is not the wrap key but one derived from it for this purpose alone:
  HKDF-SHA256(wrap key, empty salt, info `auth-session-refresh-v1`, 32 bytes) — `refreshSealingKey`,
  `packages/host/src/auth/session-secrets.ts:52`. That is the shape the device-code design gives the
  desktop's `session.enc` (`HKDF(wrapKey, "session-v1")`,
  `docs/internal/portal/device-code-login.md:447`), with its own label. The wrap key is
  `AGENTFORGE_SECRETS_KEY` through `getLocalVaultKey`, read at each call (`hostSessionSecrets`,
  `packages/host/src/auth/index.ts:199`).
- **The envelope** is the repo's one AES-256-GCM format (`encryptJson`,
  `packages/core/src/crypto/envelope.ts`), holding `{ v: 1, sid, refreshToken, deviceId }`. `sid` is
  the row's id digest, and a blob only opens as that row (`openRefresh`, `:82`), so moving a sealed
  token to another row gets nothing.
- **Written** at sign-in, with the row (`sealForSignIn`, `packages/host/src/auth/routes.ts:385`), and at
  every rotation, with the check stamp. A token that cannot be sealed signs the person in anyway,
  logs `session_refresh_not_sealed` and stores null: that session signs out at the first restart.
- **Read** only on a cold vault (`heldTokens`, `packages/host/src/auth/portal-check.ts:254`). A blob that
  does not open — another wrap key, corruption, a foreign row's blob — ends the session cleanly as
  `refresh_expired`, never a crash; a wrap key that cannot be read at all is no answer instead.
- **Removed** with the session: sign-out and every revocation (`save`), an idled-out session and the
  absolute expiry (`purgeExpired`), and Start over on a desk, which deletes the database file. **The
  hosted per-tenant reset keeps it**, because that reset keeps the tenant's sessions on purpose
  (`packages/db/src/tenant-purge.ts`, `auth_sessions` in the kept bucket; `tenant-reset.ts` step 6
  re-provisions the org so they keep working). A stored token without its session, or a session
  without its token, would be the one inconsistent state. Recorded as an owner question in Gotchas.
- **Rotated with the wrap key.** `rotateWrapKey` (`packages/host/src/wrap-key-rotation.ts:171`)
  re-seals every live session's token in the same two phases as the tenant settings: all opened with
  the old key before anything is written, one that will not open refuses the whole run, each written
  back only if the row still holds the token read in phase one (`sqlSessionTokens`, `:61`), and each
  read back under the new key. `scripts/rotate-wrap-key.ts` reports the count. A session the RUNNING
  app rotates between the drill and the restart is sealed under the old key again and ends at its
  first check afterwards; stopping the app first avoids even that.

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
(`packages/host/src/http-adapter.ts:405`, hashed at `:420`). All three run in the adapter before the Origin, CSRF and
session rules, and before the body is read
(`packages/host/src/http-adapter.ts:420-426`, `packages/host/src/http-adapter.ts:325-348`). A refusal
is 429 `rate_limited` with `Retry-After` in whole seconds, never 0
(`packages/host/src/rate-limit.ts:102-105`, `packages/host/src/http-adapter.ts:303-306`).

### The reason vocabulary

`AUTH_REASONS` is thirteen codes (`packages/host/src/auth/session.ts:52-66`): eleven taken from the
portal doc's own table (`docs/internal/portal/device-code-login.md:407-425`) and two minted here —
`session_required`, the gate's 401, and `portal_unavailable`, which the portal by definition cannot
report about itself (`packages/host/src/auth/session.ts:45-51`). Four rows of the doc's table are
deliberately absent because they belong to the device-code polling loop this deployment does not run:
`device_code_expired`, `device_code_denied`, `authorization_pending` and `slow_down`
(`docs/internal/portal/device-code-login.md:420-423`).

`mapPortalError` (`packages/host/src/auth/portal-client.ts:223`) reduces any refusal to one of
them. `error: "invalid_client"` comes first and is `portal_unavailable` (`:234`): the portal narrows
it to `reason: invalid_grant` for the host, which reads as terminal, but a wrong client secret says
nothing about any session — it is this deployment failing to use the portal. After that a
recognised `reason` wins; a 5xx, a dead socket, or a 4xx whose body carries neither `error` nor
`reason` (`speaksPortalErrors`, `:209`: a proxy's 404 page, a WAF block, a misrouted base path) is
`portal_unavailable`; `invalid_request` in the RFC 6749 `error` slot survives as itself; everything
else is `invalid_grant`. The last two `portal_unavailable` cases used to be `invalid_grant`, which
the portal re-check treats as terminal, so one misrouted URL or one wrong secret would have ended
every session it checked. `PortalError.rfcError` keeps the RFC `error` for the log line
(`:119`). An **unknown** `reason` string is not passed through — `isAuthReason` gates it — so the
host never invents a code, and never forwards one it cannot render.

English fallback copy lives in `REASON_COPY_EN` (`packages/host/src/auth/routes.ts:105-119`) and is
used only when the portal sent no `message_en` — `authError` falls back through `reasonMessage` (`packages/host/src/auth/routes.ts:121-132`). The same
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
| `POST /auth/logout`, Bearer token, `{ all_devices: false }`, idempotent | Matches the doc (`docs/internal/portal/device-code-login.md:228-230`). Since 2026-09-23 the host refreshes first so the token is live, the client rejects on any non-2xx answer, and the route logs the reason and signs out locally regardless. |
| The error body `{ error, reason, message_en, message_id, retry_after }` | Matches the doc (`docs/internal/portal/device-code-login.md:85-94`). `retry_after` is parsed onto `PortalError` (`packages/host/src/auth/portal-client.ts:65`, `packages/host/src/auth/portal-client.ts:117-121`) and then **never read** by any route. |
| The reason codes and their English copy | Matches the doc's table (`docs/internal/portal/device-code-login.md:407-425`). |
| The portal's own `GET /auth/session` (`docs/internal/portal/device-code-login.md:232-234`) | **Not implemented.** `PortalClient` has three methods (`packages/host/src/auth/portal-client.ts:49-56`); the host answers `/api/v1/auth/session` from its own row and never asks the portal for status. |
| The doc's 7-day offline grace (`docs/internal/portal/device-code-login.md:484`) | **Not implemented as a window.** A check or refresh the portal does not answer leaves the session alive with no time limit beyond the session's own 12 h idle / 30 day cap (`packages/host/src/auth/portal-check.ts`). `portal_checked_at` records the last time the portal vouched, but nothing reads it as a grace clock and there is no banner. The grace length is an open owner decision. |
| Refresh rotation on the host's own schedule | **New, 2026-09-23.** The gate rotates once per session per ten minutes of activity, all from the host's one address. Every refresh now authenticates as the confidential client (`client_id` + `client_secret`), and the stand-in portal counts such a refresh against the client — 20,000 per 10 minutes (`postConfidentialRefresh`, `apps/portal/src/routes/tokens.ts`) — instead of the per-IP 300 per 10 minutes it applies otherwise, which sign-in code exchanges still share. A 429 is read as no answer, not a refusal. Verified against the stand-in's source, not yet driven against a running portal. |

### Phase 9 lane F — the first hop, the state binding and the confidential client

Added 2026-09-21. The three things the host half was missing for a **browser** sign-in.

**`GET /api/v1/auth/start`** (`packages/host/src/router.ts:244` → `handleStart`,
`packages/host/src/auth/routes.ts:332`) mints 32 random bytes as base64url
(`mintLoginState`, `packages/host/src/auth/login-state.ts:44`), sets them in a cookie and answers
`{ authorizeUrl }` — one key, nothing else. Hosted only: off server mode it is a `404`, the same
answer the billing webhook gives, so a desk does not learn the route exists elsewhere. Because it
sits under `/api/v1/auth/` it is session-exempt and in the tight auth bucket without either
`isSessionExemptPath` or `AUTH_PATH_PREFIX` naming it.

**The state cookie** is `__Host-agentforge_login_state` on the server and
`agentforge_login_state` off it (`packages/host/src/auth/login-state.ts:30-31`) — the identical
split the session cookie makes, for the identical reason. `HttpOnly; SameSite=Lax; Path=/;
Max-Age=600`, plus `Secure` on the server (`stateCookieFor`,
`packages/host/src/auth/routes.ts:244`). It holds the raw state, not a digest: the cookie is
already unreadable to page script and unsendable cross-site, and an attacker who could read it
could read the session cookie beside it.

**`POST /api/v1/auth/login` now requires `{ code, state }`.** `readState`
(`packages/host/src/auth/routes.ts:282`) compares the body's state against the cookie with
`statesMatch` (`packages/host/src/auth/login-state.ts:86`), which hashes both sides to a fixed 32
bytes and runs `timingSafeEqual` — so the comparison is the same work whatever the inputs, and an
absent state is never a match. A missing, stale or forged state is one `invalid_request` at 400
with **no portal call, no provisioning and no seat claim**, and neither value is echoed back.
The state cookie is cleared on **every** answer this route gives, success or failure, which is why
the clearing cookie is appended outside `guarded` (`packages/host/src/auth/routes.ts:407`): a
thrown `ApiError` becomes an envelope with no cookies at all, and a failure that left the state
behind would leave it replayable. Everything after the check — provision, `claimSeat`,
`seat_cap_reached` at 403, the session cookie — is unchanged.

**The exchange is a confidential client.** `exchangeCode` takes `redirect_uri`, `client_id` and
`client_secret` as **required** arguments (`PortalExchangeInput`,
`packages/host/src/auth/portal-client.ts:154`) and `assertExchangeInput` (`:154-166`) refuses a blank
one in the client itself, so no implementation — including the test double — can make an
unauthenticated exchange. The full wire contract, authorize hop included, is written out at the top
of `packages/host/src/auth/portal-client.ts`; `buildAuthorizeUrl` (`:133`) is the authorize half and
carries no secret, since that hop happens in the browser's address bar.

**Misconfiguration is a 503, never a 500 and never a fall back.**
`packages/host/src/auth/portal-config.ts` resolves the three variables and throws one code,
`login_not_configured` (`:34`), naming the variable at fault. The public base is
`AGENTFORGE_PUBLIC_URL` when set — validated as https, or http on loopback — else
`trustedOrigins(env)[0]`, and the `redirect_uri` is that origin plus `/auth/callback`
(`publicRedirectUri`, `:105`). One function builds it for both `/auth/start` and `/auth/login`,
because the portal compares the two against each other.

### The environment this subsystem reads

| Variable | Read by | Meaning |
|---|---|---|
| `AGENTFORGE_SERVER` | `isServerMode()` (`packages/core/src/server-mode.ts:13`) | Hosted mode: the gate, the `__Host-` names, `/auth/start`. |
| `AGENTFORGE_PORTAL_URL` | `portalBaseUrl` (`packages/host/src/auth/portal-client.ts:117`) | The portal. Throws when absent — hence the lazy client. |
| `AGENTFORGE_PORTAL_CLIENT_ID` | `portalClientCredentials` (`packages/host/src/auth/portal-config.ts:109`) | This app's OAuth client at that portal. |
| `AGENTFORGE_PORTAL_CLIENT_SECRET` | the same | Its secret. Host process only; never logged, never in an error. |
| `AGENTFORGE_PUBLIC_URL` | `publicBaseUrl` (`packages/host/src/auth/portal-config.ts:84`) | The origin the browser reaches this deployment on. Defaults to `trustedOrigins(env)[0]`. |
| `AGENTFORGE_TRUSTED_ORIGINS` | `trustedOrigins` (`packages/core/src/server-mode.ts:52`) | The allowlist, and the default public base. |
| `AGENTFORGE_RATE_AUTH_RPM` | `rateLimitConfig` (`packages/host/src/rate-limit.ts:165`), name at `:32` | The tight auth bucket, 30/10 by default. |

All seven are documented in `webapp-deploy/.env.example`, which is lane H's file, not this one's.

### Not built: there is still no browser sign-in screen

The host half is complete as of lane F; the **renderer** half is lane C and is not in the tree yet.
Stated as a fact, from four reads:

- `apps/web/src/App.tsx:150-175` is the whole route table. There is no `/login`, no `/signin`, no
  `/auth/callback`; the catch-all sends everything unknown to `/chat`.
- `apps/web/src/pages/` contains one file, `chat-page.tsx`.
- Nothing in `apps/web/` references `signedIn`, `session_required` or `/api/v1/auth/` — a grep over
  every `.ts` and `.tsx` in that tree returns no hits, and `apps/web/lib/api-client.ts` has no auth
  call.
- The `auth` namespace is registered and both catalogs are complete
  (`apps/web/lib/i18n.ts:69`), but no component reads a key from it: the only match for `"auth"` in
  the whole app is that registration line.

So `redirect_uri` points at a route that does not exist yet, and nothing calls `/auth/start`. Also
still not built, and named here so nobody assumes otherwise: the **portal service** on the other
end of this contract (lanes A and B), the CSRF re-prime after sign-in (the token is bound to the
session id, `http-adapter.ts:552-561`, so the plan's answer is a full page reload), and any live
exercise of the contract — see **What of the portal contract is assumed, not verified** above,
which lane F extends rather than settles: the authorize hop and the confidential-client exchange
are now written down in one place, but they are still a design agreed between two lanes of this
repo, not a shape a running portal has ever answered.

**Superseded on 2026-09-21 by the section below.** The sign-in screen, `/auth/callback`, the session
provider and the full-reload CSRF re-prime all landed in the same round as that note, and the portal
service exists too ([`portal-service.md`](portal-service.md)). One clause of it is still true and is
the important one: this contract has never been answered by the backend team's real portal at
`api.tokotokenai.com`, only by this repo's stand-in.

## The renderer's half (2026-09-21)

Everything here is `apps/web`, and every line of it is a no-op off a hosted build.

**The boot order is ping → session → settings.** `SessionProvider` wraps the app in
`apps/web/src/App.tsx`, and `bootView(status)` collapses the session state into
`loading | sign-in | app` (`apps/web/lib/session.tsx`). The `/api/v1/settings` fetch is **skipped
entirely** unless `view === "app"`. That guard is the fix for
[SR-06](../security-register.md#sr-06): in server mode that call answers `401 session_required` for a
visitor with no session, the old `.catch` read any failure as `"onboarding"`, and the first screen of
the public deployment therefore asked a stranger to paste a gateway API key. Off a hosted build
`view` is `"app"` as soon as ping answers, so webdev and the packaged Personal app reach settings exactly as
they always did.

**`capabilitiesFrom` is exported for this.** `apps/web/lib/host-capabilities.tsx` had it private; the
session provider reads the same ping payload directly rather than through the context, because a
child provider's effect runs before its parent's — so from inside the tree "sessions: false" and
"ping has not answered" would be the same value and are different facts.

**Three routes are public**, checked as a set rather than routed through a nested `<Routes>`:
`/sign-in`, `/auth/callback`, `/pricing`. A descendant route table under `path="*"` matches on the
*remaining* path, which would silently stop matching these absolute paths. The first two are mounted
only where a sign-in can be completed and redirect to `/chat` otherwise; `/pricing` renders
everywhere, because it imports its catalog ([`tenant-entitlement.md`](tenant-entitlement.md)).

**A signed-out hosted visitor sees the sign-in screen in place**, wherever they aimed, rather than
being redirected to `/sign-in` — so a session that ends mid-use does not rewrite the address bar
under the person.

**`/sign-in`** (`apps/web/components/sign-in-screen.tsx`) is one button, `auth-signin-start`. Two of
its rules are controls rather than polish. `?reason=` selects a key from a fixed list
(`apps/web/lib/auth-reason.ts`) or the generic one, so a visitor's own string is never rendered. And
`safeAuthorizeUrl` refuses anything that is not an absolute `http(s)` URL before `location.assign`
sees it — a 200 from our own host is not permission to navigate wherever its body points.

**`/auth/callback`** (`apps/web/src/pages/auth-callback-page.tsx`) holds four rules. The code leaves
the address bar with `history.replaceState` **before** the exchange, not after. The exchange runs
exactly once per page load, guarded at module scope rather than in a ref, because StrictMode
remounts a component and a module is not re-created — without it the second pass reads a query the
first already stripped, concludes `invalid_request`, and sends a browser that has just signed in back
to the sign-in screen. Success is `window.location.replace("/chat")`, a **full page load**, because
the CSRF token is bound to the session id and the one this page holds was minted for the signed-out
request ([SR-07](../security-register.md#sr-07)) — which is also why there is no `useNavigate` in
that file. And every failure lands on `/sign-in?reason=<code>`.

**A 401 anywhere is a signal, not just an error.** `apiFetch` calls `noteApiResponse`
(`apps/web/lib/session-signal.ts`) on a clone of every HTTP response, so the caller's body is
untouched and nothing happens unless the session provider is listening.

**One hosted-only shell fix belongs to this flow.** `apps/web/vite.config.ts` sets `base: "./"` for
the packaged desktop, and the hosted server answers every non-`/api/` GET with that one shell — so at
`/auth/callback` the shell's own `./assets/index-<hash>.js` resolves to `/auth/assets/…`, which is
not a file, so the SPA fallback answers it with the shell again as `text/html` and the browser
refuses the module. `rootRelativeAssets` (`apps/web/lib/hosted-build.ts`) rewrites those to
root-relative, hosted only, so the packaged shell keeps the bytes it has always had. Without it the
hosted deployment cannot be signed in to at all; `/pricing` and `/sign-in` survive a relative base
only because they happen to be one segment deep.

**Testids:** `auth-signin`, `auth-signin-start`, `auth-reason`, `auth-callback`, `auth-account`,
`auth-signout`. Where to press:
[`features/login.md`](../../../.cursor/skills/verify-agentforge/features/login.md).

**Known and deliberate:** a deep link is lost after sign-in. The `redirect_uri` is fixed at
`/auth/callback` and carries no return path, so the round trip always lands on `/chat`. Recorded as
an owner decision in [`worklog-2026-09-21.md`](../worklog-2026-09-21.md) §6, not as a bug.

## Where things live

| File | Role |
|---|---|
| `packages/host/src/auth/session.ts` | Pure session logic: cookie names, mint, the stored digest (`hashSessionId`), verify, slide, revoke, the portal-check interval (`portalCheckDue`), summary, `Max-Age`, cookie parsing, the reason vocabulary |
| `packages/host/src/auth/session-store.ts` | The `SessionStore` interface (digest keys, a `save` that never un-revokes and wipes a revoked row's token, `recordRotation`, `readRefreshSealed`), the SQLite and in-memory implementations, and the process-memory token vault |
| `packages/host/src/auth/session-secrets.ts` | The refresh token at rest: the HKDF-derived sealing key, seal and open bound to the row's id digest, `createSessionSecrets` |
| `packages/host/src/auth/portal-check.ts` | The gate's portal re-check: single-flight refresh per session, the cold-vault read of the sealed token, the rotation write-back, the bounded wait, terminal vs. unanswered reasons, back-off, the confidential client on every refresh, `faultOf` |
| `packages/host/src/auth/portal-client.ts` | The portal contract in full, authorize hop included: `buildAuthorizeUrl`, exchange, refresh (client-authenticated when given the pair), logout (rejects on a non-2xx), error → reason mapping including `invalid_client`, the test double |
| `packages/host/src/wrap-key-rotation.ts` | The wrap-key drill, which re-seals the session tokens on `auth_sessions` along with the tenant settings |
| `packages/host/src/auth/login-state.ts` | The login-CSRF `state`: its two cookie names, the mint, the reader, the constant-time compare |
| `packages/host/src/auth/portal-config.ts` | The three login environment variables and the one `login_not_configured` refusal; the public base and the `redirect_uri` |
| `packages/host/src/auth/routes.ts` | The five handlers, the exemption predicate, `loadSession` / `verifiedSession` / `requireSessionFor`, the refresh-first sign-out, the cookie shapes, the English fallback copy |
| `packages/host/src/auth/index.ts` | Public surface and the server's composition root: SQLite store, memory vault, one lazy portal client, the one process-wide `hostPortalCheck`, the purge timer, `resetHostAuthForTests` |
| `packages/host/src/router.ts` | The route table (`:244-248` for the auth routes) and the server-mode-only `gate` (`:456`), which passes the portal check; `dispatch` also sets the request's locale beside the session |
| `packages/host/src/http-adapter.ts` | Cookie parsing and serialisation, the CSRF check, the rate-limit call, the raw `Cookie` header forwarded to the host request |
| `packages/host/src/csrf.ts` | The sibling double-submit cookie: same name split, different flags, checked before dispatch |
| `packages/host/src/rate-limit.ts` | The three buckets, including the tight `/api/v1/auth/` one |
| `packages/db/drizzle/0014_auth_sessions.sql` | The migration that creates `auth_sessions` and its two indexes |
| `packages/db/drizzle/0021_auth_session_hardening.sql` | Rebuilds the table empty with `portal_checked_at`: the raw-id rows go, digests from here on |
| `packages/db/src/schema.ts` | The drizzle table (`authSessions`, `:920`) |
| `packages/db/src/ensure-schema.ts` | The mirrored DDL for databases stamped past 0014 / 0021 (`ensureAuthSessionTables`, `:405`) |
| `docs/internal/portal/device-code-login.md` | The portal contract this implements — a design document, not a running service |

## Gotchas

- **Comment citations into `http-adapter.ts` are stale.** `packages/host/src/auth/routes.ts:17` says
  the adapter forwards the raw cookie at `http-adapter.ts:263`; it is at
  `packages/host/src/http-adapter.ts:481`. `packages/host/src/auth/routes.ts:188-189` says the
  attributes are serialised at `http-adapter.ts:138-146`; `serialiseCookie` is at
  `packages/host/src/http-adapter.ts:210-219`, and `packages/host/src/auth/routes.test.ts:383`
  repeats the same stale reference. The behaviour described is right; the line numbers are not. Grep for the identifier, never trust a line number in prose.
- **`DispatchOptions.serverMode` does not pick the cookie name.** The gate passes only `store` and
  `now` into `requireSessionFor` (`packages/host/src/router.ts:458-461`), so `cookieMode` falls back
  to `isServerMode()` (`packages/host/src/auth/routes.ts:152-154`). A test that passes
  `serverMode: true` while `AGENTFORGE_SERVER` is unset is gated but reads the **plain** cookie name
  — which is exactly what `packages/host/src/auth/session-gate.test.ts:205-212` does, deliberately.
  `createAuthRoutes` does inject the flag (`packages/host/src/auth/routes.ts:315-317`), so the four
  routes and the gate can disagree about the name in a mixed setup.
- **A 403 comes before the 401.** An unauthenticated mutating call that carries no CSRF token is
  refused by the adapter with `csrf_missing` at 403 before `dispatch` ever runs
  (`packages/host/src/http-adapter.ts:546-551`). `session_required` is what an unauthenticated *read*
  gets. Do not read a 403 here as "the session gate is broken".
- **`session_revoked` beats `refresh_expired`.** A revoked row that is also past its expiry reports
  `session_revoked` (`packages/host/src/auth/session.ts:126-131`), because the copy differs and the
  user's recovery differs.
- **A restart signs nobody out — with two exceptions.** The vault empties, and each session's next
  due check reads the refresh token sealed on its row instead (see **The refresh token at rest**).
  The exceptions end as `refresh_expired` at that check: a session with no stored token (its token
  could not be sealed, which is logged as `session_refresh_not_sealed`), and every session when
  `AGENTFORGE_SECRETS_KEY` changed without `scripts/rotate-wrap-key.ts`, since no stored token
  opens under the new key.
- **The hosted per-tenant reset keeps the stored tokens — an owner question.** The coordinator's
  brief asked for the reset to delete them too. It keeps `auth_sessions` on purpose ("a reset
  empties an account, it does not sign its people out", `packages/db/src/tenant-purge.ts:124`), and
  `tenant-reset.ts` step 6 re-provisions the org so those sessions keep working. Deleting the token
  alone would be re-written by the next rotation within ten minutes, or would sign the person out at
  the next restart if they were idle; deleting it with the sessions would sign the whole tenant out.
  Neither was done. Signing people out is the portal's job, and since the re-check a portal-side
  revocation reaches this host within ten minutes.
- **The logger drops any field whose name contains `token` or `session`** (`packages/host/src/log.ts`).
  Counts of session tokens are logged under other names (`resealedSignIns`, `changedSignIns` in the
  wrap-key drill); a field called `sessionTokens` arrives as `[dropped]`.
- **The cookie and the row no longer share a value.** Since 0021 `auth_sessions.id` is the SHA-256
  of the cookie's id. To find a browser's row by hand, hash the cookie value first; querying by the
  cookie value finds nothing, by design.
- **An outage never signs anybody out, and neither does a rate limit or a wrong client secret.**
  Only the reasons in `TERMINAL_PORTAL_REASONS` end a session. A 4xx that is not in the portal's
  error shape, and `invalid_client`, map to `portal_unavailable` for that reason. If a
  terminal-looking answer ever comes from something that is not the portal, that mapping is where
  to look. A wrong secret still breaks sign-in outright, and shows up as `portal_client_rejected`
  in the log.
- **Every host refresh reaches the portal from one address, so it authenticates as the client.**
  With both client variables set — which the hosted boot check requires — the portal counts the
  host's refreshes against the client, not the address. Without them (a desk, webdev, a test) the
  refresh goes unauthenticated and shares the per-IP budget with sign-ins.
- **`sessionCookieMaxAge` tracks the absolute expiry, not the idle one.** The browser keeps the
  cookie for up to 30 days while the server may have idled the session out after 12 h
  (`packages/host/src/auth/session.ts:162-171`). A cookie that still exists is not a session that
  still works.
- **Sign-out never deletes a row.** It sets `revokedAt` so the next request can say `session_revoked`
  rather than `session_required` (`packages/db/drizzle/0014_auth_sessions.sql:4-7`). Only the
  15-minute purge removes anything, and only past the absolute expiry (`purgeExpired`,
  `packages/host/src/auth/session-store.ts`). The one exception is migration 0021, once, which
  dropped every raw-id row when ids became digests.
- **`hostSessionStore()` starts a timer as a side effect of first use**
  (`packages/host/src/auth/index.ts:112-118`). A test that touches it must call
  `resetHostAuthForTests()` (`packages/host/src/auth/index.ts:160-167`) or it leaks an interval —
  `unref()`'d, so the process still exits, but the sweep keeps firing.
- **`portalBaseUrl` throws when `AGENTFORGE_PORTAL_URL` is unset**
  (`packages/host/src/auth/portal-client.ts:86-89`). That is correct on a server and wrong
  everywhere else, which is why nothing in this module may be constructed at import time
  (`packages/host/src/auth/index.ts:1-8`). Importing the router must never open the database or read
  the portal URL.
- **`retry_after` sets the portal check's back-off, and nothing else.** `PortalError` carries it and
  the check waits at least that long before asking about that session again (capped at 15 min),
  but no route puts it on the answer; the only `Retry-After` a client sees from this subsystem is
  the rate limiter's (`packages/host/src/http-adapter.ts`).
- **The 401 body is not masked; a 500 is.** `maskServerError` only rewrites status ≥ 500
  (`packages/host/src/http-adapter.ts:356-365`), so the reason code and its copy reach the browser
  intact — which is the whole point of the vocabulary.

## Verify

**Where to press:**
[`features/login.md`](../../../.cursor/skills/verify-agentforge/features/login.md), added
2026-09-21 with the sign-in screen. (This section previously said no feature file drove sign-in,
which was true while there was no screen to press.) That recipe needs the **review instance**, a
seeded tenant and a **real browser** — the suites below cannot prove CSP, `__Host-` cookie
acceptance, `SameSite` or mixed-content blocking, because a non-browser client does not implement
any of them.

What proves the host's half is unit tests. The rows touched by the two 2026-09-23 passes were
**run** after the second, on this Windows desk: `packages/host/src/auth/` 10 files / 362 tests and
`wrap-key-rotation.test.ts` 19 green, the migration suites green (with the drizzle-kit drift check
given 60 s rather than vitest's 5 s default). The other rows were read, not run, at 4938747. The
wrap-key drill itself was also driven by hand once, with `node` and the tsx CLI, against a
throwaway hosted database holding one sealed session token: the dry run reported it, the real run
re-sealed it, the token then opened under the new key and not the old, and a second run with the
old key as `--from` refused with exit 1.

| Test file | Proves |
|---|---|
| `packages/host/src/auth/session.test.ts` | 32-byte base64url ids that never repeat; the stored digest (SHA-256 hex, never the id); the 12 h / 30 day windows; the ten-minute portal-check interval and that sign-in stamps it; the verdict order including revoked-beats-expired; the 5-minute slide and its absolute clamp; `Max-Age` never outliving the absolute expiry; the `__Host-` name split and that each mode ignores the other's cookie; a malformed percent-escape read as no cookie; `AUTH_REASONS` being the portal list plus this phase's additions |
| `packages/host/src/auth/session-store.test.ts` | Both store implementations against one shared suite: round-trip, unknown id, slide persistence, revocation leaving the row findable, a slide never un-revoking, the first revocation time standing, `recordRotation` moving the stamp only forward and writing the sealed token with it, a slide never rewinding the stamp, a digest presented as an id finding nothing, the sealed token kept with the row but never in a record, wiped by a revocation and never brought back by a stale slide, never stored on a row revoked mid-rotation, wiped from an idled-out row by the sweep, and purge by absolute expiry — plus, for SQLite, the digest on disk, only an envelope (never the token) in `refresh_sealed`, and a pre-0021 raw-id row never found |
| `packages/host/src/auth/portal-check.test.ts` | The re-check: nothing asked inside the interval; rotate, keep the pair (and the held device id) and stamp; each of the ten terminal reasons ending the session with the portal's copy; no tokens → `refresh_expired`; unreachable, rate-limited, malformed and unbuildable portals all keeping the session with a 60 s / `retry_after` back-off; one rotation shared by five concurrent requests and by the gate plus a sign-out; a late answer, rotated or terminal, still applied; the host's own storage failing without signing anyone out wrongly — and after a restart: the sealed token opened and refreshed, the rotated one written back sealed with the stamp, a second restart reading the newer token, a token that will not open ending the session cleanly with no portal call, an unreadable wrap key ending nobody, an unsealable rotation clearing the spent token; the confidential client presented on every refresh, left off when none is configured or its source throws, and `invalid_client` keeping every session; storage failures logged by name and SQLite code, never their parameters |
| `packages/host/src/auth/portal-client.test.ts` | `AGENTFORGE_PORTAL_URL` handling including the plain-HTTP refusal; the timeout signal on every call; reason mapping including unknown-reason → `invalid_grant`, 5xx, malformed body, a non-portal 4xx and `invalid_client` → `portal_unavailable`, with the RFC `error` kept as `rfcError`; the refresh grant with and without `device_id`, with `client_id` and `client_secret` both or neither; logout rejecting with the portal's reason, or `portal_unavailable`, on a failed sign-out; the fake recording the client id and never the secret; and that no token or secret reaches the console or an error message |
| `packages/host/src/auth/routes.test.ts` | All five routes end to end against fakes, the exemption table, `requireSessionFor`, the cookie's attributes per mode including the cleared cookie; lane F's additions: `/auth/start`'s cookie-equals-URL binding and its 404 off server mode, the five ways a state is refused with no portal call, the state cleared on success and on failure alike, and the 503 when the client credentials are absent; the 2026-09-23 sign-out: refresh first and log out with the returned token, no portal logout after a terminal refresh, the held token tried when the portal is silent, the local sign-out surviving a refused or throwing portal logout, and one rotation shared with a gate check in flight; and the refresh token at rest: sealed onto the row at sign-in (never the access token), sign-in surviving a token that cannot be sealed, sign-out removing it, and `/auth/refresh` and sign-out both working after a restart from the stored token alone, with `/auth/refresh` and a sign-out's refresh presenting the configured client |
| `packages/host/src/auth/login-state.test.ts` | The mint's width and uniqueness, the `__Host-` name split, an undecodable cookie read as absent, and `statesMatch` refusing an empty, absent or differently-sized pair |
| `packages/host/src/auth/portal-config.test.ts` | The public base: explicit over the trusted origin, normalised to an origin, http allowed on loopback and refused off it, and the named refusal when nothing is configured or a credential is missing; and `configuredClientCredentials` reading the same pair, or null rather than a refusal when either half is missing |
| `packages/host/src/auth/session-gate.test.ts` | The gate itself: off server mode it never runs; on, it 401s a POST, a HEAD and a DELETE alike, 401s before deciding whether the route exists, 401s a malformed cookie rather than 500ing, lets ping / components / the auth routes through, still gates the component install, slides through the gate, reads `isServerMode()` per request, and attaches `request.session` while dropping any the caller invented — and, since 2026-09-23, refuses a due session the portal has ended with its reason before any handler runs, lets a rotated or unanswered one through, ends one with no tokens, and never asks inside the interval or off server mode, and lets a due session through after a restart on the token sealed on its row |
| `packages/host/src/router-locale.test.ts` | Every gated handler runs in the signed-in person's locale, read lazily from the session's tenant and user only, per person under concurrency, English when unreadable; off server mode the boot locale stands |
| `packages/host/src/auth/session-purge.test.ts` | The sweep: once at first use, then every 15 minutes, `unref()`'d, surviving a throwing store, wired into and torn down with the composition root |
| `packages/host/src/auth/session-secrets.test.ts` | The sealing key is HKDF-SHA256 of the wrap key with info `auth-session-refresh-v1`, neither the wrap key nor another purpose's key; seal and open round-trip the token and device id; the stored string is an AES-256-GCM envelope with no token in it and differs every time; it does not open under another wrap key, as another row, or when sealed straight under the wrap key; anything malformed is null, never a throw; and a wrap key that cannot be read surfaces as an error |
| `packages/host/src/wrap-key-rotation.test.ts` | The drill on both stores, and since 2026-09-23 the session tokens on `auth_sessions`: every one re-sealed and none lost, none written on a dry run, NOTHING written — no session and no tenant — when one will not open under the current key, the refusal naming the session by eight characters of its digest and nothing else, a revoked session left alone, a replace only when the row still holds what was read, and the tokens found without injection in server mode |
| `packages/db/src/auth-sessions.test.ts` | The migration: the table is a kernel table, its exact column list (with `portal_checked_at` and `refresh_sealed`) and both index names, `revoked_at` nullable, and that `ensure-schema` re-creates it after a `DROP TABLE` |
| `packages/db/src/migrate-0021.test.ts` | 0021 on a fresh database and on one replayed through 0020: both new columns, nullable, every pre-existing row gone, its own journal row so the drop never runs twice, its `when` above every entry before it, no `ALTER` so it can be replayed, and the healer adding both columns without deleting a row |
| `packages/host/src/rate-limit.test.ts` | `isAuthPath` (including that `/api/v1/authors` is not one) and the auth bucket's arithmetic |
| `packages/host/src/http-adapter.test.ts:1367-1400` | The tight auth bucket end to end: `DEFAULT_AUTH_BURST` requests to `/api/v1/auth/session` then a 429 while the rest of the app still answers; the session bucket keyed on the `__Host-` name across changing IPs; the plain name ignored in server mode; and the refusal logged without the cookie value |

The renderer's half is proved by `apps/web/lib/auth-boot.test.tsx` (17 — the boot order, the public
route set, and that a signed-out hosted visitor never reaches `/api/v1/settings`),
`session.test.tsx` (22), `auth-callback.test.tsx` (15 — the strip-before-exchange order, the
once-per-load guard, the full reload), `sign-in-screen.test.tsx` (15 — including that
`safeAuthorizeUrl` refuses `javascript:`), `auth-reason.test.ts` (10),
`account-session-row.test.tsx` (9), `session-signal.test.ts` (7) and `auth-locales.test.ts` (5). All
green in this worktree on 2026-09-21: 238 tests across the round's 18 web suites.

A live check is two curls — `GET /api/v1/ping` answers 200 with no cookie, `GET /api/v1/settings`
answers `401 session_required` with the same envelope — and then the browser drive in
`features/login.md`, which is the only one that catches a header curl does not enforce.

## Why

**The hosted server gates reads as hard as writes.**
`[Direct]` — `packages/host/src/router.ts:391-398` and
`packages/host/src/auth/routes.ts:126-131` both record the reasoning: a GET returns settings, threads,
artifact bytes and event streams, so "safe method" is not a meaningful category here, and the method
is part of the exemption key rather than an exemption of its own.

**The browser login exchange is an assumption, isolated in one function.**
`[Direct]` — `docs/internal/web-pivot-2026-09-18.md:37` lists the browser login flow as open decision
2, owner Kyo, status open; `docs/internal/portal/device-code-login.md:3-6` says the hosted app needs
a browser-session variant of the device-code flow. `packages/host/src/auth/portal-client.ts:14-23`
states the assumed shape and commits to "if the portal team picks another shape, this one function
changes and nothing else does".

**The refresh token is kept sealed on the session row, and the access token is kept nowhere.**
`[Direct]` — owner decision, 2026-09-23, relayed by the coordinator: store the portal refresh token
encrypted at rest so a host restart or deploy signs nobody out, with AES-256-GCM through
`encryptJson` under a key derived from the wrap key with HKDF info `auth-session-refresh-v1`,
access tokens memory-only, a decrypt failure ending the session cleanly, and the rotation written
back atomically with `portal_checked_at`. It supersedes the Phase 2 choice to keep the refresh
token in process memory only, which was made because the server had no at-rest envelope and a raw
token would have been the one plaintext secret in the schema; that cost — every restart signing
everyone out — is what the decision removed. The column rather than a separate table, and folding
it into the uncommitted 0021, are this implementation's choices (`packages/db/drizzle/0021_auth_session_hardening.sql`).

**Every refresh authenticates as the confidential client.**
`[Direct]` — coordinator request, 2026-09-23: the stand-in portal keys `refresh_token` grants on
`client_id` when `client_id` and `client_secret` verify (20,000 per 10 minutes) and on the address
otherwise (300 per 10 minutes), and the host refreshes every hosted session from one address.
Mapping `invalid_client` to `portal_unavailable` is this implementation's choice, so that a wrong
secret cannot end every session the re-check touches.

**Sign-out revokes instead of deleting.**
`[Direct]` — `packages/db/drizzle/0014_auth_sessions.sql:4-7`: so the next request can answer
`session_revoked` rather than `session_required`, which is different copy and a different recovery.

**The gate re-checks with the portal, through a refresh rotation, every ten minutes.**
`[Direct]` — owner decision, 2026-09-23 auth pass, item 1: portal revocation never reached the host
because the gate read only its own row and `POST /api/v1/auth/refresh` was never called. The
interval, the "end on a terminal reason, keep on timeout or unreachable" rule and the single
in-flight refresh are the owner's terms; the 2 s wait and the 60 s back-off are this
implementation's choices (`packages/host/src/auth/portal-check.ts:48-50`).

**Sign-out refreshes before it signs out at the portal.**
`[Direct]` — the same pass, item 2: the hour-long access token from sign-in was presented at logout,
the portal answered 401, and `portal-client.ts` swallowed it.

**Session ids are stored as digests, and 0021 signed everybody out once.**
`[Direct]` — the same pass, item 3, with the owner's note that existing rows may be invalidated.
The drop-and-recreate shape of 0021 is this implementation's choice, made because a plain `ALTER`
broke the 0017 suite's rewound-journal replay (`packages/db/src/migrate-0017.test.ts`).

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

# Map — Portal service (`apps/portal`)

Last verified: 2026-09-23 at d4561b8 + working tree, by the portal defect pass (request-target
crash, `X-Forwarded-For`, limiter eviction, daily OTP budget, poll limit, refresh `device_id`,
server DB role, per-client refresh bucket). Separately on 2026-09-23, the host auth pass
re-anchored the one citation into `packages/host/src/auth/portal-client.ts` that it moved
(`toTokens`); that pass changed nothing on the portal side.

## Overview

`apps/portal` is the stand-in for the Toko Token AI control plane at `api.tokotokenai.com` — the
service that owns tenants, orgs, users, devices, sessions and seats, and that the hosted DPSBuddy
web app signs in against. It exists so the product has a **real** login to build and review
against before the backend team's service does, and it is wire-compatible with
[`../portal/device-code-login.md`](../portal/device-code-login.md) and
[`../portal/schema.md`](../portal/schema.md).

It is **not** part of the product. It never imports `@agentforge/db`, `@agentforge/host` or
`@agentforge/core`, and nothing in `apps/web`, `packages/host` or `packages/core` imports it —
the product reaches it over HTTP through `AGENTFORGE_PORTAL_URL`, exactly as it will reach the
real one. Its store is its own PostgreSQL under `PORTAL_DATABASE_URL`, never `DATABASE_URL`.

Two neighbouring pages own what this one does not:
[`portal-session-auth.md`](portal-session-auth.md) is the **host's** half of the contract (the
browser session the product mints after redeeming a code), and
[`hosted-security-controls.md`](hosted-security-controls.md) is the product's own perimeter.
This page is the portal side of the wire and nothing else.

## How it works

### 1. The wire contract

Frozen 2026-09-21 and documented from the other side in
`packages/host/src/auth/portal-client.ts:15-48`. Sixteen routes, all static paths, registered
onto the server through `registerPortalRoutes` (`apps/portal/src/routes/index.ts:28`). Two of
them — `GET` and `POST /logout` — are fix pass X's and are **not** part of the frozen host
contract: the host names the URL, the browser follows it, and nothing server-to-server calls it.

| Method | Path | Body in | Body out |
|---|---|---|---|
| GET | `/authorize` | `response_type=code&client_id&redirect_uri&state` | HTML, or `302 {redirect_uri}?code&state` |
| POST | `/authorize/email` | form: `csrf_token`, the four authorize fields, `email` | HTML (always the same page) |
| POST | `/authorize/verify` | the same + `code` | HTML on failure, `302` on success |
| GET | `/activate` | `?code=<user_code>` | HTML |
| POST | `/activate/email` | form: `csrf_token`, `user_code`, `email` | HTML |
| POST | `/activate/verify` | the same + `code` | HTML (the approve screen) |
| POST | `/auth/device/approve` | form **or** JSON: `csrf_token`, `user_code`, `decision` | HTML, or `{status, device_label}` |
| GET | `/logout` | `?client_id&post_logout_redirect_uri` (both optional) | HTML, or `302` to a registered origin — always clears the session cookie |
| POST | `/logout` | form: `csrf_token`, the same two | the same |
| POST | `/auth/device/code` | `{install_id, tenant_hint?, platform?, app_version?, label?}` | `{device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval}` |
| POST | `/auth/device/token` | `{device_code, install_id}` | the token body below |
| POST | `/auth/token` | `{grant_type, …}` — see below | the token body below |
| POST | `/auth/logout` | Bearer + `{all_devices}` | `204`, always |
| GET | `/auth/session` | Bearer | `{user, org, tenant, device, session}` |
| GET | `/tenant/config` | Bearer, or `?tenant=<slug>` | branding (+ flags and allowlist for a Bearer) |
| GET | `/.well-known/jwks.json` | — | `{keys:[{kty,crv,kid,x,use,alg}]}` |

**The token body is read field-by-field by `toTokens`** (`packages/host/src/auth/portal-client.ts:249`):
`access_token, refresh_token, session_id, user_id, org_id, tenant_id` are required and a missing
one makes the host raise `portal_unavailable`; `expires_in`, `refresh_expires_in` and `device_id`
are optional and all three are sent. Built once in `mintSession`
(`apps/portal/src/flows/token.ts:161`), and the exact key set is pinned by
`apps/portal/src/routes/api.test.ts`.

**Every error body** is `{ error, reason, message_en, message_id, retry_after? }`
(`errorBody`, `apps/portal/src/flows/reasons.ts:124`). `error` is the RFC 6749/8628 family,
`reason` is the vocabulary the client branches on, and the copy comes from
`apps/portal/locales/{en,id}/portal.json` — the same keys the HTML pages read, so there is one
table rather than two that drift.

### 2. `/authorize` — validate, then render, then redirect

`getAuthorize` (`apps/portal/src/routes/authorize.ts:99`), in this order and the order is the
security property:

1. per-IP limiter (`limit`, `apps/portal/src/routes/support.ts:193`);
2. `readAuthorizeParams` (`apps/portal/src/flows/authorize.ts:38`) — bounded lengths, nothing
   unbounded reaches a page;
3. `checkClient` (`:65`) — `response_type` must be `code`, `resolve_tenant_for_client` must
   answer, and `oauthClients.allowsRedirect` must match the `redirect_uri` **exactly** against
   that client's registered array;
4. only now does anything render or redirect.

A failure of 2 or 3 renders an error page and **never** writes a `Location`. That is the open
redirect, and here it would be an open redirect carrying an authorization code.

Then: a live portal session cookie for that tenant goes straight to `completeSignIn`
(`apps/portal/src/routes/authorize.ts:263`); otherwise the sign-in form. The two form posts
(`postEmail` `:141`, `postVerify` `:190`) **re-run `checkClient` on the values from their hidden
fields**, because a hidden field is a field the user edits.

`completeSignIn` runs `runBrowserLoginGate` (`apps/portal/src/flows/login.ts:50`) and then either
`redirectWithCode` (`flows/authorize.ts:137`) or, on a denial, `redirectWithError` (`:145`) —
`302 {redirect_uri}?error=<reason>&state=<echo>`, so `seat_cap_reached` lands on the product's own
sign-in screen next to the admin who can free a seat.

### 3. OTP — the same page for every outcome

`sendLoginOtp` (`apps/portal/src/otp/send.ts:78`) reports an outcome for the audit log; the route
renders the identical page for all four of them. Enumeration resistance is three things:

- every path mints a code and hashes it, so the work is the same (`attempt`, `:88`);
- every path takes at least `minimumDurationMs` (150 ms default, `:44`) — a floor, not a
  constant-time implementation, which is the honest claim;
- a `MailDeliveryError` is caught, audited as `otp.send_failed` without the code, and still
  answers the neutral page.

An address that is unknown, that matches users in **more than one** tenant, or that belongs to a
tenant other than the client's, sends nothing. The 3-sends-per-15-minutes limit is not implemented
here at all: it is counted from the `login_otps` rows by `store.loginOtps.send`
(`apps/portal/src/store/postgres/otps.ts:42-47`), so there is one definition of it.

`verifyLoginOtp` (`apps/portal/src/otp/verify.ts:44`) answers `no_code` for an unknown or
wrong-tenant address — the same answer a real address with no live code gets.

**Twenty guesses per address per 24 hours.** Five a code and three codes per 15 minutes allowed
about 1,440 guesses a day at one address, roughly a 0.14% chance a day of hitting a six-digit code.
`store.loginOtps.verify` now sums `attempts` over every row of the address from the last 24 hours,
across both purposes, before anything else. At 20 it answers `locked`, even for the right digits
on a fresh code (`otps.ts:26-27,73-84`). It takes those rows `FOR UPDATE` in a fixed order, so a
guess at the other purpose's live code waits for an uncommitted twentieth and then sees it. The flow
audits a lock as `otp.locked` rather than `otp.failed` (`otp/verify.ts:65`). Both code forms say
"try again in 24 hours" in `en` and `id` (`code.locked`, through `codeErrorMessage`,
`routes/support.ts:93`, which the two verify routes now share). `prune_login_otps()` keeps 24 hours
of rows, which is exactly what keeps this window countable.

### 4. `/auth/token` — two grants

`postToken` (`apps/portal/src/routes/tokens.ts:51`).

**Which rate-limit bucket a call lands in** is decided first, before anything is looked up. A
refresh that carries `client_id` and `client_secret` goes to `postConfidentialRefresh`
(`routes/tokens.ts:105`). It peeks a per-address budget of failed client authentications
(`tokenClientAuthFailIp`, 20 / 10 min) and refuses before any query once that is spent. It then
verifies the client (`authenticateClient`, `flows/token.ts:236`). A wrong secret is
`401 invalid_client`, is audited as `token.client_auth_failed`, and counts against that budget. A
right one counts against the **client** (`tokenClient`, 20,000 / 10 min, keyed on `client_id`) and
never against the address. Everything else (the code grant, and a refresh without client
credentials) counts against the address (`tokenIp`, 300 / 10 min), as before. The reason is the
hosted app: its host refreshes every session about every 10 minutes, all from one address, so the
per-address bucket capped it at roughly 300 active sessions. The host sends both client credentials on
every refresh when they are configured (`packages/host/src/auth/portal-check.ts:300-305`, on the wire at
`packages/host/src/auth/portal-client.ts:337-345`), and the hosted boot check refuses to start without them,
so a hosted refresh lands in `tokenClient`. The refresh token remains the credential for the
refresh itself; the client credentials only choose the bucket, and are not bound to the token.

**`authorization_code`** → `exchangeAuthorizationCode` (`apps/portal/src/flows/token.ts:70`):
resolve the tenant from the code, **verify the client secret first** (so a wrong secret cannot
burn a legitimate user's code), then `authCodes.consume`, which checks client, `redirect_uri`,
single use and the 60-second window; then the login gate; then `mintSession`.

It does **not** check `state`, and it never did. `auth_codes.state_hash` is written for audit and
never compared: the login-CSRF binding on `state` is the host's own `__Host-` cookie comparison
(`packages/host/src/auth/routes.ts`, `readState`), which runs before this endpoint is called. The
dead `state_mismatch` branch that used to sit in `store/postgres/auth-codes.ts` is gone and the
column comment is corrected by `apps/portal/migrations/0009_web_session_revocation.sql` — 0006 is
applied and checksummed, so it is not edited. [SR-43](../security-register.md#sr-43).

**`refresh_token`** → `exchangeRefreshToken` (`:273`): generate the successor, hand both hashes to
`rotate_refresh_token` (`../portal/migrations/0005_functions.sql`), and let the database do
rotation and reuse detection. A spent generation kills the whole chain and the session.

**`device_id` is required, and must be a canonical uuid** (`routes/tokens.ts:37,139`); anything else
is `400 invalid_request` before any lookup, so the token is not spent. `rotate_refresh_token`
compares the device with the session's **only when one is passed**, so a refresh without it used to
skip the device binding entirely: a lifted token refreshed from anywhere. A non-uuid value used to
reach the `::uuid` cast and come back as a 500. The host always sends it:
`packages/host/src/auth/portal-check.ts:303` presents the `device_id` held from the portal's own
token body, which `mintSession` and `exchangeRefreshToken` always include, and keeps it across
rotations (`:311`). The wire's one conditional, `...(deviceId ? { device_id } : {})` in
`portal-client.ts:343`, is empty only if the portal had stopped sending the field. A session
held without one now fails closed with `invalid_request`.

### 5. Access tokens and JWKS

`keyFromSeed` (`apps/portal/src/jwt/keys.ts:62`) builds an Ed25519 key from a 32-byte seed with
`node:crypto` only — a PKCS#8 prefix and the last 32 bytes of the SPKI export, no new dependency.
`kid` is derived from the public key, so it is stable across restarts of the same key.

`resolveKeyring` (`:92`) takes `PORTAL_SIGNING_KEY` when it is set; in development it mints an
ephemeral key and writes a `portal_signing_key_ephemeral` warning naming only the `kid`; in
production with no key it **throws before anything listens** (`apps/portal/src/main.ts:27`).

`signAccessToken` (`apps/portal/src/jwt/sign.ts:53`) writes exactly the claims the login doc
freezes — `iss sub tid oid did sid scope iat exp`, one hour. `did` is `devices.id`, never the
client-minted `install_id`. `verifyAccessToken` (`:102`) checks the algorithm **before** the key
lookup (so `alg: none` cannot reach a path that treats an empty signature as a match), then the
signature, then `iss`, then `exp` with ±120 s of skew.

`publishedJwks` (`jwt/keys.ts:125`) serves the in-process keyring, `Cache-Control: public,
max-age=3600`.

### 6. Security controls, and where each one is

| Control | Where | What pins it |
|---|---|---|
| redirect allowlist, exact match | `checkClient`, `flows/authorize.ts:65` | `routes/browser.test.ts` "renders an error page for a redirect_uri outside the client's allowlist" |
| client authentication before the code is consumed | `flows/token.ts:82-100` | `routes/api.test.ts` "refuses a wrong client secret without burning the code" |
| authorization code: 60 s, single use, bound to client + redirect_uri | `migrations/0006_browser_login.sql`, `store/postgres/auth-codes.ts:53` | `routes/api.test.ts` "refuses a replayed code and audits it" |
| refresh rotation + reuse detection | `rotate_refresh_token`, called at `flows/token.ts:279` | `routes/api.test.ts` "kills the whole chain when a spent generation is presented again" |
| refresh requires a `device_id` shaped like `devices.id`, so the device binding in `rotate_refresh_token` always runs; anything else is `400 invalid_request` before any lookup | `routes/tokens.ts:37,139` | `routes/api.test.ts` "refuses a refresh with no device_id, in the invalid_request shape, without spending the token", "refuses a device_id that is not a devices.id, rather than failing inside the database" |
| OTP: 6 digits, 10 min, 5 attempts, single use | `store/postgres/otps.ts` | `routes/browser.test.ts` "counts down the five attempts and refuses the sixth" |
| OTP: 3 sends / 15 min per address | `store/postgres/otps.ts:42-47` | `routes/browser.test.ts` "stops after three sends inside the window" |
| OTP: 20 guesses / 24 h per address, across every code and both purposes; the 21st is refused as `locked` even with the right digits, audited as `otp.locked`, and the page says to wait 24 h in `en` and `id` | `store/postgres/otps.ts:26-27,73-84`, `otp/verify.ts:65`, `codeErrorMessage` in `routes/support.ts:93` | `store/postgres/otps.test.ts` "the daily guess budget" (5 cases, one of them an uncommitted twentieth guess racing the other purpose's code), `routes/browser.test.ts` "refuses even the right code once twenty guesses were spent today, says why in both languages, and audits otp.locked" |
| enumeration resistance (unknown / ambiguous address) | `otp/send.ts:88-101` | `routes/browser.test.ts` "renders the identical page for an unknown address" |
| device code 5 / 10 min per install, 30 / 10 min per IP; approve 10 / 10 min per user; the poll (`/auth/device/token`) 600 / 10 min per IP, never under the 120 one device makes | `createPortalLimiters`, `security/rate-limit.ts:192`; the poll's check at `routes/tokens.ts:186` | `security/security.test.ts` "rate limiting", `routes/api.test.ts` "limits POST /auth/device/token per IP, at 600 per 10 minutes, and never trips one polling device" |
| `/auth/token`: a refresh from a confidential client whose secret verified counts against its `client_id` (20,000 / 10 min), never the address; failed client authentications have a per-address budget (20 / 10 min) that is peeked before any lookup; every public grant keeps 300 / 10 min per address | `postConfidentialRefresh`, `routes/tokens.ts:105-125`; `authenticateClient`, `flows/token.ts:236`; `tokenClient` / `tokenClientAuthFailIp`, `security/rate-limit.ts:200-201` | `routes/api.test.ts` "counts an authenticated client's refreshes against the client, never the address, and keeps 300 for public ones", "keys the confidential bucket on client_id, whichever address the refresh comes from", "answers 429 once a client has spent its 20,000 refreshes in the window", "refuses a wrong client_secret as invalid_client, audits it, and stops looking after 20 from one address"; `security/security.test.ts` "gives a confidential client 20,000 refreshes per 10 minutes, keyed on its client_id" |
| a limiter whose 20,000-key map is full evicts its oldest 1% of windows; it no longer refuses every new key, which let a flood of addresses lock everyone out | `makeRoom`, `security/rate-limit.ts:66-80` | `security/security.test.ts` "keeps a flood of new keys from locking a new caller out", "evicts the window that started first, even when an older key restarted its window later" |
| `slow_down` on the third poll in one interval | `store/postgres/device-codes.ts:141-221` | `routes/api.test.ts` "answers slow_down on the third poll" |
| CSRF on every portal form | `ensureCsrf` / `csrfOk`, `routes/support.ts:160,175` + `security/csrf.ts:22` | `routes/browser.test.ts` "refuses a post with no CSRF token" |
| `__Host-` cookies, or the unprefixed name only on loopback dev | `cookieNames`, `security/cookies.ts:80` | `security/security.test.ts` "cookie names and the `__Host-` prefix" |
| CSP with `script-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'` | `contentSecurityPolicy` / `HTML_SECURITY_HEADERS`, `security/headers.ts:76,87` | `routes/browser.test.ts` "carries the page security headers" |
| `form-action` also names the client's origin, but **only** on a page inside an `/authorize` flow whose client already validated. A browser enforces `form-action` across the whole redirect chain, and a successful verify ends on the client's origin ([SR-20](../security-register.md#sr-20)) | `clientFormAction`, `routes/authorize.ts:78` — called only after `checkClient` returns ok | `routes/browser.test.ts` "names the client's origin in form-action on an authorize page, and only there", "keeps form-action at 'self' on a page rendered before the client was validated" |
| what is appended is exactly `new URL(redirect_uri).origin` — never a path, a query, a wildcard, a bare scheme or a CSP keyword | `formActionSource`, `security/headers.ts:56` | `security/security.test.ts` "cannot be used to inject a directive, a header or a wildcard" |
| `Referrer-Policy: no-referrer` on the redirect that carries the code | `redirectResponse`, `security/headers.ts:133` | `security/security.test.ts` "keeps no-referrer on the redirect" |
| JSON body cap of 8 KB under the server's 64 KB | `parseJsonBody`, `security/body.ts:22` | `security/security.test.ts` "refuses a body over the endpoint's own cap" |
| constant-time comparisons | `crypto.ts` `hashEquals`, `security/csrf.ts:22`, `security/web-session.ts:96` | `security/security.test.ts` "CSRF double submit" |
| `X-Forwarded-For` only behind `PORTAL_TRUST_PROXY=1`, and then only its **right-most** entry, the one the proxy wrote. A last hop that is not an address falls back to the socket, never to an entry further left, since those are the client's | `clientIp`, `security/client-ip.ts:55-68` | `security/security.test.ts` "client address" (incl. "cannot be steered by a forged prefix"), `routes/api.test.ts` "keys on the address the proxy appended, so a rotated forged prefix does not buy a fresh bucket" |
| one escaping helper, every interpolation escaped | `escapeHtml` / `html`, `views/escape.ts:26,61` | `views/views.test.ts`, four injection payloads on every screen |
| no OTP, code, token or secret in any log | `src/log.ts` sink + the field rules | `routes/{browser,api}.test.ts` "what reached the log" |
| tenant isolation under a real `portal_app` role | `0004_rls.sql`, `0006`, `0008`, `0009` | `security/rls.test.ts` (17 cases) |
| the portal's own browser session is revocable: the cookie carries `ver`, every use compares it against `web_session_versions` inside the tenant scope ([SR-21](../security-register.md#sr-21)) | `versionIsLive`, `flows/web-session.ts:52`, `security/web-session.ts:45,114`, `migrations/0009` | `routes/logout.test.ts` "ends a live cookie when the user's web sessions are revoked server-side" |
| `/logout` clears the cookie on **every** answer, including its refusals | `routes/logout.ts:115,165` | `routes/logout.test.ts` "clears the cookie on every answer, including the one it refuses" |
| `post_logout_redirect_uri` is followed only when its ORIGIN exactly matches a registered `redirect_uri`'s origin | `allowedPostLogoutRedirect`, `routes/logout.ts:55` | `routes/logout.test.ts` "renders the neutral page rather than following a URI off that origin" (7 payloads) |
| `/tenant/config`: per-IP limiter on both branches, and an unknown slug is indistinguishable from a suspended tenant ([SR-42](../security-register.md#sr-42)) | `routes/tokens.ts:247,269-275`, `security/rate-limit.ts:203` | `routes/api.test.ts` "cannot tell an unknown slug from a suspended tenant" |
| mail is never sent in the clear: STARTTLS is **required** off loopback, `ignoreTLS` only for the sandbox, and production refuses a cleartext mail host ([SR-39](../security-register.md#sr-39)) | `config.ts:257-258,268`, `mail/smtp.ts:60` | `config.test.ts` "SMTP transport security", `mail/mail.test.ts` "smtpTransportOptions" |
| `PORTAL_PUBLIC_URL` is an origin, https off loopback, required in production; `PORTAL_TRUST_PROXY` is a validated flag ([SR-33](../security-register.md#sr-33)) | `config.ts:293,347` | `config.test.ts` "PORTAL_PUBLIC_URL and PORTAL_TRUST_PROXY" |
| a registered `redirect_uri` can only be seeded as https, or http on loopback ([SR-40](../security-register.md#sr-40)) | `assertRedirectUri`, `seed/args.ts:78` | `seed/seed.test.ts` "refuses a --redirect that is not https, or http off loopback" |
| a body over the server's 64 KB ceiling is a `413` with the standard error body, not a `500` | `server.ts:88,237` | `server.test.ts` "answers 413 with the standard error body" |
| a request target the URL parser refuses (`GET //x:99999/healthz`) is a `400` with the standard error body. It is parsed against a fixed base inside the handler's try, and the Host header is never read. It used to be parsed against `http://<Host>` outside the try, so `Host: a b` or that target was an unhandled rejection and the process exited | `BAD_TARGET` / `REQUEST_BASE` / `parseTarget`, `server.ts:90-107` | `server.test.ts` "a request whose target or Host header is not a URL" (4 cases, raw socket, whole portal) |
| every request promise ends in a `.catch`, so a failure inside the error path itself (a logger that throws) still answers `500` and never becomes an unhandled rejection | `abandon`, `server.ts:151,251` | `server.test.ts` "contains a failure inside its own error handling, so a request never becomes an unhandled rejection" |
| an unhandled rejection or uncaught exception is written through the portal logger (so it is redacted like every line) and the process then exits 1 for the supervisor to restart it | `installProcessGuards`, `process-guards.ts:42`, installed first thing in `main.ts:15` | `process-guards.test.ts` (6) |
| the server connects as a plain member of `portal_app`; migrations run as the owner on their own connection, closed before anything listens. Production refuses to boot if the server role is superuser, has `BYPASSRLS`, is in `portal_admin`, can `SET ROLE` to a role that is, or is not in `portal_app` | `prepareStore` / `checkServerRole` / `serverRoleProblems`, `boot.ts:144,126,34`; `readConnectionRole`, `store/postgres/roles.ts:43`; `PORTAL_MIGRATE_DATABASE_URL`, `config.ts:188`; `migrations/0010_app_login_role.sql` | `boot.test.ts` (17), `config.test.ts` "PORTAL_MIGRATE_DATABASE_URL", `store/postgres/migrate.test.ts` "creates portal_app_login as 0001 describes it", "puts no password in a migration file" |

### 7. Tests connect as `portal_app_test`, not as a superuser

`createTestStore` (`apps/portal/src/testing/pg.ts:163`) opens the store as `portal_app_test`, a
plain LOGIN role whose only privilege is membership of `portal_app` (`APP_ROLE`, `:86`;
`asAppRole`, `:135`). Migrations still run as the admin, because `0004` re-owns every table to
`portal_admin` and `0007` creates `SECURITY DEFINER` functions.

This matters more than it sounds: a superuser **bypasses row-level security**, so the whole suite
would pass with every policy dropped. `apps/portal/src/security/rls.test.ts` asserts the role is
`NOSUPERUSER NOBYPASSRLS` first, so a future change that quietly restores the superuser connection
fails loudly instead of turning the rest of the file into theatre.

**The server now does the same.** Until 2026-09-23 the suite was the only place the policies held.
The portal migrated and served on one DSN, and `apps/portal/compose.yml` handed that DSN the cluster
superuser. `src/boot.ts` now migrates on `PORTAL_MIGRATE_DATABASE_URL`, closes that connection,
and serves on `PORTAL_DATABASE_URL` as `portal_app_login`, which 0001 describes and
`migrations/0010_app_login_role.sql` creates. It asks `pg_roles` who that is before anything
listens, and a production process refuses to boot as anything that can see past a policy.

## Where things live

| File | Role |
|---|---|
| `apps/portal/src/boot.ts` | migrate as the owner, then open and check the server's connection; production refuses a privileged role |
| `apps/portal/src/process-guards.ts` | the last resort: an unhandled rejection or exception is logged, then exit 1 |
| `apps/portal/src/server.ts` | `node:http` and the route table; a fixed base for every request target, and a `.catch` on every request |
| `apps/portal/src/routes/index.ts` | the route table; `registerPortalRoutes` is the whole surface |
| `apps/portal/src/routes/authorize.ts` | `GET /authorize` and the two browser form posts |
| `apps/portal/src/routes/activate.ts` | `/activate`, its two posts, and `POST /auth/device/approve` |
| `apps/portal/src/routes/tokens.ts` | every JSON endpoint, including `/auth/token` and JWKS |
| `apps/portal/src/routes/logout.ts` | `GET` / `POST /logout` — the way out of the portal's own session |
| `apps/portal/src/routes/support.ts` | per-request context, the four response shapes, CSRF, limiters |
| `apps/portal/src/flows/context.ts` | `PortalRuntime` — mailer, keyring, limiters, issuer, proxy flag |
| `apps/portal/src/flows/authorize.ts` | client + redirect validation, the authorization code, the two redirects |
| `apps/portal/src/flows/token.ts` | both grants and `mintSession`, the one place a session is born |
| `apps/portal/src/flows/device.ts` | the device-code state machine, the platform mapping table |
| `apps/portal/src/flows/session.ts` | Bearer verification, `/auth/session`, logout, `/tenant/config` |
| `apps/portal/src/flows/login.ts` | the browser `devices` row and `login_precheck` |
| `apps/portal/src/flows/web-session.ts` | mint the browser cookie with its version, check it is live, revoke it |
| `apps/portal/src/flows/reasons.ts` | reason → status → RFC family → copy; the host-vocabulary narrowing |
| `apps/portal/src/jwt/keys.ts` | Ed25519 keys, `kid`, the JWKS document |
| `apps/portal/src/jwt/sign.ts` | the access token, and its verification |
| `apps/portal/src/otp/{send,verify}.ts` | the enumeration-resistant send, and the audited verify |
| `apps/portal/src/security/**` | cookies, the web session, CSRF, rate limits, headers, bodies, client IP |
| `apps/portal/src/views/**` | the one escaping helper, the locale catalogs, the five screens |
| `apps/portal/locales/{en,id}/portal.json` | every user-facing string, including the reason table |
| `apps/portal/migrations/0008_oauth_client_scope.sql` | closes the pre-auth window on `oauth_clients` |
| `apps/portal/migrations/0009_web_session_revocation.sql` | `web_session_versions`, and the `state_hash` comment correction |
| `apps/portal/migrations/0010_app_login_role.sql` | `portal_app_login`, the server's role: `LOGIN`, member of `portal_app`, nothing else, no password |
| `apps/portal/src/store/postgres/roles.ts` | who a connection is (`pg_roles`), and the development-only password for `portal_app_login` |
| `apps/portal/src/store/postgres/web-sessions.ts` | the counter: no row means version 1 |
| `apps/portal/src/testing/{pg,server}.ts` | the `portal_app_test` role, and a real portal on an ephemeral port |

## Gotchas

- **One `Set-Cookie` per response, by construction.** `PortalResponse.headers` is
  `Record<string, string>` (`apps/portal/src/server.ts:33`), which another lane owns, so a second
  cookie has nowhere to go. `htmlResponse` / `redirectResponse` take a single `cookie`
  (`security/headers.ts:98-101,133-135`) and every screen needs at most one — the form pages mint
  the CSRF cookie, the redirect after sign-in mints the session cookie, and a CSRF cookie set on the form
  page is still there on the post. If you add a screen that needs two, that constraint is what
  will bite.
- **The browser's "device" is one row per `(user, oauth client)`**, `platform = 'web'`,
  `install_id = "web-client-<client_id>"` (`webInstallId`, `flows/login.ts:26`). `sessions.device_id`
  is NOT NULL and `login_precheck` refuses a user with no live device, so the browser flow needs a
  device row exactly as the desktop one does — and the id has to be derivable at `/auth/token`
  time, where the host holds nothing of the browser. The cost: two browsers of one user share a
  device row, so an admin cannot revoke one without the other. Sessions stay individually
  revocable. Per-browser granularity needs a `device_id` column on `auth_codes`.
- **The portal's own browser session is a signed cookie, not a row** (`security/web-session.ts`) —
  but it is revocable. The cookie carries `ver`, the value of `web_session_versions.version` it was
  minted under, and every use compares it inside the tenant scope (`flows/web-session.ts`). **No
  row means version 1**, so nothing was back-filled; a revocation is one UPSERT and takes effect on
  the next request. What ends a session: `GET`/`POST /logout` clears this browser's cookie, and
  `POST /auth/logout` with `all_devices: true` bumps the counter, which ends every browser that
  user holds. A single-session `/auth/logout` deliberately does not — it would sign somebody out of
  browsers they never touched. Every use still re-runs `login_precheck` as well.
  What this shape does **not** buy is revoking one browser from another, which would need a session
  id in the cookie and a row to match it — the same follow-up `devices` already has (SR-23).
- **A cookie minted before `ver` existed is refused**, not read as version 1. Everyone signed in at
  the moment fix pass X was deployed signs in once more. That is deliberate: the server decides, and
  it cannot decide about a payload shape it does not recognise.
- **`jwks_keys` is not read.** `0004_rls.sql:178` grants `portal_app` **SELECT only** on it, so
  this process cannot publish its own key through the table; `publishedJwks` serves the in-process
  keyring instead. Rotation through `jwks_keys` needs an ops step run as `portal_admin` plus a
  store method that does not exist yet.
- **A cross-tenant device-code approval answers `device_code_expired`, not `tenant_inactive`.**
  `p_device_codes_app` (`0004_rls.sql:57`) hides the other tenant's row from the `SELECT … FOR
  UPDATE`, so the handler never reaches its own tenant-mismatch branch
  (`store/postgres/device-codes.ts:108-110`, unreachable in production). It fails closed, which is
  the stronger behaviour; the doc's reason code is what is wrong.
- **A logout answers `refresh_reused` on the next refresh, not `session_revoked`.**
  `revoke_session_chain` marks the outstanding refresh rows revoked and `rotate_refresh_token`
  treats a revoked row as reuse. Both are terminal and the client clears the session either way,
  but the login doc's reason table implies the other one.
- **`device_code.requested` is not audited for a generic build.** `audit_log.tenant_id` is NOT
  NULL (`0003_billing_and_usage.sql`) and a code minted with no `tenant_hint` has no tenant yet
  (`flows/device.ts:107-120`). Every shipped installer is branded and always audits.
- **Rate limits are per process.** In-memory fixed windows (`security/rate-limit.ts`). One portal
  behind one proxy is the deployment; a second instance halves every limit's effectiveness. A full
  map (20,000 keys) evicts its oldest 1% of windows rather than refusing new keys, so a flood can
  reset a window but cannot lock anybody out. An IPv6 client still gets a fresh key per address,
  and nothing here groups a /64.
- **The right-most `X-Forwarded-For` entry is the client only with exactly one appending proxy.**
  That is Caddy as `webapp-deploy/Caddyfile` runs it, which replaces the header for an untrusted
  peer. A CDN in front of Caddy with `trusted_proxies` set would append its own edge address last,
  and every client would then share the CDN's buckets. `security/client-ip.ts` has to change with
  the proxy chain, exactly as `packages/host/src/rate-limit.ts` does.
- **The daily OTP budget can be spent by someone else.** Anyone who knows an address can make 20
  wrong guesses and lock it out of OTP sign-in for up to 24 hours. That takes four codes, so about
  twenty minutes under the 3-per-15-minute send limit. That is the price of stopping the guessing.
  A live portal session cookie (30 days) still signs that person in without a code, and every lock
  is an `otp.locked` audit row.
- **Outside production the portal writes one role's password.** On every migrate, `src/boot.ts`
  sets `portal_app_login`'s password from `PORTAL_DATABASE_URL`, and only when the DSN names exactly
  that role and the owner's DSN is a different one. That is what lets compose and the review
  instance run the server as the app role with nothing but two DSNs. Production never does it: 0001
  provisions login roles out of band. The statement carries the password in plaintext, so a dev
  Postgres with `log_statement` on would log it.
- **`PORTAL_TRUST_PROXY` and `PORTAL_PUBLIC_URL` are `loadConfig`'s** since fix pass X
  ([SR-33](../security-register.md#sr-33)): `config.publicUrl` and `config.trustProxy`. The public
  URL must be a bare origin — https anywhere, http on loopback only, no path, query, fragment or
  credentials — and is **required in production**. `createRuntime` reads the config, not the
  environment, and `security/client-ip.ts` takes the proxy decision as an argument. A route handler
  still never touches `process.env`.
- **The compose Postgres password has no default.** `${PORTAL_POSTGRES_PASSWORD:?…}` in
  `apps/portal/compose.yml`, so `docker compose up` refuses rather than falling back to a literal
  in git. An **existing** `portal-pgdata` volume keeps the password it was created with —
  `POSTGRES_PASSWORD` is only read by `initdb` — so a dev machine from before this change still
  needs the old one in its DSN. `scripts/review-instance.ps1` no longer seeds the literal `portal`
  ([SR-44](../security-register.md#sr-44)): it keeps whatever `review.env` already holds, generates
  one for a fresh review root, and **stops with an instruction** when the volume exists but
  `review.env` has no password. The test suite is unaffected either way: it runs
  `embedded-postgres`.

## Verify

Counts below were re-run in this worktree on 2026-09-23 after the portal defect pass —
`pnpm --filter @agentforge/portal test`: **25 files, 378 tests, all passed**; `tsc --noEmit` clean.

| Suite | Proves |
|---|---|
| `apps/portal/src/routes/browser.test.ts` (23) | the three browser hops, the neutral page, five attempts, three sends, the daily guess budget over the wire, the seat-cap redirect, no secret in a log |
| `apps/portal/src/routes/api.test.ts` (34) | the exact token key set, replay, wrong secret, redirect mismatch, refresh reuse, refresh without a `device_id`, the full device flow, `slow_down`, the Bearer endpoints, and behind a proxy the right-most `X-Forwarded-For`, the poll limit, and the per-client refresh bucket |
| `apps/portal/src/routes/logout.test.ts` (11) | the way out: the cookie cleared on every answer, the origin-exact `post_logout_redirect_uri`, the CSRF-protected post, the server-side revocation, the audit row |
| `apps/portal/src/security/rls.test.ts` (17) | the connection is a non-superuser `portal_app` member; tenant A reads and writes none of tenant B's `users`, `sessions`, `refresh_tokens`, `login_otps`, `auth_codes`; the pre-auth window |
| `apps/portal/src/security/security.test.ts` (49) | cookie prefixes, the web session, CSRF, rate limits, their eviction and the refresh buckets, client IP from the last hop, headers, body caps, and `form-action` on an authorize page |
| `apps/portal/src/boot.test.ts` (17) | the server role read from `pg_roles` for real roles (superuser, `BYPASSRLS`, `portal_admin` member, stranger); production refuses each; development warns; the app login's password set outside production only, for that role only |
| `apps/portal/src/server.test.ts` (14) and `process-guards.test.ts` (6) | an unparseable request target is a 400 and a bad Host header is ignored, over a raw socket; the error path's own failure is contained; the process-level last resort logs and exits 1 |
| `apps/portal/src/views/views.test.ts` (19) | escaping against four injection payloads on every screen, `en`/`id` key parity, locale negotiation |
| `apps/portal/src/jwt/keys.test.ts` (11) and `sign.test.ts` (10) | key derivation, the claim set, tampering, `alg: none`, skew, the JWKS document |
| `src/{config,log,manual-otp}.test.ts`, `src/{mail/mail,seed/seed,otp/product-name,routes/assets,views/brand}.test.ts` and `src/store/postgres/*.test.ts` | the remaining 167: the aggregated config refusal and the two DSNs, the log sink's credential scrubbing, the manual OTP, SMTP, the seed's once-only secret, the mail product name, the brand mark, and the six store suites (including the daily OTP budget and the 0010 role) |

**Where to press:** [`features/login.md`](../../../.cursor/skills/verify-agentforge/features/login.md),
added 2026-09-21. It is the browser half of this page, and it exists because the suites above cannot
prove the part that matters most: **a non-browser client does not implement CSP at all**, which is
how `form-action 'self'` blocked every human's sign-in while `routes/browser.test.ts` walked the same
three hops green ([SR-20](../security-register.md#sr-20)).

Three live drives are recorded. First, `curl` against the portal on `127.0.0.1:4000` with the compose
Postgres and Mailpit: `/authorize` → e-mail → the code read from Mailpit's HTTP API → the `302` →
`/auth/token`, then the device-code flow, then the negatives (bad `redirect_uri`, unknown client,
replayed code, wrong client secret, sixth OTP attempt, fourth send, refresh reuse). Second, the full
browser sign-in in Chromium on the review instance — the one that caught SR-20.

A third, 2026-09-23, from a harness script against a throwaway `embedded-postgres`, driving the real
`src/main.ts`. First, the unfixed `createPortalServer` exited 1 on `Host: a b` and on
`GET //x:99999/healthz`; the fixed one answered 200 and 400 and kept serving. Then four boots:
production on the superuser DSN exited 2 with the refusal. Production on `portal_app_login`
(password set out of band) served, and `pg_stat_activity` showed only `portal_app_login` sessions,
so the owner's connection had closed. Development on the one superuser DSN booted with
`portal_db_role_bypasses_rls`. Development with two DSNs set the app role's password from
`PORTAL_DATABASE_URL` and booted clean. The review instance itself was not driven.

## Why

- **The portal is a separate app rather than a mode of the host.** `[Direct]`
  `docs/internal/web-phase9-portal-login.md:24` ("New workspace app `apps/portal` … reached
  **only** over HTTP") and `apps/portal/AGENTS.md:11-19`, which states the two import rules.
- **Postgres from day one, with `0001-0005` unchanged.** `[Direct]`
  `docs/internal/web-phase9-portal-login.md:10`, the owner's second-round ruling 2.
- **No password, ever.** `[Direct]` `docs/internal/portal/device-code-login.md:132` gives four
  reasons, the first being that a password database for four whitelabel partners with no shared
  IdP is the worst asset to hold.
- **A signed cookie for the portal's own session rather than a table.** `[Inferred]` No doc states
  it. The store contract (`apps/portal/src/store/types.ts`) has no browser-session table and
  belongs to another lane, so a migration adding one would have had no code path able to write to
  it; the inference is from that boundary plus the re-running of `login_precheck` on every use,
  which is what makes the missing revocation bounded rather than open-ended.
- **A version counter rather than a session table, once revocation had to exist.** `[Inferred]`
  Fix pass X, 2026-09-21. The requirement was "a revoke takes effect on the next request"
  ([SR-21](../security-register.md#sr-21)), which both shapes satisfy. The counter wins on cost: one
  row per user instead of one per sign-in, nothing to prune, and an absent row reading as version 1
  meant no back-fill. What it gives up is revoking one browser without the others — the same
  granularity `devices` already gives up (SR-23), and the same follow-up would buy both.

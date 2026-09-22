# Map — Portal service (`apps/portal`)

Last verified: 2026-09-21 at 4938747 + working tree (fix pass X)

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

**The token body is read field-by-field by `toTokens`** (`packages/host/src/auth/portal-client.ts:200-224`):
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

`getAuthorize` (`apps/portal/src/routes/authorize.ts:92`), in this order and the order is the
security property:

1. per-IP limiter (`limit`, `apps/portal/src/routes/support.ts:164`);
2. `readAuthorizeParams` (`apps/portal/src/flows/authorize.ts:38`) — bounded lengths, nothing
   unbounded reaches a page;
3. `checkClient` (`:65`) — `response_type` must be `code`, `resolve_tenant_for_client` must
   answer, and `oauthClients.allowsRedirect` must match the `redirect_uri` **exactly** against
   that client's registered array;
4. only now does anything render or redirect.

A failure of 2 or 3 renders an error page and **never** writes a `Location`. That is the open
redirect, and here it would be an open redirect carrying an authorization code.

Then: a live portal session cookie for that tenant goes straight to `completeSignIn`
(`apps/portal/src/routes/authorize.ts:253`); otherwise the sign-in form. The two form posts
(`postEmail` `:118`, `postVerify` `:167`) **re-run `checkClient` on the values from their hidden
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
(`apps/portal/src/store/postgres/otps.ts:32-37`), so there is one definition of it.

`verifyLoginOtp` (`apps/portal/src/otp/verify.ts:40`) answers `no_code` for an unknown or
wrong-tenant address — the same answer a real address with no live code gets.

### 4. `/auth/token` — two grants

`postToken` (`apps/portal/src/routes/tokens.ts:41`).

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

**`refresh_token`** → `exchangeRefreshToken` (`:230`): generate the successor, hand both hashes to
`rotate_refresh_token` (`../portal/migrations/0005_functions.sql`), and let the database do
rotation and reuse detection. A spent generation kills the whole chain and the session.

### 5. Access tokens and JWKS

`keyFromSeed` (`apps/portal/src/jwt/keys.ts:62`) builds an Ed25519 key from a 32-byte seed with
`node:crypto` only — a PKCS#8 prefix and the last 32 bytes of the SPKI export, no new dependency.
`kid` is derived from the public key, so it is stable across restarts of the same key.

`resolveKeyring` (`:92`) takes `PORTAL_SIGNING_KEY` when it is set; in development it mints an
ephemeral key and writes a `portal_signing_key_ephemeral` warning naming only the `kid`; in
production with no key it **throws before anything listens** (`apps/portal/src/main.ts:22`).

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
| authorization code: 60 s, single use, bound to client + redirect_uri | `migrations/0006_browser_login.sql`, `store/postgres/auth-codes.ts:46` | `routes/api.test.ts` "refuses a replayed code and audits it" |
| refresh rotation + reuse detection | `rotate_refresh_token`, called at `flows/token.ts:232` | `routes/api.test.ts` "kills the whole chain when a spent generation is presented again" |
| OTP: 6 digits, 10 min, 5 attempts, single use | `store/postgres/otps.ts` | `routes/browser.test.ts` "counts down the five attempts and refuses the sixth" |
| OTP: 3 sends / 15 min per address | `store/postgres/otps.ts:32-37` | `routes/browser.test.ts` "stops after three sends inside the window" |
| enumeration resistance (unknown / ambiguous address) | `otp/send.ts:88-101` | `routes/browser.test.ts` "renders the identical page for an unknown address" |
| device code 5 / 10 min per install, 30 / 10 min per IP; approve 10 / 10 min per user | `createPortalLimiters`, `security/rate-limit.ts:131` | `security/security.test.ts` "rate limiting" |
| `slow_down` on the third poll in one interval | `store/postgres/device-codes.ts:141-221` | `routes/api.test.ts` "answers slow_down on the third poll" |
| CSRF on every portal form | `ensureCsrf` / `csrfOk`, `routes/support.ts:131` + `security/csrf.ts:22` | `routes/browser.test.ts` "refuses a post with no CSRF token" |
| `__Host-` cookies, or the unprefixed name only on loopback dev | `cookieNames`, `security/cookies.ts:39` | `security/security.test.ts` "cookie names and the `__Host-` prefix" |
| CSP with `script-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'` | `contentSecurityPolicy` / `HTML_SECURITY_HEADERS`, `security/headers.ts:76,87` | `routes/browser.test.ts` "carries the page security headers" |
| `form-action` also names the client's origin, but **only** on a page inside an `/authorize` flow whose client already validated. A browser enforces `form-action` across the whole redirect chain, and a successful verify ends on the client's origin ([SR-20](../security-register.md#sr-20)) | `clientFormAction`, `routes/authorize.ts:77` — called only after `checkClient` returns ok | `routes/browser.test.ts` "names the client's origin in form-action on an authorize page, and only there", "keeps form-action at 'self' on a page rendered before the client was validated" |
| what is appended is exactly `new URL(redirect_uri).origin` — never a path, a query, a wildcard, a bare scheme or a CSP keyword | `formActionSource`, `security/headers.ts:56` | `security/security.test.ts` "cannot be used to inject a directive, a header or a wildcard" |
| `Referrer-Policy: no-referrer` on the redirect that carries the code | `redirectResponse`, `security/headers.ts:133` | `security/security.test.ts` "keeps no-referrer on the redirect" |
| JSON body cap of 8 KB under the server's 64 KB | `parseJsonBody`, `security/body.ts:22` | `security/security.test.ts` "refuses a body over the endpoint's own cap" |
| constant-time comparisons | `crypto.ts` `hashEquals`, `security/csrf.ts:22`, `security/web-session.ts:88` | `security/security.test.ts` "CSRF double submit" |
| `X-Forwarded-For` only behind `PORTAL_TRUST_PROXY=1` | `clientIp`, `security/client-ip.ts:48` | `security/security.test.ts` "client address" |
| one escaping helper, every interpolation escaped | `escapeHtml` / `html`, `views/escape.ts:26,61` | `views/views.test.ts`, four injection payloads on every screen |
| no OTP, code, token or secret in any log | `src/log.ts` sink + the field rules | `routes/{browser,api}.test.ts` "what reached the log" |
| tenant isolation under a real `portal_app` role | `0004_rls.sql`, `0006`, `0008`, `0009` | `security/rls.test.ts` (17 cases) |
| the portal's own browser session is revocable: the cookie carries `ver`, every use compares it against `web_session_versions` inside the tenant scope ([SR-21](../security-register.md#sr-21)) | `flows/web-session.ts:55`, `security/web-session.ts:35,107`, `migrations/0009` | `routes/logout.test.ts` "ends a live cookie when the user's web sessions are revoked server-side" |
| `/logout` clears the cookie on **every** answer, including its refusals | `routes/logout.ts:115,165` | `routes/logout.test.ts` "clears the cookie on every answer, including the one it refuses" |
| `post_logout_redirect_uri` is followed only when its ORIGIN exactly matches a registered `redirect_uri`'s origin | `allowedPostLogoutRedirect`, `routes/logout.ts:57` | `routes/logout.test.ts` "renders the neutral page rather than following a URI off that origin" (7 payloads) |
| `/tenant/config`: per-IP limiter on both branches, and an unknown slug is indistinguishable from a suspended tenant ([SR-42](../security-register.md#sr-42)) | `routes/tokens.ts:182,210`, `security/rate-limit.ts:141` | `routes/api.test.ts` "cannot tell an unknown slug from a suspended tenant" |
| mail is never sent in the clear: STARTTLS is **required** off loopback, `ignoreTLS` only for the sandbox, and production refuses a cleartext mail host ([SR-39](../security-register.md#sr-39)) | `config.ts:180-183,196`, `mail/smtp.ts:51` | `config.test.ts` "SMTP transport security", `mail/mail.test.ts` "smtpTransportOptions" |
| `PORTAL_PUBLIC_URL` is an origin, https off loopback, required in production; `PORTAL_TRUST_PROXY` is a validated flag ([SR-33](../security-register.md#sr-33)) | `config.ts:236,283` | `config.test.ts` "PORTAL_PUBLIC_URL and PORTAL_TRUST_PROXY" |
| a registered `redirect_uri` can only be seeded as https, or http on loopback ([SR-40](../security-register.md#sr-40)) | `assertRedirectUri`, `seed/args.ts:58` | `seed/seed.test.ts` "refuses a --redirect that is not https, or http off loopback" |
| a body over the server's 64 KB ceiling is a `413` with the standard error body, not a `500` | `server.ts:81,88` | `server.test.ts` "answers 413 with the standard error body" |

### 7. Tests connect as `portal_app_test`, not as a superuser

`createTestStore` (`apps/portal/src/testing/pg.ts:157`) opens the store as `portal_app_test`, a
plain LOGIN role whose only privilege is membership of `portal_app` (`APP_ROLE`, `:86`;
`asAppRole`, `:122`). Migrations still run as the admin, because `0004` re-owns every table to
`portal_admin` and `0007` creates `SECURITY DEFINER` functions.

This matters more than it sounds: a superuser **bypasses row-level security**, so the whole suite
would pass with every policy dropped. `apps/portal/src/security/rls.test.ts` asserts the role is
`NOSUPERUSER NOBYPASSRLS` first, so a future change that quietly restores the superuser connection
fails loudly instead of turning the rest of the file into theatre.

## Where things live

| File | Role |
|---|---|
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
| `apps/portal/src/store/postgres/web-sessions.ts` | the counter: no row means version 1 |
| `apps/portal/src/testing/{pg,server}.ts` | the `portal_app_test` role, and a real portal on an ephemeral port |

## Gotchas

- **One `Set-Cookie` per response, by construction.** `PortalResponse.headers` is
  `Record<string, string>` (`apps/portal/src/server.ts:32`), which another lane owns, so a second
  cookie has nowhere to go. `htmlResponse` / `redirectResponse` take a single `cookie`
  (`security/headers.ts:51,63`) and every screen needs at most one — the form pages mint the CSRF
  cookie, the redirect after sign-in mints the session cookie, and a CSRF cookie set on the form
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
  behind one proxy is the deployment; a second instance halves every limit's effectiveness.
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

Counts below were re-run in this worktree on 2026-09-21 after fix pass X —
`pnpm --filter @agentforge/portal test`: **23 files, 320 tests, all passed**.

| Suite | Proves |
|---|---|
| `apps/portal/src/routes/browser.test.ts` (22) | the three browser hops, the neutral page, five attempts, three sends, the seat-cap redirect, no secret in a log |
| `apps/portal/src/routes/api.test.ts` (23) | the exact token key set, replay, wrong secret, redirect mismatch, refresh reuse, the full device flow, `slow_down`, the Bearer endpoints |
| `apps/portal/src/routes/logout.test.ts` (13) | the way out: the cookie cleared on every answer, the origin-exact `post_logout_redirect_uri`, the CSRF-protected post, the server-side revocation, the audit row |
| `apps/portal/src/security/rls.test.ts` (17) | the connection is a non-superuser `portal_app` member; tenant A reads and writes none of tenant B's `users`, `sessions`, `refresh_tokens`, `login_otps`, `auth_codes`; the pre-auth window |
| `apps/portal/src/security/security.test.ts` (39) | cookie prefixes, the web session, CSRF, rate limits, client IP, headers, body caps, and `form-action` on an authorize page |
| `apps/portal/src/views/views.test.ts` (19) | escaping against four injection payloads on every screen, `en`/`id` key parity, locale negotiation |
| `apps/portal/src/jwt/keys.test.ts` (11) and `sign.test.ts` (10) | key derivation, the claim set, tampering, `alg: none`, skew, the JWKS document |
| `src/{config,log,server,mail/mail,seed/seed,otp/product-name}.test.ts` and `src/store/postgres/*.test.ts` | the remaining 133: the aggregated config refusal, the log sink's credential scrubbing, the route table, SMTP, the seed's once-only secret, the mail product name, and the four store suites |

**Where to press:** [`features/login.md`](../../../.cursor/skills/verify-agentforge/features/login.md),
added 2026-09-21. It is the browser half of this page, and it exists because the suites above cannot
prove the part that matters most: **a non-browser client does not implement CSP at all**, which is
how `form-action 'self'` blocked every human's sign-in while `routes/browser.test.ts` walked the same
three hops green ([SR-20](../security-register.md#sr-20)).

Two live drives are recorded. First, `curl` against the portal on `127.0.0.1:4000` with the compose
Postgres and Mailpit: `/authorize` → e-mail → the code read from Mailpit's HTTP API → the `302` →
`/auth/token`, then the device-code flow, then the negatives (bad `redirect_uri`, unknown client,
replayed code, wrong client secret, sixth OTP attempt, fourth send, refresh reuse). Second, the full
browser sign-in in Chromium on the review instance — the one that caught SR-20.

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

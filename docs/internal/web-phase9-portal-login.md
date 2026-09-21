# Phase 9: portal login and pricing (plan of record)

Status: in progress, 2026-09-21. Local build for owner review; no PR until the owner approves.

Owner rulings (2026-09-21): build the **real** portal login (not a dev bypass); plans carry **both** a seat cap and a token allowance; every tier name, price and number is a **placeholder** in one config file; the payment provider is undecided, so the provider-neutral webhook (`POST /api/v1/billing/webhook`) stays the integration point.

**Owner rulings, second round (2026-09-21) — these override anything below that disagrees:**

1. The review instance on 4000 / 3100 / 3443 is approved.
2. The portal store is **real Postgres from day one**, running `docs/internal/portal/migrations/0001-0005` unchanged (new tables in `apps/portal/migrations/0006+`). No SQLite stand-in, no "adapt later". `PORTAL_DATABASE_URL` is required. `apps/portal/compose.yml` carries `postgres:16` + `mailpit`; tests use real Postgres (`embedded-postgres`, or `PORTAL_TEST_DATABASE_URL`). Bugs get fixed locally before anything goes to Tencent Cloud.
3. **No token allowance.** Users are not metered against a budget. Tiers leave `allowance_usd_micros` null; the catalog has no `tokenAllowance`, there is no allowance bar, and the usage panel shows seats and plan status only. The `plan_allowance_exhausted` renderer branch stays (the host can still send it) but nothing in the catalog sets one.
4. Mail is **real SMTP against a sandbox** (Mailpit locally) from day one. Until a provider is bound, the owner's team hands codes out manually: `pnpm portal:otp <email>` issues a code (hash stored, audit row `otp.issued_manually`, needs `PORTAL_ALLOW_MANUAL_OTP=1`). No plaintext outbox files.
5. Two plans only, **Personal and Enterprise**, placeholder numbers (pivot decision 8 shape).

## Current state (evidence)

- Session backend is complete and has no client: `packages/host/src/router.ts:240-243` (`/api/v1/auth/{login,logout,session,refresh}`), `packages/host/src/auth/routes.ts`, `auth/session.ts`, `auth/portal-client.ts`. Runs only under `AGENTFORGE_SERVER=1`.
- Host → portal contract (`auth/portal-client.ts`): base `AGENTFORGE_PORTAL_URL` (http allowed on loopback, `packages/core/src/security/tls.ts:25-31`); `POST {base}/auth/token` with `grant_type=authorization_code|refresh_token`; `POST {base}/auth/logout`. Token body must carry `access_token, refresh_token, session_id, user_id, org_id, tenant_id` (optional `expires_in, refresh_expires_in, device_id`). Error body `{ error, reason, message_en, message_id, retry_after }`. 5 s timeout.
- Missing: any portal service; any sign-in screen (`apps/web/src/App.tsx:150-175` has no `/sign-in`); a session-aware boot (a signed-out hosted visitor lands on the paste-your-key onboarding, `apps/web/lib/gateway-gate.ts:94-99`); `state` binding on login (`auth/routes.ts:221-227` reads only `code`); a CSRF re-prime after login (token is bound to the session id, `http-adapter.ts:552-561`). `apps/web/locales/{en,id}/auth.json` exist and nothing reads them.
- Pricing: backend only. `packages/core/src/entitlement/{types,webhook}.ts`, `packages/host/src/handlers/billing.ts` (`GET /api/v1/billing/plan`, `POST /api/v1/billing/top-up` stub, webhook), `PlanBlockedError` flat 403 (`entitlement-store.ts:418-427`). No renderer reads `capabilities.plans` or `/api/v1/billing/plan`. `AGENTFORGE_BILLING_WEBHOOK_SECRET` is absent from `webapp-deploy/.env.example`.

## Architecture

New workspace app **`apps/portal`**: the stand-in for the backend team's portal, implementing `docs/internal/portal/**` on the wire. Own store, own data dir, reached **only** over HTTP through `AGENTFORGE_PORTAL_URL`. It never imports `@agentforge/db` or `@agentforge/host`, and the product never imports it. Store: SQLite (better-sqlite3) behind `apps/portal/src/store/types.ts`; `PORTAL_DATABASE_URL` is its own variable (never `DATABASE_URL`). A Postgres driver running `docs/internal/portal/migrations/0001-0005` unchanged is an optional later lane.

Browser flow (closes pivot open decision 2):

1. `GET /api/v1/auth/start` (host) → `{ authorizeUrl }` + `__Host-agentforge_login_state` cookie (HttpOnly, SameSite=Lax, 10 min).
2. Top-level navigation to portal `GET /authorize?client_id&redirect_uri&state` — `redirect_uri` validated against the registered client's allowlist; OTP sign-in (email → 6 digits); same login gate as `/activate`.
3. `302 {redirect_uri}?code&state` → `/auth/callback` in the app → `POST /api/v1/auth/login { code, state }`; host compares `state` with the cookie (login-CSRF control), exchanges the code with `redirect_uri` + client auth, mints the session.
4. Full page reload, so the session-bound CSRF token is re-minted.

Device-code endpoints (`/auth/device/code`, `/activate`, `/auth/device/approve`, `/auth/device/token`) are built verbatim from `docs/internal/portal/device-code-login.md`; they share the OTP machinery. Also `POST /auth/token` (refresh, rotation + reuse detection kills the chain), `POST /auth/logout`, `GET /auth/session`, `GET /tenant/config`, `GET /.well-known/jwks.json`. Dev only, when `PORTAL_DEV_OUTBOX=1`: `GET /dev/outbox`.

Data model (names from `docs/internal/portal/schema.md`): `tenants, tenant_config, orgs (seat_cap, plan), users, devices, sessions, refresh_tokens, device_codes (+platform), login_otps, audit_log`, plus `auth_codes` (code_hash, client_id, redirect_uri, state_hash, user/org/tenant ids, expires_at, consumed_at; 60 s, single use). Raw codes/tokens are never stored, only sha256.

Security: no password ever; OTP 6 digits / 10 min / 5 attempts / single use / 3 sends per 15 min per address; enumeration-resistant (unknown or ambiguous address renders the same page and sends nothing); device-code limits 5/10 min per install, 30/10 min per IP, `slow_down`, force-expire at 200 polls; approve 10/10 min per user; audit log for every auth event; `user_code`, `device_code`, refresh tokens, JWTs and OTPs never logged. In production mode with no mail provider the portal refuses to send rather than logging a code.

First user locally: `pnpm portal:seed` (tenant, org, seat cap, one user, OAuth client; prints the client secret once); `pnpm portal:otp <email>` prints the newest live code, only with `PORTAL_DEV_OUTBOX=1`. No self-serve sign-up.

Env: app — `AGENTFORGE_PORTAL_URL`, `AGENTFORGE_PORTAL_CLIENT_ID`, `AGENTFORGE_PORTAL_CLIENT_SECRET`, `AGENTFORGE_PUBLIC_URL` (default `trustedOrigins(env)[0]`). Portal — `PORTAL_PORT`, `PORTAL_DATA_DIR`, `PORTAL_DATABASE_URL`, `PORTAL_SIGNING_KEY`, `PORTAL_DEV_OUTBOX`, `PORTAL_SMTP_*`.

## Local review instance (needs the owner's OK before it is started)

Hosted mode cannot be reviewed over plain http: `rejectPlaintext` (`http-adapter.ts:388-391`) 403s without `X-Forwarded-Proto: https`, and `trustedOrigins` drops `http://` entries in server mode (`server-mode.ts:76-85`). So: portal on `127.0.0.1:4000`; the product in server mode on `127.0.0.1:3100` with its **own** `AGENTFORGE_DATA_DIR` (never `.webdev-data`), `AGENTFORGE_TRUSTED_ORIGINS=https://localhost:3443`; `scripts/review-proxy.mjs` terminating TLS on `3443` (self-signed, stamps `X-Forwarded-Proto: https`, appends `X-Forwarded-For`, passes `Host` unchanged). `:3000` is untouched. `NODE_ENV` stays unset so Vite HMR works.

## Pricing

- `packages/core/src/plans/catalog.ts`, exported as `@agentforge/core/plans`: `PLAN_TIERS` (id, kind, nameKey, priceMinor in IDR, period, `seatCap | null`, `tokenAllowance | null`, featureKeys, `placeholder: true`), `findTier`, `allowanceUsdMicrosFor`.
- The meter stays `allowance_usd_micros` (covers images/video; `web-phase5-plans-billing-decisions.md` §D2). `tokenAllowance` is the customer-facing number, converted once via a placeholder `TOKENS_PER_USD_MICROS`. Open owner decision.
- `GET /api/v1/billing/plans` → `{ currency, tiers, current }`, session-gated, not behind the gateway gate. `GET /api/v1/billing/plan` gains `tierId, tokenAllowance, tokensUsed`.
- Screens: `/pricing` (`pricing-page.tsx`, renders from the imported catalog in every mode); plan + usage panel on Settings (`account-plan-panel.tsx`, gated on `capabilities.plans`, amber at 80 %, seats used); blocked screens (`plan-blocked-screen.tsx`) for `plan_allowance_exhausted | plan_past_due | plan_cancelled` with top-up / see-plans CTAs — **never** routed to onboarding; `plan_unavailable` 503 is a retry, not a paywall; `seat_cap_reached` renders on the sign-in screen. New `plans` locale namespace, en + id, parity test.
- Simulating states locally: webhook with `x-callback-token`, fresh `event_id` each time, tenant must have signed in once. `entitlement.set` with `{kind,status,allowance_usd_micros,seat_cap,currency}`; exhausted = set `allowance_usd_micros: 1` then one metered call; `status: past_due|cancelled`; `seat_cap: 1` + a second user; `allowance.topup` with `top_up_usd_micros`; `period.reset`.

## Lanes (disjoint files inside a group)

| Lane | Owns | Needs | Size |
|---|---|---|---|
| A portal skeleton, store, seed CLI | `apps/portal/{package.json,AGENTS.md,README.md}`, `src/{config,server,log}.ts`, `src/store/**`, `scripts/{seed,otp}.ts`, root `package.json` scripts | — | L |
| E plan catalog | `packages/core/src/plans/**`, one subpath in `packages/core/package.json` | — | S |
| H review harness + env template | `scripts/review-proxy.{mjs,test.mjs}`, `webapp-deploy/.env.example` | — | S |
| B portal endpoints, views, OTP, JWT | `apps/portal/src/{routes,flows,views,otp,security,jwt}/**`, `apps/portal/locales/**` | A | L |
| F host: auth start, state, client auth, plans route | `packages/host/src/router.ts`, `auth/{routes,portal-client,index}.ts`, `handlers/billing.ts` + tests (sole owner of `router.ts`) | E | M |
| C renderer sign-in, session provider, boot order | `apps/web/src/App.tsx`, `src/pages/auth-callback-page.tsx`, `components/sign-in-screen.tsx`, `lib/{session.tsx,auth-reason.ts}`, `locales/*/auth.json` | F | M |
| G pricing page, plan panel, blocked screens | `apps/web/components/{pricing-page,account-plan-panel,plan-blocked-screen}.tsx`, `lib/plan-block.ts`, `locales/*/plans.json`, `lib/i18n.ts` | E, F | M |
| D e2e, verify recipes, maps | `apps/web/tests/e2e/hosted-login.spec.ts`, maps refresh (`portal-session-auth.md`, `tenant-entitlement.md`, new `portal-service.md`), `unreleased.md` | all | M |
| I (optional) Postgres driver + compose | `apps/portal/src/store/postgres/**` | B | L |

## Owner decisions still open

1. Portal store: SQLite stand-in now (default, in progress) vs Postgres + real migrations from day one.
2. OK to start the review instance on 3100 / 3443 / 4000.
3. Self-signed cert vs local Caddy `tls internal`.
4. OTP delivery: dev outbox only, or a mail provider (which).
5. Self-serve sign-up, or seeded users only (default).
6. Token allowance as a display unit over the USD-micros meter (default) vs a real token counter.
7. Real tier names, prices, seat caps, allowances.
8. Same two plans as pivot decision 8 (Personal / Enterprise) or a three-tier shape.
9. Public pricing before sign-in via the API (default: no; the renderer imports the catalog).

Defaults taken: confidential client (`client_id` + `client_secret`), `state` cookie, no PKCE in v1, full reload after sign-in, portal session cookie 30 days, UTC calendar-month period, warn at 80 %, portal remains the seat authority, token vault stays in process memory.

# Device-code login: DPSBuddy client ↔ Toko Token AI portal

> **Read the client-integration sections as the frozen Electron path.** Desktop is frozen at 0.14.27 and the product
> continues as a hosted, multi-user web app, which needs a browser-session variant of this flow instead of
> `device.json` / `session.enc` in a local data dir. That is open decision 2 in
> [`web-pivot-2026-09-18.md`](../web-pivot-2026-09-18.md). The portal-side flow below is unchanged.

Status: design, not implemented. Backend team implements the portal side; client team wires the app side.
Companion doc: `docs/internal/portal/schema.md` (tables, RLS, DB functions). Names here match that contract.

Portal origin in this doc: `https://api.tokotokenai.com` (gateway `/v1` lives on the same origin).

## Goals and non-goals

Goals

- Portal is the control plane. The app holds no licence state and makes no entitlement decision of its own.
- A user signs in on a machine once, gets a device-bound session, and the app silently refreshes it.
- Every `/v1` call carries org + user + device so the gateway can meter spend, enforce caps, and write an immutable `usage` row.
- Whitelabel is tenant config fetched at login (branding, model allowlist, feature flags). One binary for JAST / Hypernet / Metranet / direct.
- Revocation is fast: an admin revoking a device or a session stops that machine within one access-token lifetime (~1 h) and immediately on the next refresh.
- The app boots fully offline. No network call is on the startup critical path.

Non-goals (v1)

- **BYO-key mode is untouched.** Pasting a raw gateway key into Settings keeps working exactly as today: no org, no seat, no support. Login is a second, additive door. No migration, no forced upgrade. **Where BYO spend is billed is an open question, not a decision this doc makes** — see open question 9; `wallet_ledger.org_id` is NOT NULL and there is no per-user wallet, so nothing here may claim the spend lands on a user wallet.
- No SSO in v1. The hook is reserved: `tenant_config.feature_flags.sso_provider`; when set, `GET /activate` redirects to the tenant's OIDC provider instead of rendering the email+OTP form. Nothing else in the flow changes. `sso_provider` (text or null) is the only non-boolean entry in the flag vocabulary, and there is no separate boolean `sso`: the full list is in `schema.md`, "Plan gates are columns and flags".
- No offline licence file, no grace tokens signed for offline use beyond the cached-session grace described below.
- No mobile/Android client. Desktop Electron only.
- No password login, ever (see `GET /activate`).

## Actors and identifiers

| Actor | What it is | Lifetime |
|---|---|---|
| tenant | Whitelabel partner. Owns branding, model allowlist, feature flags. | permanent |
| org | Billing + seat boundary inside a tenant. Owns the wallet and `seat_cap`. | permanent |
| user | A person in one org. `users.status`. | permanent |
| device | One installation on one machine. `devices` row, unique on `(user_id, install_id)`. | until revoked or uninstalled |
| session | One login of one user on one device. `sessions` row. | until revoked, or refresh chain expires |

**Two device identifiers, and they are not interchangeable.** Conflating them is the easiest bug to write here, so this doc keeps them strictly apart:

| name | who mints it | type | where it lives | used for |
|---|---|---|---|---|
| `install_id` | the **client**, once per installation | opaque string (UUIDv4) | `devices.install_id`, `device_codes.install_id` | identifying the machine *before* it has a device row; unauthenticated rate-limit buckets |
| `device_id` | the **server**, on first approval | uuid | `devices.id` → `sessions.device_id`, `device_codes.device_id` | the `did` JWT claim, refresh device binding, `login_precheck`, admin revocation |

`devices` is unique on `(user_id, install_id)` (`uq_devices_user_install`), so one installation
signed into by two users gets two device rows and two `device_id`s. The client sends `install_id` on
the two unauthenticated endpoints (`/auth/device/code`, `/auth/device/token`) because it has no
`device_id` yet; from the token response onwards it holds and sends `device_id`.

**install_id — minting and persistence.** The client mints a UUIDv4 on first run. It is an opaque identifier, not a secret, but it must be *stable*: an install_id that changes on every reinstall churns the seat cap and floods `devices`.

- Primary store: `<localDataDir()>/device.json`, mode `0600`, content `{ "installId": "<uuid>", "createdAt": "<iso>" }`. `localDataDir()` is `packages/db/src/vault-key.ts`; this sits next to `.master-key` and `settings.enc`.
- Mirror: the same uuid inside `session.enc` (below), so a deleted `device.json` is recovered rather than re-minted.
- Read order: `device.json` → `session.enc` mirror → mint new, write both.
- Explicitly **not** the keychain: the keychain slot is owned by the desktop shell (`apps/desktop/main.cjs:168-184`) and adding a slot is a shell change we do not want for this.
- Never derived from hardware (MAC, disk serial, machine GUID). Fingerprinting is a privacy liability and breaks under VM cloning / NIC changes anyway.

**Device metadata sent at registration** (`POST /auth/device/code`). No `devices` row exists yet, so the metadata is parked on the `device_codes` row and copied onto `devices` at approval: `label` → `device_codes.client_name`, `app_version` → `device_codes.client_version`, `install_id` → `device_codes.install_id`. **`platform` has no column on `device_codes`** in `0002_core_tables.sql`, which is a gap: `/activate` below promises to show the requesting device's platform, and today it could not. Either add `device_codes.platform` or drop that from the page — do not let the client re-send it at approval time, because the browser half is a different party and must not be able to restate what the device claimed.

- `platform`: the raw Node.js `process.platform` value — `"win32" | "darwin" | "linux"` for the Electron client. Needed for support and for update targeting. **The client sends `process.platform` verbatim; the portal maps it to the stored vocabulary** before writing `devices.platform`, whose CHECK (`devices_platform_chk`) allows `windows | macos | linux | android | ios | web`. The mapping is the portal's, not the client's, so a future client (mobile, web) does not have to know the storage vocabulary:

  | `process.platform` (sent) | `devices.platform` (stored) |
  |---|---|
  | `win32` | `windows` |
  | `darwin` | `macos` |
  | `linux` | `linux` |

  Anything else — `freebsd`, `openbsd`, `aix`, `sunos`, or an unknown string — is rejected with `400 invalid_request`, because Electron ships on exactly these three and an unmapped value must not silently become a wrong one. `android`, `ios` and `web` are reserved for clients that do not exist yet; they are stored directly by whatever client introduces them, never produced by this mapping.
- `app_version`: e.g. `"0.14.25"` — needed to answer "is this machine on a build with the fix".
- `label`: user-editable display name, defaults to `"<platform> device"` (e.g. `"Windows device"`). **Hostname is NOT sent.** Hostnames in Indonesian corporate fleets routinely carry the employee's name or NIK; that is personal data we have no reason to hold. The user may rename the device in the portal, which is consent-shaped.
- Nothing else. No username, no locale-derived geo, no IP beyond what the TLS connection already reveals (the portal may log the IP on `audit_log` for security events; that is standard and disclosed).

**Tenant identification at first run.** Primary: **branded build config.** `apps/desktop/branding/<brand>/brand.json` already carries `id`, `gatewayName`, `gatewayBaseUrl` (see `apps/desktop/branding/metranet/brand.json`). Add `tenantSlug` there; the shell already surfaces brand fields to the host via `host-status.json` and to the renderer via `desktop-bridge.ts`. The client sends `tenant_hint: "<tenantSlug>"` on `POST /auth/device/code`. This is right because the whitelabel installer is per-partner anyway — the user should never have to know what a tenant is.

Fallback: **resolve from the approving user.** If `tenant_hint` is absent (generic build) or unknown, the portal leaves `device_codes.tenant_id` null and fills it at `/auth/device/approve` from the signed-in user's own tenant. Rejected alternative: tenant lookup by email domain — domains are shared (`@gmail.com`), spoofable at the form, and partners resell to orgs on arbitrary domains.

If `tenant_hint` is present *and* the approving user belongs to a different tenant, the approval fails with `tenant_inactive` (do not silently cross tenants; a Metranet build must not sign into a JAST org).

## Endpoints

All error bodies share one shape. `reason` is from the fixed reason-code list; `message_en`/`message_id` are display-ready and the client shows them verbatim when it has no better copy.

```json
{ "error": "invalid_grant", "reason": "seat_cap_reached",
  "message_en": "Your organisation has no seats left.",
  "message_id": "Organisasi Anda tidak memiliki kursi tersisa.",
  "retry_after": 5 }
```

`error` is the RFC 6749/8628 family (`invalid_request`, `invalid_grant`, `invalid_client`, `authorization_pending`, `slow_down`, `access_denied`, `expired_token`); `reason` is ours and is what the client branches on.

Rate limits are per-IP **and** per-`install_id` unless stated — the unauthenticated endpoints have no `device_id` to bucket on. All limits return `429` with `retry_after`.

---

### `POST /auth/device/code`

Unauthenticated. Starts a login.

```jsonc
// request
{ "install_id": "3f2a…", "tenant_hint": "metranet",
  "platform": "win32", "app_version": "0.14.25", "label": "Windows device" }
// 200
{ "device_code": "<43-char base64url>", "user_code": "K7M4-PQ9T",
  "verification_uri": "https://api.tokotokenai.com/activate",
  "verification_uri_complete": "https://api.tokotokenai.com/activate?code=K7M4-PQ9T",
  "expires_in": 600, "interval": 5 }
```

- `user_code`: 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no `0 O 1 I`), displayed `XXXX-XXXX`. Compare case-insensitively, strip the dash.
- `device_code`: 32 random bytes base64url. Stored as `device_codes.device_code_hash` = sha256(raw). Raw never persisted.
- TTL 600 s. `status = 'pending'`.
- Writes: `device_codes` (one row, carrying `install_id`, `client_name`, `client_version`; `device_id` stays NULL until approval). Upserts `devices` **only after approval**, not here — an unapproved poll must not create a device row (else anyone can enumerate seats).
- Rate limit: 5 / 10 min per install_id, 30 / 10 min per IP.
- audit_log: `device_code.requested`.

Errors: `400 invalid_request` (bad install_id shape — `devices_install_id_chk` wants 8–128 chars — or a `platform` outside the mapping table above), `403 tenant_inactive` if `tenant_hint` names a suspended tenant.

---

### `GET /activate`

A browser page, not an API. Rendered with the tenant's branding when `?code=` resolves to a tenant, otherwise neutral.

Shows: the `user_code` field (prefilled from `?code=`), the requesting device's `platform` + `label` + approximate location from IP ("Jakarta, ID"), and a plain sentence: *"Only continue if you just started a sign-in on that device."* On submit of a valid pending code it asks the user to sign in, then renders **Approve / Deny** with the device details repeated.

**Sign-in method: email + one-time code (OTP), no password.** Justification: (1) we would otherwise own a password database for four whitelabel partners with no shared IdP — the worst possible asset to hold; (2) credential stuffing is the dominant attack on Indonesian SME SaaS and OTP removes it entirely; (3) partners who later want SSO drop in OIDC without a password migration; (4) the user is already at a browser, so there is no UX cost. OTP is 6 digits, 10 min TTL, 5 attempts, one-time, rate limited 3 sends / 15 min per email. A session cookie on the portal (30 days) means the second and third device activation need no OTP at all.

This is the `login_otps` table (`0002_core_tables.sql`): `otp_hash = sha256(code)` only — the raw six digits exist in the email and nowhere else — with `attempts` capped at 5 by a CHECK, `expires_at` at `created_at + 10 minutes`, and `consumed_at` set in the same transaction that signs the user in, which is what makes the code single-use rather than merely short-lived. The 3-sends-per-15-minutes limit is counted from the rows themselves over `ix_login_otps_tenant_email (tenant_id, email, created_at DESC)`, so there is no counter to reconcile; `prune_login_otps()` keeps 24 h precisely so the send window stays countable. `login_otps.tenant_id` is NOT NULL: the tenant is resolved *before* a code is minted — from `device_codes.tenant_id` when `?code=` carried a `tenant_hint` — and an address matching users in more than one tenant sends nothing while still rendering the same neutral "check your email" page. Note the gap: the "resolve the tenant from the approving user" fallback cannot be done with a plain `users` lookup, because `portal_app` reads `users` under RLS and has no `app.tenant_id` to set yet. A generic (unbranded) build therefore needs an explicit resolution path — a `portal_admin`-owned `SECURITY DEFINER` lookup that returns at most a tenant id, or a per-tenant loop — and that function does not exist in `0005_functions.sql` yet. Branded builds, which are every shipped installer today, always carry `tenant_hint` and never hit this.

SSO hook: if `tenant_config.feature_flags.sso_provider` is set for the resolved tenant, `/activate` redirects to that OIDC provider and skips the OTP form. Everything downstream is identical.

audit_log: `activate.viewed`, `otp.sent`, `otp.verified`, `otp.failed`.

---

### `POST /auth/device/approve`

Called by the `/activate` page, authenticated by the portal session cookie + CSRF token. Not called by the app.

```jsonc
// request
{ "user_code": "K7M4PQ9T", "decision": "approve" }   // or "deny"
// 200
{ "status": "approved", "device_label": "Windows device" }
```

Server work, in one transaction:

1. Load `device_codes` by `user_code`, status `pending`, not expired. Else `410 device_code_expired`.
2. Resolve tenant: `device_codes.tenant_id` if set, else the user's tenant. Mismatch → `403 tenant_inactive`.
3. On `deny`: `status='denied'`, audit `device_code.denied`, return.
4. Upsert `devices` on **`(user_id, install_id)`** — the `uq_devices_user_install` unique index, using the `install_id` carried on the `device_codes` row and the id of the user who just signed in. The upsert returns `devices.id`, which is the **server-side `device_id`** from here on. If the row already exists and `revoked_at IS NOT NULL`, fail `403 device_revoked` (a revoked device cannot be re-approved without an admin clearing it). There is no `(tenant_id, device_id)` constraint and there never was: the tenant is implied by the user, and `device_id` is what this step *produces*, not what it looks the row up by.
5. Run the login gate: tenant active, `orgs.status` active, `users.status` active, and if this user is not already an active user, `count_active_users(org_id) < orgs.seat_cap`. Any failure → `403` with the matching reason code, `device_codes.status='denied'`, audit `login.denied` with the reason. The user sees the reason **in the browser**, where an admin can act — this is deliberate: seat-cap failures are an admin problem, not a desktop-app problem.
6. `status='approved'`; set `device_codes.user_id` (the approving user — there is no `approved_by_user_id` column), `device_codes.org_id`, `device_codes.tenant_id` if it was still NULL, and `device_codes.device_id` = the `devices.id` from step 4. `device_codes_approved_chk` requires all three of tenant/user/org to be non-NULL once the status is `approved`, so this is one UPDATE, not several.

Writes: `device_codes`, `devices`. Reads: `tenants`, `orgs`, `users`, `sessions` (via `count_active_users`).
audit_log: `device_code.approved` | `device_code.denied` | `login.denied`.
Rate limit: 10 / 10 min per portal user.

---

### `POST /auth/device/token`

Unauthenticated (the `device_code` *is* the credential). The app polls this.

```jsonc
// request
{ "device_code": "<raw>", "install_id": "3f2a…" }
// 200  — device_id here is the server-side devices.id, the `did` claim; the client stores it
{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600,
  "refresh_token": "<43-char base64url>", "refresh_expires_in": 2592000,
  "session_id": "…", "device_id": "…", "org_id": "…", "user_id": "…", "tenant_id": "…" }
```

Pending responses are `400` with `reason: "authorization_pending"` (keep polling at `interval`) or `reason: "slow_down"` + `retry_after` (client adds 5 s to its interval, permanently for this attempt). Terminal: `410 device_code_expired`, `403 device_code_denied`, plus any login-gate reason if state changed between approve and poll.

Server work:

1. sha256 the `device_code`, look up `device_codes`. Unknown hash → `400 invalid_grant` after a constant-time delay. Status `pending` → `authorization_pending`. `denied` → `device_code_denied`. `expired`/past `expires_at` → `device_code_expired`. `redeemed` → `400 invalid_grant` **and** audit `device_code.replayed`.
2. `install_id` in the body must equal `device_codes.install_id`. Mismatch → `400 invalid_grant`, audit `device_code.device_mismatch`. (The client still has no `device_id` at this point; the row's `device_id` was filled in at approval and is what the next step uses.)
3. Re-run `login_precheck(user_id, device_id, NULL)` with `device_codes.device_id` — the server-side `devices.id`, which is what `login_precheck` looks up in `devices`. A non-`'ok'` result is returned as that reason (state can change in the 10 s between browser approval and the poll).
4. Create `sessions` row (`sessions.device_id` = that same `devices.id`, `last_seen_at = now()`), issue access JWT with `did` = `devices.id`, issue refresh token generation 1.
5. `device_codes.status='redeemed'`, `used_at = now()`, `session_id` set — single use, enforced by the same transaction. (`redeemed` is the terminal status in `device_codes_status_chk`; there is no `consumed`.)

Writes: `device_codes`, `sessions`, `refresh_tokens`. audit_log: `session.created`.
Rate limit: polling is bounded by `interval`; more than 2 polls inside one interval window → `slow_down` (`device_codes.poll_count` and `last_polled_at` are what drive both). More than 200 polls on one `device_code` → expire it and audit `device_code.poll_abuse`.

---

### `POST /auth/token` (`grant_type=refresh_token`)

```jsonc
// request  — device_id is the server-side devices.id from the token response, not install_id
{ "grant_type": "refresh_token", "refresh_token": "<raw>", "device_id": "9c1e…" }
// 200  — same body as the token endpoint, with a NEW refresh_token
```

**The portal generates the successor token before it calls the database.** `rotate_refresh_token` takes six arguments, and the second is not optional:

```sql
SELECT * FROM rotate_refresh_token(
  p_token_hash     => sha256($presented_raw),   -- the token the client just sent
  p_new_token_hash => sha256($new_raw),         -- the successor the caller generated a moment ago
  p_device_id      => $device_id,               -- devices.id; compared against sessions.device_id
  p_ttl            => interval '30 days',       -- the sliding window; defaulted, pass it explicitly
  p_ip             => $ip,
  p_user_agent     => $user_agent);
```

So the sequence in the handler is: read 32 random bytes → keep the base64url form to return to the client → hash both the presented and the new token → call the function → return the new raw token in the response body. **The database never sees a raw refresh token, in either direction.** It stores and compares `sha256` only, and it cannot mint a token itself, which is why `p_new_token_hash` is a required positional argument rather than something the function generates. Any call site written as `rotate_refresh_token(token_hash, device_id)` is wrong twice over: it is missing the successor, and it passes the device id into the successor's slot, where it will fail the `bytea` type check.

That function, in one transaction: finds the row by hash (`FOR UPDATE`, which is what serializes two racing refreshes); if `used_at IS NOT NULL` or the row is already revoked → **reuse detected**: revoke every `refresh_tokens` row in the chain, set `sessions.revoked_at`, return `refresh_reused`. Otherwise checks `expires_at` and `sessions.absolute_expires_at` (→ `refresh_expired`), checks the **session's** `device_id` against `p_device_id` (below), runs `login_precheck(user_id, device_id, session_id)`, then inserts the new row at `generation + 1` with `p_new_token_hash`, marks the old row `used_at = now()`, `replaced_by = <new id>`, and bumps `sessions.last_seen_at` and `devices.last_seen_at`. An unknown hash returns `refresh_expired`, deliberately indistinguishable from an aged-out one.

Sliding TTL 30 days on each new row; absolute cap 90 days from `sessions.created_at` — past that the user signs in again.

Errors: `401` + the precheck reason (`session_revoked`, `device_revoked`, `user_inactive`, `org_inactive`, `org_past_due`, `seat_cap_reached`, `tenant_inactive`) or `refresh_reused` / `refresh_expired`.
Writes: `refresh_tokens`, `sessions`. audit_log: `token.refreshed`, or `token.reuse_detected` + `session.revoked`.
Rate limit: 20 / h per session_id — a healthy client refreshes ~24×/day.

---

### `POST /auth/logout`

Bearer access token. Body `{ "all_devices": false }`. Sets `sessions.revoked_at` for this `sid` (or every session of the user when `all_devices`), marks outstanding refresh rows spent. Idempotent, always `204`. audit_log: `session.revoked` (`actor: "user"`).

### `GET /auth/session`

Bearer access token. Returns `{ user: {id,email,name}, org: {id,name,status,plan,seat_cap,seats_used}, tenant: {id,slug}, device: {id,label,last_seen_at}, session: {id,created_at} }`. This is the only endpoint that hits the DB for status on demand; the app calls it after login and on the Account screen, not per request. `200`, or `401` + reason. Rate limit 60 / h per session.

### `GET /tenant/config`

Bearer access token (or `?tenant=<slug>` unauthenticated for pre-login branding — returns branding only, never flags or allowlist).

```json
{ "tenant_id": "…", "slug": "metranet", "etag": "W/\"c9…\"",
  "branding": { "product_name": "AIHub Metranet", "logo_url": "…", "accent": "#0B5" },
  "model_allowlist": ["gpt-4o-mini", "…"],
  "feature_flags": { "allow_byo_key": true, "sso_provider": null,
                     "spend_caps": true, "model_allowlist": true, "usage_reports": true } }
```

Reads `tenant_config`. Flag names come from the single vocabulary in `schema.md` ("Plan gates are columns and flags") — every flag is a boolean except `sso_provider`, which is text or null. A key outside that list is a bug, not an extension point: the client branches on `allow_byo_key` and the portal on `sso_provider`, and both must be able to assume the same list the CHECK comments in `0002_core_tables.sql` name. Supports `If-None-Match` → `304`. Client caches the body and the etag on disk indefinitely and revalidates in the background. Rate limit 60 / h per device.

### `GET /.well-known/jwks.json`

Unauthenticated, cacheable (`Cache-Control: public, max-age=3600`). Ed25519 public keys, `{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"…","x":"…","use":"sig","alg":"EdDSA"}]}`. Always publishes the current key plus the next key (pre-published 24 h before it signs) plus the previous key (kept 24 h after retirement). Consumed by the gateway, not by the app.

The document is a straight read of `jwks_keys` (`0002_core_tables.sql`) — one row per key, `x` is base64url of the 32-byte `public_key` column:

```sql
SELECT kid, public_key FROM jwks_keys
 WHERE publish_at <= now() AND (unpublish_at IS NULL OR unpublish_at > now());
```

`publish_at` is `activate_at - 24 h` and `unpublish_at` is `retired_at + 24 h`, so the two windows are data, not a deployment ritual someone has to remember.

## Sequence diagrams

### (a) First login

```mermaid
sequenceDiagram
    participant U as User
    participant App as DPSBuddy (host process)
    participant Br as Browser
    participant P as Portal
    App->>P: POST /auth/device/code {install_id, tenant_hint, platform, app_version}
    P-->>App: user_code K7M4-PQ9T, device_code, verification_uri, interval 5s
    App->>U: show K7M4-PQ9T + "Open portal" button
    App->>Br: open /activate?code=K7M4-PQ9T
    loop every 5s until 600s
        App->>P: POST /auth/device/token {device_code, install_id}
        P-->>App: 400 authorization_pending
    end
    U->>Br: enter email
    Br->>P: request OTP
    P-->>U: 6-digit code by email
    U->>Br: enter OTP, press Approve
    Br->>P: POST /auth/device/approve {user_code, approve}
    P->>P: upsert devices on (user_id, install_id) -> device_id; login gate (tenant/org/user/seat_cap)
    P-->>Br: approved
    App->>P: POST /auth/device/token
    P->>P: create session (device_id) + refresh gen 1; device_code -> redeemed
    P-->>App: access_token(1h) + refresh_token + device_id
    App->>App: refresh -> keychain-wrapped session.enc; access token in memory
    App->>P: GET /tenant/config (Bearer)
    P-->>App: branding, model_allowlist, feature_flags
```

### (b) Silent refresh at boot / before a `/v1` call

```mermaid
sequenceDiagram
    participant App as DPSBuddy
    participant P as Portal
    participant G as Gateway /v1
    App->>App: boot; render UI from disk state (no network)
    App->>App: hasSession? access token expired or <5 min left?
    App->>P: POST /auth/token {grant_type:refresh_token, refresh_token, device_id} (3s timeout)
    alt success
        P-->>App: new access_token + rotated refresh_token
        App->>App: replace stored refresh token atomically, bump timer
        App->>G: POST /v1/chat/completions (Bearer access_token)
        G-->>App: 200 + usage row written
    else network unreachable
        P--xApp: timeout
        App->>App: stay signed in (grace), retry with backoff 30s/2m/10m
    end
```

### (c) Refresh-token reuse detected

```mermaid
sequenceDiagram
    participant A as App instance A (legit)
    participant T as Thief (copied session.enc)
    participant P as Portal
    A->>P: refresh (gen 4)
    P-->>A: gen 5 issued; gen 4 marked used_at
    T->>P: refresh (gen 4, stale copy)
    P->>P: rotate_refresh_token sees used_at set
    P->>P: revoke whole chain; sessions.revoked_at = now()
    P-->>T: 401 refresh_reused
    A->>P: refresh (gen 5)
    P-->>A: 401 session_revoked
    A->>A: clear session, show "Signed out for security. Sign in again."
```

### (d) Admin revokes a device while the app is running

```mermaid
sequenceDiagram
    participant Ad as Org admin
    participant P as Portal
    participant G as Gateway
    participant App as DPSBuddy
    Ad->>P: revoke device D
    P->>P: devices.revoked_at = now(); revoke sessions on D; audit device.revoked
    App->>G: POST /v1/... (access token still valid, <=1h)
    G->>G: sid status cache miss (60s TTL) -> DB check
    G-->>App: 401 {reason:"device_revoked"}
    App->>P: POST /auth/token (refresh)
    P-->>App: 401 device_revoked
    App->>App: clear session; gate falls back to BYO key or onboarding
```

### (e) Seat cap reached

```mermaid
sequenceDiagram
    participant U as New user
    participant Br as Browser (/activate)
    participant P as Portal
    participant Ad as Org admin
    U->>Br: sign in, press Approve
    Br->>P: POST /auth/device/approve
    P->>P: count_active_users(org) = seat_cap
    P-->>Br: 403 seat_cap_reached + message_en/message_id
    Br->>U: "No seats left. Ask your admin to free a seat or add one."
    P->>Ad: notify (email) seat_cap_reached
    Note over U,P: device_codes.status = denied; the app polls once more and shows the same reason
```

## Token design

**Access token** — Ed25519 (EdDSA), 1 h. No refresh grace inside the token; the client refreshes at T−5 min.

```jsonc
// header
{ "alg": "EdDSA", "typ": "JWT", "kid": "2026-09-a" }
// claims
{ "iss": "https://api.tokotokenai.com", "sub": "usr_01J…", "tid": "tnt_metranet",
  "oid": "org_01J…", "did": "dev_9c1e…", "sid": "ses_01J…",
  "scope": "v1.chat v1.models v1.usage", "iat": 1789000000, "exp": 1789003600 }
```

`did` is `devices.id`, the server-side device id — never the client-minted `install_id`, which no token ever carries. No `aud` beyond `iss`-scoped use; the gateway and the portal are one origin. `scope` is coarse and is set from `tenant_config.feature_flags` at issue time.

**Why verification needs no DB.** The gateway holds the JWKS in memory (refreshed hourly, plus on an unknown `kid`). Signature + `exp` + `iss` verification is pure CPU, so the p99 auth cost on a `/v1` call is microseconds and the gateway survives a portal-DB outage for in-flight sessions. Ed25519 over RS256 because verification is ~20× cheaper and keys are 32 bytes.

**Key rotation.** Keys live in `jwks_keys` (`0002_core_tables.sql`): `kid` as the primary key, the raw 32-byte `public_key`, a `private_key_ref` pointing into the KMS — the private half is never in a row — and `status` in `active | next | retired`, with a partial unique index allowing exactly one `active` signing key. A new key is inserted as `next` and published to JWKS 24 h before it starts signing (`publish_at = activate_at - 24 h`), and the retired key stays published 24 h after (`unpublish_at = retired_at + 24 h`). So a gateway with a stale hourly cache never meets an unknown `kid` and never rejects a valid token. Rotation cadence: 90 days, or immediately on suspected compromise — in which case `unpublish_at` is set to `retired_at`, the key leaves JWKS at once, and every session is force-refreshed. `jwks_keys` is the one table outside RLS (it is portal-wide, and the gateway verifies a signature before it knows the tenant); `portal_app` holds `SELECT` only, so rotation is an ops action run as `portal_admin` with the KMS in hand.

**What the gateway still checks in DB per `/v1` call.** Only what the token cannot carry, because it changes mid-token-life:

- `sessions.revoked_at`, `devices.revoked_at`, `users.status`, `orgs.status` — cached **60 s keyed by `sid`**, negative results not cached (a revoke must take effect within 60 s; an un-revoke is rare and can wait).
- Wallet balance and the per-user spend cap — read live from `wallet_ledger` aggregates, never cached, because two concurrent requests must not both pass a cap check. Use a row lock or an atomic decrement on a reservation counter.
- The `usage` row write, which is unconditional and immutable.

So the worst-case exposure after a revoke is 60 s of `/v1` calls on a valid access token, bounded further by the spend cap. That is the deliberate trade: 60 s of over-permission in exchange for no DB hit on the hot path.

**Refresh token binding to device — what it means.** The binding is **not** on the refresh token. `refresh_tokens` has no `device_id` column; it carries `tenant_id`, `session_id`, `token_hash`, `generation`, `used_at` and `replaced_by`, and nothing else. The device lives one level up, on **`sessions.device_id`** (NOT NULL, FK to `devices.id`), which is set once when the session is created and never moves — every token in a rotation chain hangs off that one session row and therefore inherits exactly one device.

What enforces it is `rotate_refresh_token`'s `p_device_id` argument: the function loads the session behind the presented token (`SELECT … FROM sessions … FOR UPDATE`) and compares `p_device_id <> r_sess.device_id`. A mismatch is **not** a soft rejection — it calls `revoke_session_chain(..., 'refresh_reused', cause 'device_mismatch')`, killing every refresh row in the chain and the session, and returns `refresh_reused`. The reasoning is in the function's own comment: a valid refresh token arriving with the wrong device id means the token has left the device it was bound to, which is the replay threat model exactly, and anyone who can trip it already holds the token.

Two consequences worth stating plainly. First, `p_device_id` defaults to NULL and the comparison is skipped when it is NULL, so an internal caller that omits it gets no binding at all — the portal's refresh handler must always pass it. Second, this is still a *bearer* token bound by a *claimed* identifier: it stops a stolen token being replayed from a machine that does not know the `device_id`, which in practice means nothing against an attacker who copied the whole data directory — the `device_id` is in `session.enc` beside the token.

The real defence in v1 is therefore **rotation + reuse detection + keychain-wrapped storage**: any use of a spent generation kills the chain (diagram c), so a thief gets at most one window and the legitimate user is signed out loudly rather than silently shadowed.

The stronger option is a per-device Ed25519 keypair with the private key in the OS credential store and a DPoP-style signed proof on every refresh — that survives disk theft outright. It is **not** v1 because the private key belongs in the OS credential store, and the credential-store slot is owned by the desktop shell (`apps/desktop/main.cjs:168-184`); adding a slot for a feature violates the shell-vs-app rule and needs Rizky's call (open question 2). Note that `devices` in `0002_core_tables.sql` has **no** `public_key` column — the migration does not reserve one — so v1.1 is a code change *plus* a one-column `ALTER TABLE`. That is cheap on a `devices` table this size; it is called out here only so nobody plans v1.1 believing the column already exists.

## Login checks and reason codes

| Check | reason | Evaluated at | App copy EN | App copy ID | Recoverable by |
|---|---|---|---|---|---|
| tenant active | `tenant_inactive` | approve, token, refresh, gateway | Your provider's account is not active. Contact support. | Akun penyedia Anda tidak aktif. Hubungi dukungan. | Toko Token AI ops |
| org active | `org_inactive` | approve, token, refresh, gateway | Your organisation is not active. | Organisasi Anda tidak aktif. | org admin → partner |
| org not past due | `org_past_due` | approve, token, refresh, gateway | Your organisation's payment is overdue. | Pembayaran organisasi Anda tertunggak. | org admin (pay) |
| user active | `user_inactive` | approve, token, refresh, gateway | Your account is disabled. | Akun Anda dinonaktifkan. | org admin |
| active users ≤ seat_cap | `seat_cap_reached` | approve, token | No seats left in your organisation. | Tidak ada kursi tersisa di organisasi Anda. | org admin (free/add a seat) |
| device not revoked | `device_revoked` | approve, token, refresh, gateway | This device was signed out by an admin. | Perangkat ini telah dikeluarkan oleh admin. | org admin |
| session not revoked | `session_revoked` | refresh, gateway | You were signed out. Please sign in again. | Anda telah keluar. Silakan masuk lagi. | user (sign in) |
| refresh not replayed | `refresh_reused` | refresh | Signed out for security. Please sign in again. | Keluar demi keamanan. Silakan masuk lagi. | user (sign in) |
| refresh not expired | `refresh_expired` | refresh | Your session expired. Please sign in again. | Sesi Anda berakhir. Silakan masuk lagi. | user (sign in) |
| device_code fresh | `device_code_expired` | token | The code expired. Start sign-in again. | Kode kedaluwarsa. Mulai masuk lagi. | user (retry) |
| device_code approved | `device_code_denied` | token | Sign-in was denied. | Masuk ditolak. | user (retry) |
| poll timing | `authorization_pending` | token | *(no copy — keep polling)* | — | — |
| poll timing | `slow_down` | token | *(no copy — widen interval by 5 s)* | — | — |

The gateway column matters: a `/v1` call can fail with `org_past_due` mid-session. The app must map a `401` with any of these reasons onto the same UI as a failed refresh, not onto a generic "API error".

## Client integration plan

Real files referenced below: `packages/core/src/secrets.ts`, `packages/core/src/runtime/create-runtime.ts`, `packages/host/src/settings-store.ts`, `packages/host/src/router.ts`, `packages/host/src/handlers/settings.ts`, `packages/core/src/gateway/account.ts`, `packages/core/src/crypto/envelope.ts`, `apps/web/src/App.tsx`, `apps/web/lib/api-client.ts`.

**New struct, not new `StoredSecrets` fields.** `StoredSecrets` (`packages/core/src/secrets.ts:5-49`) is **per-workspace** (`resolveSettingsWorkspaceId`, `settings-store.ts:186`) and its masked projection is a renderer-facing surface. A session is per-machine and per-user; putting it in `StoredSecrets` would give one machine N sessions and would tempt someone to add a token field to `MaskedSecrets`. So: a sibling `StoredSession` in a new machine-scoped `packages/core/src/session.ts`, persisted to `<localDataDir()>/session.enc` by a new `packages/host/src/session-store.ts` that reuses `encryptJson`/`decryptJson` from `packages/core/src/crypto/envelope.ts`.

```ts
export type StoredSession = {
  installId: string;             // client-minted, mirrors device.json
  deviceId: string;              // server-side devices.id; the `did` claim and the refresh binding
  tenantId: string; orgId: string; userId: string; sessionId: string;
  refreshToken: string;          // raw; the only secret in this file
  refreshExpiresAt: number;      // epoch ms, sliding
  absoluteExpiresAt: number;     // epoch ms, 90 days
  tenantConfig?: TenantConfig;   // cached
  tenantConfigEtag?: string;
  lastRefreshOkAt?: number;      // drives the offline grace window
};
```

**Where the raw refresh token lives: `session.enc`, not a new keychain slot.** `session.enc` is encrypted under `HKDF(wrapKey, "session-v1")` where `wrapKey` is the existing keytar-held 32-byte secret the shell already passes to the host — so no change to `apps/desktop/main.cjs`, and the file is useless without the OS credential store. Honest limit: an attacker with *both* the credential store and the data dir gets the refresh token, exactly as they get the BYO key today. Rotation + reuse detection bounds that to one refresh. Moving it to its own credential-store slot is strictly better and is open question 2.

**The access token is never written to disk.** It lives in host process memory only. A cold start always refreshes.

**New host routes** in `packages/host/src/router.ts`, handlers in a new `packages/host/src/handlers/auth.ts`:

- `POST /api/v1/auth/device/start` → `handlePostAuthDeviceStart` (calls the portal, returns `user_code` + `verification_uri` to the renderer, starts the poll in the background)
- `GET  /api/v1/auth/device/status` → `handleGetAuthDeviceStatus` (poll state for the UI: `pending | approved | denied | expired | error` + reason)
- `POST /api/v1/auth/device/cancel` → `handlePostAuthDeviceCancel`
- `GET  /api/v1/auth/session` → `handleGetAuthSession` (masked: ids, email, org name, seats, device label, `expiresAt` — **never** tokens)
- `POST /api/v1/auth/logout` → `handlePostAuthLogout`
- `GET  /api/v1/auth/tenant-config` → `handleGetAuthTenantConfig` (serves the cache, revalidates in background)

The renderer reaches these through `apps/web/lib/api-client.ts` like everything else; `apps/web/lib/desktop-bridge.ts` stays the only file touching `window.agentforge`. No token ever crosses IPC.

**Renderer gate.** `apps/web/src/App.tsx:66-93` becomes `setGate(payload.hasOpenai || payload.hasSession ? "app" : "onboarding")`. `hasSession` is added to the `GET /api/v1/settings` response by `packages/host/src/handlers/settings.ts` and read purely from disk — no network, so the gate decision is as fast offline as online. The shell's `host-status.json` (`apps/desktop/main.cjs:429-433`) keeps writing `hasOpenai` unchanged; it is a shell status file and gains nothing here.

**Choosing the `/v1` Bearer.** One choke point: `resolveProviderKeys` in `packages/core/src/secrets.ts:277`, called from `packages/core/src/runtime/create-runtime.ts:33`. Rule, in order:

1. Workspace has an explicit `openaiApiKey` **and** `tenant_config.feature_flags.allow_byo_key` is not `false` → use the BYO key (explicit user intent).
2. Live session exists → use the in-memory access token, base URL from the session's tenant config.
3. Neither → stub mode, as today.

This ordering does not create a seat-cap loophole: a BYO key carries no `oid`, so it cannot spend the org wallet and the call is not billed to an org. Where it *is* billed is open question 9 — do not write client or portal code that assumes a per-user wallet, because there is none. An org that wants BYO blocked sets `allow_byo_key: false`, and rule 1 then falls through to rule 2.

**Boot sequence and timeouts.** Nothing below blocks first paint.

| Phase | Work | Timeout |
|---|---|---|
| t=0 | read `session.enc` + `device.json` from disk; `GET /api/v1/settings` answers `hasSession` | none (local) |
| t=0 | UI renders from cached `tenantConfig` | none |
| after first paint | background refresh if the access token is absent or expiring | 3 s, `maxRetries: 0` |
| after first paint | `GET /tenant/config` with `If-None-Match` | 3 s |
| lazily, on first `/v1` use | ensure a fresh access token; refresh inline if needed | 5 s |

3 s matches the existing account/billing budget (`packages/core/src/gateway/account.ts:7`), which the settings request already waits on. Background refresh timer: fire at `exp − 5 min`; on failure back off 30 s → 2 min → 10 min → 30 min with jitter.

**Offline.** The app stays signed in on the cached session for a **7-day grace** measured from `lastRefreshOkAt`. During grace the gate is open, cached tenant config drives branding and the model list, local features work, and `/v1` calls fail with the normal network error. Past 7 days without a successful refresh the app shows a non-blocking "Reconnect to continue" banner but still does not force onboarding — only an explicit server `401` with a terminal reason clears the session.

**Logout / revoke UX.** Sign out calls `POST /auth/logout`, then deletes `session.enc` but **keeps `device.json`** — the `install_id` survives, so the next login's upsert on `(user_id, install_id)` lands on the same `devices` row and the same `device_id` (the stored `device_id` itself goes with `session.enc`; it is re-issued by the token response). A terminal `401` from refresh or from `/v1` does the same deletion locally and surfaces the reason-code copy from the table above. If a BYO key is still set for the workspace, the app silently falls back to it rather than showing onboarding.

## Security notes

| Threat | Mitigation |
|---|---|
| Stolen `settings.enc` / `session.enc` from disk | Both are AES-256-GCM under a key held in the OS credential store; the files alone are inert. Session theft is additionally bounded by rotation + reuse detection: the first use by either party kills the chain and the real user sees a forced sign-out. |
| Stolen keychain wrap key **and** data dir | Full compromise of that machine's session, same as today's BYO key. Bounded by: 1 h access tokens, per-user spend cap, `device_revoked` from the admin console, and the audit trail. Proper fix is the per-device keypair (open question 2). |
| `user_code` phishing ("read me this code") | 8-char codes over a 32-char alphabet = 2^40, 10 min TTL, so brute force is impractical. The `/activate` page shows platform, label, and IP-derived city of the *requesting* device plus an explicit "only continue if you started this" warning, and the approval screen repeats it. Rate limit 10 approvals / 10 min per portal user. Codes are single-use and redeemed atomically. Residual risk is accepted; it is the known weakness of RFC 8628 and the mitigation is the warning copy plus the audit trail. |
| OTP brute force / mailbox spray | `login_otps.attempts` is capped at 5 by a CHECK, the code dies at 10 minutes, and sends are limited to 3 / 15 min per address, counted from the rows themselves. Only `sha256(code)` is stored, so a dump of the table signs nobody in; `tenant_readonly` has no grant on it at all. |
| Polling abuse / device-code enumeration | Unknown `device_code_hash` returns a constant-time `invalid_grant` and never reveals whether a code exists. Rate limits per IP and per install_id; >2 polls per interval → `slow_down`; >200 polls → force-expire and audit. No `devices` row is created before approval, so polling cannot enumerate or consume seats. |
| Replay of a redeemed `device_code` | `status='redeemed'` is set in the same transaction that issues the session; a second presentation returns `invalid_grant` and audits `device_code.replayed`. |
| Refresh replay | `rotate_refresh_token` reuse detection revokes the whole chain and the session (diagram c). |
| Clock skew | The gateway allows ±120 s on `exp`/`iat`. The client refreshes at `exp − 5 min` and, if it ever sees a `401` with an expiry reason while its own clock says the token is fresh, refreshes immediately instead of trusting local time. Never gate anything on the client clock alone. |
| Downgrade to BYO key to dodge the seat cap | Not a loophole by construction: a BYO key carries no `oid`, so it cannot spend the org wallet, cannot see org models beyond what that key already buys, and gets no support. An org that wants it blocked sets `tenant_config.feature_flags.allow_byo_key = false`, which the client honours in `resolveProviderKeys`; server-side, a gateway API key with a null `org_id` is never billed to an org — `usage` rows on that path carry `api_key_id` and no `org_id`, and `wallet_ledger.org_id` is NOT NULL, so no wallet in this database can receive the charge. What *does* receive it is open question 9. |
| Token leakage to the renderer | Tokens exist only in the host process. `MaskedSecrets` (`packages/core/src/secrets.ts:64-88`) grows no token field, and `GET /api/v1/auth/session` returns identifiers and expiry only. |
| TLS downgrade / SSRF on portal calls | Reuse `assertAllowedEndpointUrl` (`packages/core/src/security/tls.ts`), already applied to gateway calls. Portal origin is pinned from brand config, not user input. |
| Log leakage | Reuse `redactSecrets` (`packages/core/src/security/redact.ts`) on every auth response before logging. `user_code`, `device_code`, refresh tokens and JWTs are never logged at any level. |

## Open questions for Rizky

1. **Grace window.** 7 days offline before the "Reconnect" banner — right for Indonesian field use, or longer? Does an `org_past_due` org keep working through grace, or stop at the next refresh?
2. **Credential-store slot for a device keypair.** The v1.1 DPoP-style binding needs one more OS-credential-store account, which means touching `apps/desktop/main.cjs`. Is that an acceptable shell change, or do we stay with the wrap-key-derived `session.enc` indefinitely?
3. **BYO key precedence.** Confirmed that an explicitly pasted workspace key beats the session token? The alternative (session always wins) is safer for org spend visibility but surprises a user who just pasted a key.
4. **Seat cap semantics.** A user idle 30 days silently frees their seat (`count_active_users` counts sessions with `last_seen_at > now() - interval '30 days'`), and their next launch may fail `seat_cap_reached` through no fault of theirs. Acceptable, or should an existing session hold its seat until explicitly revoked?
5. **OTP delivery.** Email only, or WhatsApp/SMS for partners whose users do not check email? That changes the OTP table and the abuse model.
6. **`/activate` on the same origin.** `api.tokotokenai.com/activate` is an API host serving a branded HTML page. Should whitelabel partners get their own activation domain (`portal.metranet.co.id/activate`) for trust, which means per-tenant TLS and CORS?
7. **Device limit per user.** Nothing here caps devices per user. Do we need a per-org `max_devices_per_user`, or is the seat cap enough?
8. **Admin notification on `seat_cap_reached`.** Email to org admins on every denied activation could be noisy. Digest instead, or portal-only?
9. **BYO-key metering and the wallet — unresolved; nothing may assume an answer.** `wallet_ledger.org_id` is NOT NULL and there is no per-user wallet, so BYO-key spend cannot land on "the user's own wallet" anywhere in this database; `usage` rows on that path carry `api_key_id` and no `org_id`, so they cannot charge a wallet either. Two candidate answers: (a) **billed entirely outside this database** — the pasted key's own upstream billing relationship pays, and `usage` rows are kept as evidence only; or (b) **a shadow org per BYO user** — one org row per BYO user, which gives the path a wallet and a ledger at the cost of a seat-counting and support-boundary question. Until this is decided, neither the login flow nor the client may state where BYO spend lands. Mirrored in `schema.md`, open question 7.

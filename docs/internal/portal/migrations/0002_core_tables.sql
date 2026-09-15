-- 0002_core_tables.sql
-- Identity and authorization core: tenants, tenant_config, orgs, users, devices,
-- sessions, refresh_tokens, device_codes, api_keys.
--
-- Enum style: text + CHECK, not native enum types.
-- why: ALTER TYPE ... ADD VALUE cannot be rolled back inside a transaction and values can never
-- be removed; a CHECK constraint is edited with a single DROP/ADD in one transactional migration,
-- reads plainly in psql, and needs no cast when compared against a bound parameter.

BEGIN;

----------------------------------------------------------------------
-- tenants
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  db_role       text,
  residency     text NOT NULL DEFAULT 'id-jakarta',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  suspended_at  timestamptz,
  CONSTRAINT tenants_slug_format_chk CHECK (slug ~ '^[a-z][a-z0-9_]{1,30}$'),
  CONSTRAINT tenants_status_chk CHECK (status IN ('active','suspended')),
  CONSTRAINT tenants_residency_chk CHECK (residency IN ('id-jakarta','sg','dedicated'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_slug ON tenants (slug);

COMMENT ON TABLE tenants IS
  'Whitelabel partner (Toko Token, JAST, Hypernet, Metranet). Root of every RLS scope.';
COMMENT ON COLUMN tenants.slug IS 'Also the suffix of the per-tenant DB role tenant_<slug>.';
COMMENT ON COLUMN tenants.status IS 'login_precheck returns tenant_inactive when not active.';
COMMENT ON COLUMN tenants.residency IS 'dedicated = Enterprise upsell, served from its own instance.';

----------------------------------------------------------------------
-- tenant_config
----------------------------------------------------------------------
-- why a separate 1:1 table instead of jsonb on tenants: it is fetched on every login
-- (read-mostly, cacheable, replicable), it is edited by a different actor than tenants.status,
-- and keeping three jsonb blobs out of `tenants` keeps the hot auth row narrow and un-TOASTed.
CREATE TABLE IF NOT EXISTS tenant_config (
  tenant_id        uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  version          integer NOT NULL DEFAULT 1,
  branding         jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_allowlist  jsonb NOT NULL DEFAULT '[]'::jsonb,
  feature_flags    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_config_branding_obj_chk CHECK (jsonb_typeof(branding) = 'object'),
  CONSTRAINT tenant_config_allowlist_arr_chk CHECK (jsonb_typeof(model_allowlist) = 'array'),
  CONSTRAINT tenant_config_flags_obj_chk CHECK (jsonb_typeof(feature_flags) = 'object'),
  CONSTRAINT tenant_config_version_chk CHECK (version >= 1)
);

COMMENT ON TABLE tenant_config IS
  'Per-tenant branding, model allowlist and feature flags returned to the client at login.';
COMMENT ON COLUMN tenant_config.version IS
  'Bumped on every write; the client echoes it so the portal can answer 304-style.';
COMMENT ON COLUMN tenant_config.model_allowlist IS
  'JSON array of model ids the tenant may call; the gateway intersects it with /v1/models.';
COMMENT ON COLUMN tenant_config.feature_flags IS
  'Tenant-level gates: admin_console, usage_reports, audit_export, spend_caps, model_allowlist,
   sentinel_filtering, residency, allow_byo_key -- all boolean -- plus sso_provider, the one
   non-boolean flag: NULL means no SSO, a string names the tenant OIDC provider that /activate
   redirects to. There is no separate boolean `sso`; sso_provider IS NOT NULL is the gate.
   Org rows may narrow these, never widen them.';

----------------------------------------------------------------------
-- orgs
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orgs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  name                     text NOT NULL,
  slug                     text NOT NULL,
  status                   text NOT NULL DEFAULT 'active',
  plan                     text NOT NULL DEFAULT 'free',
  seat_cap                 integer NOT NULL DEFAULT 20,
  seat_band                integer NOT NULL DEFAULT 20,
  billing_email            citext,
  currency                 text NOT NULL DEFAULT 'USD',
  past_due_since           timestamptz,
  default_spend_cap_micros bigint,
  default_rate_limit_rpm   integer NOT NULL DEFAULT 60,
  feature_flags            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  suspended_at             timestamptz,
  CONSTRAINT orgs_status_chk CHECK (status IN ('active','past_due','suspended')),
  CONSTRAINT orgs_plan_chk CHECK (plan IN ('free','business','enterprise')),
  CONSTRAINT orgs_seat_cap_chk CHECK (seat_cap > 0 AND seat_cap <= 100000),
  CONSTRAINT orgs_seat_band_chk CHECK (seat_band >= seat_cap),
  CONSTRAINT orgs_currency_chk CHECK (currency IN ('USD','IDR')),
  CONSTRAINT orgs_past_due_chk CHECK ((status = 'past_due') = (past_due_since IS NOT NULL)),
  CONSTRAINT orgs_flags_obj_chk CHECK (jsonb_typeof(feature_flags) = 'object'),
  CONSTRAINT orgs_rate_limit_chk CHECK (default_rate_limit_rpm > 0),
  CONSTRAINT orgs_spend_cap_chk CHECK (default_spend_cap_micros IS NULL OR default_spend_cap_micros >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orgs_tenant_slug ON orgs (tenant_id, slug);
CREATE INDEX IF NOT EXISTS ix_orgs_tenant_status ON orgs (tenant_id, status);

COMMENT ON TABLE orgs IS
  'Billing and seat boundary inside a tenant. Owns the wallet, the seat cap and the plan gates.';
COMMENT ON COLUMN orgs.status IS
  'active | past_due | suspended -> reason codes org_past_due / org_inactive.';
COMMENT ON COLUMN orgs.plan IS
  'free | business | enterprise. Plan gates (admin_console, usage_reports, audit_export,
   sso_provider, spend_caps, model_allowlist, sentinel_filtering, residency, allow_byo_key)
   resolve from feature_flags with
   plan as the default source -- deliberately columns/flags, not entitlement tables, because
   they are read on every login and never joined against.';
COMMENT ON COLUMN orgs.seat_cap IS
  'Hard ceiling on active users. Free ships at 20 seats; tokens are still paid from the wallet.';
COMMENT ON COLUMN orgs.seat_band IS 'Contracted graduated band used for invoicing, >= seat_cap.';

----------------------------------------------------------------------
-- users
----------------------------------------------------------------------
-- why single-org (no org_memberships): the access token carries exactly one `oid`, seat counting
-- and the per-user spend cap are both per-org, and the device-code flow has no screen on which to
-- pick an org. Someone who needs two orgs gets two user rows. If multi-org ever lands, add
-- org_memberships(user_id, org_id, role) and demote users.org_id to "default org"; no other table
-- in this schema changes, because every row already carries org_id explicitly.
CREATE TABLE IF NOT EXISTS users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  org_id           uuid NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  email            citext NOT NULL,
  display_name     text,
  status           text NOT NULL DEFAULT 'invited',
  role             text NOT NULL DEFAULT 'member',
  external_subject text,
  spend_cap_micros bigint,
  spend_window     text NOT NULL DEFAULT 'month',
  rate_limit_rpm   integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deactivated_at   timestamptz,
  CONSTRAINT users_status_chk CHECK (status IN ('invited','active','disabled')),
  CONSTRAINT users_role_chk CHECK (role IN ('owner','admin','member')),
  CONSTRAINT users_spend_window_chk CHECK (spend_window IN ('day','month')),
  CONSTRAINT users_spend_cap_chk CHECK (spend_cap_micros IS NULL OR spend_cap_micros >= 0),
  CONSTRAINT users_rate_limit_chk CHECK (rate_limit_rpm IS NULL OR rate_limit_rpm > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_email ON users (tenant_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_external_subject
  ON users (tenant_id, external_subject) WHERE external_subject IS NOT NULL;
-- why: the seat query filters on exactly this predicate; a partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS ix_users_org_active ON users (org_id) WHERE status = 'active';

COMMENT ON TABLE users IS
  'A person inside exactly one org. status <> active -> reason code user_inactive.';
COMMENT ON COLUMN users.external_subject IS 'SSO/OIDC subject, when the tenant has SSO enabled.';
COMMENT ON COLUMN users.spend_cap_micros IS
  'Per-user cap in micro-USD; NULL falls back to orgs.default_spend_cap_micros, NULL = uncapped.';
COMMENT ON COLUMN users.rate_limit_rpm IS
  'Per-user requests/minute; NULL falls back to orgs.default_rate_limit_rpm.';

----------------------------------------------------------------------
-- devices
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  org_id         uuid NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  install_id     text NOT NULL,
  label          text,
  platform       text NOT NULL,
  os_version     text,
  app_version    text,
  status         text NOT NULL DEFAULT 'active',
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_reason text,
  CONSTRAINT devices_platform_chk CHECK (platform IN ('windows','macos','linux','android','ios','web')),
  CONSTRAINT devices_status_chk CHECK (status IN ('active','revoked')),
  CONSTRAINT devices_revoked_chk CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT devices_install_id_chk CHECK (length(install_id) BETWEEN 8 AND 128)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_user_install ON devices (user_id, install_id);
CREATE INDEX IF NOT EXISTS ix_devices_org_last_seen ON devices (org_id, last_seen_at DESC);

COMMENT ON TABLE devices IS
  'One desktop/mobile install bound to one user. Revoking it kills every session on it.';
COMMENT ON COLUMN devices.install_id IS
  'Client-generated uuid persisted in settings.enc (AES-256-GCM, keytar-wrapped). The client has
   no device id today; the device-code login flow introduces it. Opaque to the server.';
COMMENT ON COLUMN devices.status IS 'revoked -> reason code device_revoked.';

----------------------------------------------------------------------
-- sessions
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  org_id              uuid NOT NULL REFERENCES orgs(id) ON DELETE RESTRICT,
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id           uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  scope               text NOT NULL DEFAULT 'app',
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days',
  revoked_at          timestamptz,
  revoked_reason      text,
  last_ip             inet,
  last_user_agent     text,
  CONSTRAINT sessions_revoked_reason_chk CHECK (
    revoked_reason IS NULL OR revoked_reason IN (
      'session_revoked','device_revoked','user_inactive','org_inactive','org_past_due',
      'seat_cap_reached','tenant_inactive','refresh_reused','refresh_expired','logout','admin')
  )
);

-- why: this is the seat-count driver. Partial on revoked_at IS NULL keeps only live sessions and
-- (user_id, last_seen_at DESC) lets the EXISTS probe stop at the first index tuple.
CREATE INDEX IF NOT EXISTS ix_sessions_user_live
  ON sessions (user_id, last_seen_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sessions_org_live
  ON sessions (org_id, last_seen_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sessions_device_live
  ON sessions (device_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE sessions IS
  'One login chain: user + device. Access tokens carry its id as the `sid` claim; the refresh
   rotation chain hangs off it. revoked_at set -> reason code session_revoked.';
COMMENT ON COLUMN sessions.absolute_expires_at IS
  'Hard 90-day ceiling. The 30-day refresh TTL slides; this does not.';
COMMENT ON COLUMN sessions.last_seen_at IS
  'Touched on every refresh and (debounced) by the gateway. Drives the 30-day active-user
   definition used for seat counting.';

----------------------------------------------------------------------
-- refresh_tokens
----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  session_id     uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash     bytea NOT NULL,
  generation     integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  replaced_by    uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  revoked_at     timestamptz,
  revoked_reason text,
  CONSTRAINT refresh_tokens_hash_len_chk CHECK (octet_length(token_hash) = 32),
  CONSTRAINT refresh_tokens_generation_chk CHECK (generation >= 1),
  CONSTRAINT refresh_tokens_replaced_chk CHECK (replaced_by IS NULL OR used_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_session ON refresh_tokens (session_id, generation DESC);
CREATE INDEX IF NOT EXISTS ix_refresh_tokens_expiry ON refresh_tokens (expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE refresh_tokens IS
  'Rotation chain per session. Raw token = 32 random bytes base64url, kept only in the OS keychain;
   the DB stores sha256(raw). TTL 30 days sliding, capped by sessions.absolute_expires_at (90 d).';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'sha256 of the raw token, exactly 32 bytes.';
COMMENT ON COLUMN refresh_tokens.used_at IS
  'Set when the token is spent. Presenting a row with used_at IS NOT NULL is reuse: the whole
   chain and the session are revoked and the caller gets refresh_reused.';
COMMENT ON COLUMN refresh_tokens.replaced_by IS 'Successor token id, for forensic chain walking.';

----------------------------------------------------------------------
-- device_codes
----------------------------------------------------------------------
-- why tenant_id is nullable here and nowhere else: the app starts the device-code flow before
-- anyone has authenticated, so the tenant is unknown until the browser half approves. The row is
-- reachable only by portal_app (0004 grants tenant_readonly nothing on this table), and the RLS
-- policy exposes the NULL window only to portal_app, so nothing crosses a tenant boundary.
CREATE TABLE IF NOT EXISTS device_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid REFERENCES tenants(id) ON DELETE CASCADE,
  device_code_hash bytea NOT NULL,
  user_code        text NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  org_id           uuid REFERENCES orgs(id) ON DELETE SET NULL,
  device_id        uuid REFERENCES devices(id) ON DELETE SET NULL,
  session_id       uuid REFERENCES sessions(id) ON DELETE SET NULL,
  install_id       text,
  client_name      text,
  client_version   text,
  requested_scope  text NOT NULL DEFAULT 'app',
  interval_seconds integer NOT NULL DEFAULT 5,
  poll_count       integer NOT NULL DEFAULT 0,
  last_polled_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  approved_at      timestamptz,
  denied_at        timestamptz,
  used_at          timestamptz,
  created_ip       inet,
  approved_ip      inet,
  CONSTRAINT device_codes_hash_len_chk CHECK (octet_length(device_code_hash) = 32),
  -- 8 chars from an unambiguous alphabet (no 0, O, 1, I), rendered XXXX-XXXX.
  CONSTRAINT device_codes_user_code_chk CHECK (
    user_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'),
  CONSTRAINT device_codes_status_chk CHECK (status IN ('pending','approved','denied','redeemed','expired')),
  CONSTRAINT device_codes_interval_chk CHECK (interval_seconds BETWEEN 1 AND 60),
  CONSTRAINT device_codes_approved_chk CHECK (
    status NOT IN ('approved','redeemed')
    OR (tenant_id IS NOT NULL AND user_id IS NOT NULL AND org_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_device_codes_device_hash ON device_codes (device_code_hash);
-- why: user_code only has to be unique among codes someone can still type in; a partial unique
-- index lets the 8-char space be recycled instead of exhausted.
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_codes_user_code_live
  ON device_codes (user_code) WHERE status IN ('pending','approved');
CREATE INDEX IF NOT EXISTS ix_device_codes_expiry ON device_codes (expires_at)
  WHERE status IN ('pending','approved');

COMMENT ON TABLE device_codes IS
  'Pending device authorizations. device_code = 32 random bytes stored as sha256; user_code is
   8 unambiguous chars formatted XXXX-XXXX; TTL 10 minutes; poll interval 5 s.';
COMMENT ON COLUMN device_codes.last_polled_at IS
  'Polling faster than interval_seconds returns slow_down; the portal bumps interval_seconds by 5
   each time it fires.';
COMMENT ON COLUMN device_codes.status IS
  'pending -> authorization_pending, expired -> device_code_expired, denied -> device_code_denied,
   redeemed -> the code was already exchanged for a session.';

----------------------------------------------------------------------
-- login_otps
----------------------------------------------------------------------
-- The /activate page signs a user in with e-mail + a 6-digit one-time code. There is deliberately
-- no password column anywhere in this schema (see device-code-login.md, "Sign-in method").
-- why tenant_id is NOT NULL here although device_codes allows a NULL one: an OTP is only minted
-- after /activate has resolved a tenant -- from the device code's tenant_hint, or from the single
-- `users` row matching the address. When an address matches users in more than one tenant the
-- portal sends nothing and still renders the neutral "check your e-mail" page, so this table never
-- holds the pre-authentication NULL window that device_codes has to.
-- why a hash and never the code: for ten minutes this row is password-equivalent. The raw six
-- digits exist only in the e-mail; a dump of this table signs nobody in.
CREATE TABLE IF NOT EXISTS login_otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  otp_hash    bytea NOT NULL,
  purpose     text NOT NULL DEFAULT 'activate',
  attempts    integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  created_ip  inet,
  CONSTRAINT login_otps_hash_len_chk CHECK (octet_length(otp_hash) = 32),
  -- five wrong guesses burn the code; a sixth verify can never succeed.
  CONSTRAINT login_otps_attempts_chk CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT login_otps_purpose_chk CHECK (purpose IN ('activate','portal_login')),
  CONSTRAINT login_otps_consumed_chk CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

-- why one index on (tenant_id, email, created_at DESC) rather than two: it serves both reads this
-- table ever gets -- "the newest unconsumed code for this address" at verify time, and "how many
-- codes went to this address since now() - 15 minutes" for the 3-sends-per-15-minutes send limit,
-- which is a bounded range scan over the same prefix. The send limit is therefore counted from the
-- rows themselves and needs no counter column; it is also why pruning must keep the last 15
-- minutes of consumed rows (prune_login_otps() in 0005 keeps 24 h).
CREATE INDEX IF NOT EXISTS ix_login_otps_tenant_email
  ON login_otps (tenant_id, email, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_login_otps_expiry ON login_otps (expires_at)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE login_otps IS
  'E-mail one-time codes for the /activate sign-in. 6 digits, 10-minute TTL, 5 verify attempts,
   single use, 3 sends per 15 minutes per address. Only sha256(code) is stored.';
COMMENT ON COLUMN login_otps.otp_hash IS 'sha256 of the 6-digit code, exactly 32 bytes. Never the code.';
COMMENT ON COLUMN login_otps.attempts IS
  'Wrong verifies so far. At 5 the code is dead; the user must request a new one.';
COMMENT ON COLUMN login_otps.consumed_at IS
  'Set in the same transaction that signs the user in, which is what makes the code single-use.';

----------------------------------------------------------------------
-- jwks_keys
----------------------------------------------------------------------
-- Ed25519 signing keys for the access tokens, published at /.well-known/jwks.json.
-- why this table is NOT tenant-scoped: one portal signs every tenant's access tokens from one key
-- set, and the gateway must verify a token's signature *before* it knows which tenant the token
-- belongs to, so a tenant predicate here would be unsatisfiable on the only path that reads it.
-- 0004 therefore leaves jwks_keys out of the RLS loop on purpose (see the comment there). The
-- table holds no tenant data: public keys, a status, and a pointer into the secret store.
-- why private_key_ref and never the key: the private half lives in the KMS / secret manager. It is
-- never in a row, a base backup, or a nightly export, so a dump of this table signs nothing.
-- Rotation windows (device-code-login.md, "Key rotation"): a key is published 24 h before it may
-- sign (status 'next', publish_at = activate_at - 24 h) and stays published 24 h after it stops
-- signing (status 'retired', unpublish_at = retired_at + 24 h). That is what lets a gateway with an
-- hour-stale JWKS cache never meet an unknown kid and never reject a token signed by the key it is
-- replacing. The document served at /.well-known/jwks.json is exactly:
--   SELECT kid, public_key FROM jwks_keys
--    WHERE publish_at <= now() AND (unpublish_at IS NULL OR unpublish_at > now());
CREATE TABLE IF NOT EXISTS jwks_keys (
  kid             text PRIMARY KEY,
  alg             text NOT NULL DEFAULT 'EdDSA',
  public_key      bytea NOT NULL,
  private_key_ref text NOT NULL,
  status          text NOT NULL DEFAULT 'next',
  publish_at      timestamptz NOT NULL DEFAULT now(),
  activate_at     timestamptz,
  retired_at      timestamptz,
  unpublish_at    timestamptz,
  rotated_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jwks_keys_kid_chk CHECK (kid ~ '^[A-Za-z0-9._-]{4,64}$'),
  CONSTRAINT jwks_keys_alg_chk CHECK (alg = 'EdDSA'),
  CONSTRAINT jwks_keys_status_chk CHECK (status IN ('active','next','retired')),
  -- raw Ed25519 public key, 32 bytes; base64url-encoded into the JWK `x` member at serve time.
  CONSTRAINT jwks_keys_public_key_len_chk CHECK (octet_length(public_key) = 32),
  CONSTRAINT jwks_keys_retired_chk CHECK ((status = 'retired') = (retired_at IS NOT NULL)),
  -- the 24 h post-retirement window: a retired key stays in the document until unpublish_at.
  CONSTRAINT jwks_keys_unpublish_chk CHECK (
    unpublish_at IS NULL OR (retired_at IS NOT NULL AND unpublish_at >= retired_at)),
  -- the 24 h pre-publish window: a key is in the document before it is allowed to sign.
  CONSTRAINT jwks_keys_publish_chk CHECK (activate_at IS NULL OR publish_at <= activate_at)
);

-- why a partial unique index: exactly one key may be signing at any moment. 'next' and 'retired'
-- are deliberately unconstrained -- an emergency rotation can leave two keys inside the retirement
-- window at once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_jwks_keys_active ON jwks_keys (status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_jwks_keys_publish ON jwks_keys (publish_at DESC);

COMMENT ON TABLE jwks_keys IS
  'Portal-wide Ed25519 access-token signing keys. NOT tenant-scoped and deliberately excluded from
   RLS in 0004: the gateway verifies a signature before it knows the tenant. 90-day cadence, with a
   24 h pre-publish and a 24 h post-retirement window either side of the signing period.';
COMMENT ON COLUMN jwks_keys.kid IS 'JWT header `kid`, e.g. 2026-09-a. Stable for the life of the key.';
COMMENT ON COLUMN jwks_keys.private_key_ref IS
  'Reference into the KMS / secret manager (e.g. a key URI or secret name). Never the private key.';
COMMENT ON COLUMN jwks_keys.status IS
  'next -> published but not yet signing; active -> the one signing key; retired -> no longer signs
   but is still published until unpublish_at.';
COMMENT ON COLUMN jwks_keys.publish_at IS 'When the key enters JWKS: 24 h before activate_at.';
COMMENT ON COLUMN jwks_keys.unpublish_at IS
  'When the key leaves JWKS: retired_at + 24 h normally, retired_at itself on a compromise.';
COMMENT ON COLUMN jwks_keys.rotated_at IS
  'Last status transition (next -> active -> retired), for the rotation audit.';

----------------------------------------------------------------------
-- api_keys
----------------------------------------------------------------------
-- Three shapes, discriminated by `kind`:
--   tenant : org_id NULL, user_id NULL -- the BYO-key door. No seat, no org, no support.
--   org    : org_id set, user_id NULL  -- server-to-server key owned by an org.
--   user   : org_id set, user_id set   -- a key issued to one member.
-- This is the row behind the Bearer-key calls the client already makes today
-- (GET /api/usage/token, /v1/models), so the org-less shape must keep working unchanged.
CREATE TABLE IF NOT EXISTS api_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  org_id           uuid REFERENCES orgs(id) ON DELETE CASCADE,
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  kind             text NOT NULL,
  key_prefix       text NOT NULL,
  key_hash         bytea NOT NULL,
  name             text,
  scopes           text[] NOT NULL DEFAULT ARRAY['chat','models']::text[],
  spend_cap_micros bigint,
  rate_limit_rpm   integer,
  status           text NOT NULL DEFAULT 'active',
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  revoked_reason   text,
  CONSTRAINT api_keys_kind_chk CHECK (kind IN ('tenant','org','user')),
  CONSTRAINT api_keys_status_chk CHECK (status IN ('active','revoked')),
  CONSTRAINT api_keys_hash_len_chk CHECK (octet_length(key_hash) = 32),
  CONSTRAINT api_keys_prefix_chk CHECK (key_prefix ~ '^[a-z]{2,6}_(live|test)_[A-Za-z0-9]{8}$'),
  CONSTRAINT api_keys_shape_chk CHECK (
    (kind = 'tenant' AND org_id IS NULL     AND user_id IS NULL) OR
    (kind = 'org'    AND org_id IS NOT NULL AND user_id IS NULL) OR
    (kind = 'user'   AND org_id IS NOT NULL AND user_id IS NOT NULL)
  ),
  CONSTRAINT api_keys_revoked_chk CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT api_keys_spend_cap_chk CHECK (spend_cap_micros IS NULL OR spend_cap_micros >= 0),
  CONSTRAINT api_keys_rate_limit_chk CHECK (rate_limit_rpm IS NULL OR rate_limit_rpm > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_hash ON api_keys (key_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_api_keys_prefix ON api_keys (key_prefix);
CREATE INDEX IF NOT EXISTS ix_api_keys_org_active ON api_keys (org_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_api_keys_tenant_kind ON api_keys (tenant_id, kind, status);

COMMENT ON TABLE api_keys IS
  'Bearer keys for the gateway. kind=tenant is the BYO-key door (no user, no org, no seat);
   kind=org/user are portal-issued. The raw key is shown once; the DB stores sha256(raw).';
COMMENT ON COLUMN api_keys.key_prefix IS
  'Non-secret display prefix (e.g. ttai_live_A1b2C3d4) used for lookup hints and support.';
COMMENT ON COLUMN api_keys.scopes IS
  'Coarse scopes; the gateway intersects them with tenant_config.model_allowlist.';

----------------------------------------------------------------------
-- updated_at trigger
----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION set_updated_at() IS 'BEFORE UPDATE trigger: stamps updated_at = now().';

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','tenant_config','orgs','users','devices','api_keys'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON %1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
         FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END
$do$;

COMMIT;

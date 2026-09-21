-- 0006_browser_login.sql
-- Tables the browser half of the login needs and `docs/internal/portal/migrations/0001-0005`
-- does not have yet. Same style as those files: one transaction, IF NOT EXISTS everywhere,
-- DROP POLICY before every CREATE POLICY, text + CHECK instead of native enums, and every table
-- placed explicitly into one of the three RLS shapes 0004 names.
--
-- Added here rather than by editing 0002-0005, because those five files are the backend team's
-- and must keep applying byte-for-byte.
--
--   oauth_clients : the confidential client the product authenticates as (`web-phase9-portal-login.md`).
--   auth_codes    : the 60 s single-use authorization code of the browser flow, bound to
--                   client_id + redirect_uri + sha256(state).
--   device_codes  : two additions -- `platform`, and the poll-window counters that make
--                   "more than 2 polls inside one interval window -> slow_down" countable.

BEGIN;

----------------------------------------------------------------------
-- oauth_clients
----------------------------------------------------------------------
-- why a hash and never the secret: the same rule the whole schema already follows for api_keys,
-- refresh_tokens and login_otps. The raw secret is printed once by `pnpm portal:seed` and lives
-- in the product's environment; a dump of this table authenticates nobody.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id      text PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  secret_hash    bytea NOT NULL,
  redirect_uris  text[] NOT NULL,
  status         text NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  CONSTRAINT oauth_clients_id_chk CHECK (client_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  CONSTRAINT oauth_clients_secret_len_chk CHECK (octet_length(secret_hash) = 32),
  CONSTRAINT oauth_clients_status_chk CHECK (status IN ('active','revoked')),
  CONSTRAINT oauth_clients_revoked_chk CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  -- why non-empty: an allowlist that can be empty is an allowlist someone forgot to fill in, and
  -- the /authorize handler would then have nothing to compare a redirect_uri against.
  CONSTRAINT oauth_clients_redirects_chk CHECK (array_length(redirect_uris, 1) >= 1)
);

CREATE INDEX IF NOT EXISTS ix_oauth_clients_tenant ON oauth_clients (tenant_id, status);

COMMENT ON TABLE oauth_clients IS
  'Confidential clients for the browser login. secret_hash is sha256 of the raw secret, shown once.';
COMMENT ON COLUMN oauth_clients.redirect_uris IS
  'Exact-match allowlist. /authorize refuses any redirect_uri not in this array -- no prefix rule,
   no wildcard: an open redirect here hands an attacker the authorization code.';

----------------------------------------------------------------------
-- auth_codes
----------------------------------------------------------------------
-- The browser counterpart of device_codes: 60 s, single use, and bound to the three things that
-- make a stolen code useless -- the client it was issued to, the redirect_uri it was issued for,
-- and sha256 of the `state` the host put in its __Host- cookie.
-- why state_hash and not state: `state` is a login-CSRF nonce, and the host is the only party that
-- needs to read it back. Storing the hash keeps this table useless to anyone who dumps it.
CREATE TABLE IF NOT EXISTS auth_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  code_hash    bytea NOT NULL,
  redirect_uri text NOT NULL,
  state_hash   bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '60 seconds',
  consumed_at  timestamptz,
  created_ip   inet,
  CONSTRAINT auth_codes_hash_len_chk CHECK (octet_length(code_hash) = 32),
  CONSTRAINT auth_codes_state_len_chk CHECK (octet_length(state_hash) = 32),
  CONSTRAINT auth_codes_consumed_chk CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auth_codes_hash ON auth_codes (code_hash);
CREATE INDEX IF NOT EXISTS ix_auth_codes_expiry ON auth_codes (expires_at) WHERE consumed_at IS NULL;

COMMENT ON TABLE auth_codes IS
  'Authorization codes for the browser login: 60 s TTL, single use, bound to client_id,
   redirect_uri and sha256(state). Only sha256(code) is stored.';

----------------------------------------------------------------------
-- device_codes additions
----------------------------------------------------------------------
-- `platform` mirrors devices.platform so /activate can show "Windows device" before a devices row
-- exists. Nullable, because the client may not send one and the code is minted pre-authentication.
ALTER TABLE device_codes ADD COLUMN IF NOT EXISTS platform text;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_codes_platform_chk'
  ) THEN
    ALTER TABLE device_codes ADD CONSTRAINT device_codes_platform_chk
      CHECK (platform IS NULL OR platform IN ('windows','macos','linux','android','ios','web'));
  END IF;
END
$do$;

-- why two more columns rather than deriving from poll_count and last_polled_at: the login doc
-- allows *two* polls inside one interval window and only slows the third down, which needs a
-- per-window counter. poll_count is the lifetime total and drives the 200-poll ceiling instead.
ALTER TABLE device_codes ADD COLUMN IF NOT EXISTS poll_window_started_at timestamptz;
ALTER TABLE device_codes ADD COLUMN IF NOT EXISTS poll_window_count integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN device_codes.platform IS
  'Client platform for the /activate confirmation screen; same vocabulary as devices.platform.';
COMMENT ON COLUMN device_codes.poll_window_count IS
  'Polls inside the current interval window. The third one in a window answers slow_down.';

----------------------------------------------------------------------
-- RLS + grants, in the shapes 0004 defines
----------------------------------------------------------------------
-- auth_codes is plain tenant-scoped (tenant_id NOT NULL), so it takes the standard shape.
-- oauth_clients is tenant-scoped too, but it is read by /authorize *before* a tenant is in scope,
-- so it takes the device_codes shape: portal_app may read it unscoped, tenant_readonly gets
-- nothing, and the actual pre-auth lookup goes through the SECURITY DEFINER resolver in 0007.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auth_codes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_%1$s_tenant ON %1$I', t);
    EXECUTE format(
      'CREATE POLICY p_%1$s_tenant ON %1$I FOR ALL
         USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS p_%1$s_admin ON %1$I', t);
    EXECUTE format(
      'CREATE POLICY p_%1$s_admin ON %1$I FOR ALL TO portal_admin
         USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$do$;

ALTER TABLE oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_clients FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_oauth_clients_app ON oauth_clients;
CREATE POLICY p_oauth_clients_app ON oauth_clients
  FOR ALL TO portal_app
  USING (tenant_id = app_tenant_id() OR app_tenant_id() IS NULL)
  WITH CHECK (tenant_id = app_tenant_id());

DROP POLICY IF EXISTS p_oauth_clients_admin ON oauth_clients;
CREATE POLICY p_oauth_clients_admin ON oauth_clients
  FOR ALL TO portal_admin
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON oauth_clients, auth_codes TO portal_app;
GRANT DELETE ON auth_codes TO portal_app;

-- A consumed authorization code and a client secret hash have no business in a nightly export.
REVOKE ALL ON oauth_clients, auth_codes FROM tenant_readonly;

ALTER TABLE oauth_clients OWNER TO portal_admin;
ALTER TABLE auth_codes OWNER TO portal_admin;

COMMIT;

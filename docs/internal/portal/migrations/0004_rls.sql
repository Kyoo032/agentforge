-- 0004_rls.sql
-- Row Level Security + grants.
--
-- Model: every tenant-scoped table has ENABLE + FORCE RLS and one tenant policy reading
-- app_tenant_id(). FORCE also applies the policy to the table owner, so a mis-set search_path or
-- a stray psql session as the owner cannot read across tenants. portal_admin gets an explicit
-- USING (true) policy as well, so the back office works whether or not BYPASSRLS could be granted.

BEGIN;

----------------------------------------------------------------------
-- Policies on tenant-scoped tables
----------------------------------------------------------------------
DO $do$
DECLARE
  t text;
  tenant_scoped text[] := ARRAY[
    'tenants','tenant_config','orgs','users','devices','sessions','refresh_tokens',
    'login_otps','api_keys','wallet_ledger','usage','audit_log'
  ];
  v_col text;
BEGIN
  FOREACH t IN ARRAY tenant_scoped LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- why: `tenants` itself is keyed by id, not tenant_id; same policy shape, different column.
    v_col := CASE WHEN t = 'tenants' THEN 'id' ELSE 'tenant_id' END;

    EXECUTE format('DROP POLICY IF EXISTS p_%1$s_tenant ON %1$I', t);
    EXECUTE format(
      'CREATE POLICY p_%1$s_tenant ON %1$I
         FOR ALL
         USING (%2$I = app_tenant_id())
         WITH CHECK (%2$I = app_tenant_id())', t, v_col);

    EXECUTE format('DROP POLICY IF EXISTS p_%1$s_admin ON %1$I', t);
    EXECUTE format(
      'CREATE POLICY p_%1$s_admin ON %1$I
         FOR ALL TO portal_admin
         USING (true)
         WITH CHECK (true)', t);
  END LOOP;
END
$do$;

----------------------------------------------------------------------
-- device_codes: the one table with a legitimate NULL tenant window
----------------------------------------------------------------------
-- why: the code is minted before anyone has authenticated, so tenant_id is NULL until approval.
-- Only portal_app may see that window, lookups are by a 32-byte device_code_hash or a live
-- user_code, and tenant_readonly gets no grant on this table at all (see grants below).
ALTER TABLE device_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_codes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_device_codes_app ON device_codes;
CREATE POLICY p_device_codes_app ON device_codes
  FOR ALL TO portal_app
  USING (tenant_id IS NULL OR tenant_id = app_tenant_id())
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_tenant_id());

DROP POLICY IF EXISTS p_device_codes_admin ON device_codes;
CREATE POLICY p_device_codes_admin ON device_codes
  FOR ALL TO portal_admin
  USING (true)
  WITH CHECK (true);

----------------------------------------------------------------------
-- login_otps: tenant-scoped, but never readable by a tenant
----------------------------------------------------------------------
-- why no extra policy: login_otps carries tenant_id NOT NULL, so the loop above already gave it
-- ENABLE + FORCE RLS and the standard p_login_otps_tenant policy. What it additionally needs is the
-- same grant treatment as refresh_tokens and device_codes -- portal_app only, nothing for
-- tenant_readonly -- because a live otp_hash is password-equivalent material and has no business
-- in a nightly export. That is done in the grants section below.

----------------------------------------------------------------------
-- jwks_keys: deliberately NOT under RLS
----------------------------------------------------------------------
-- why: jwks_keys is portal-wide, not tenant-scoped. One key set signs every tenant's access tokens,
-- and the gateway verifies a token's signature before it has parsed a `tid` claim -- so there is no
-- tenant in scope when the row is read, and a tenant predicate would make the only read path fail
-- closed on every request. There is nothing tenant-private in the table either: public keys, a
-- status, and a KMS reference. The private keys are not here at all. Enabling RLS would therefore
-- buy no isolation and break token verification, so the table is left out of the loop on purpose
-- rather than by omission. Isolation for it is grants: read-only to portal_app, nothing to
-- tenant_readonly, and rotation performed as portal_admin.
--
-- If a future migration adds a table here, decide explicitly which of these two shapes it is.

----------------------------------------------------------------------
-- usage partitions
----------------------------------------------------------------------
-- why: a policy on the partitioned parent covers access *through* the parent. A direct
-- SELECT on usage_y2026m09 uses that partition's own RLS, so every partition needs its own
-- ENABLE/FORCE + policy. create_usage_partition() is redefined here to do it automatically.
CREATE OR REPLACE FUNCTION secure_usage_partition(p_name text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', p_name);
  EXECUTE format('DROP POLICY IF EXISTS p_%1$s_tenant ON %1$I', p_name);
  EXECUTE format(
    'CREATE POLICY p_%1$s_tenant ON %1$I
       FOR ALL
       USING (tenant_id = app_tenant_id())
       WITH CHECK (tenant_id = app_tenant_id())', p_name);
  EXECUTE format('DROP POLICY IF EXISTS p_%1$s_admin ON %1$I', p_name);
  EXECUTE format(
    'CREATE POLICY p_%1$s_admin ON %1$I FOR ALL TO portal_admin USING (true) WITH CHECK (true)',
    p_name);
  EXECUTE format('GRANT SELECT, INSERT ON %I TO portal_app', p_name);
  EXECUTE format('GRANT SELECT ON %I TO tenant_readonly', p_name);
END
$fn$;

COMMENT ON FUNCTION secure_usage_partition(text) IS
  'Enable/force RLS, install the tenant policy and grant a single usage partition.';

CREATE OR REPLACE FUNCTION create_usage_partition(p_month date)
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name text := format('usage_y%sm%s', to_char(v_from, 'YYYY'), to_char(v_from, 'MM'));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = v_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF usage FOR VALUES FROM (%L) TO (%L)', v_name, v_from, v_to);
    EXECUTE format('COMMENT ON TABLE %I IS %L', v_name,
      format('usage rows for %s (created by create_usage_partition)', to_char(v_from, 'YYYY-MM')));
  END IF;
  PERFORM secure_usage_partition(v_name);
  RETURN v_name;
END
$fn$;

COMMENT ON FUNCTION create_usage_partition(date) IS
  'Create (if absent) and secure the monthly usage partition covering p_month.';

-- Secure the partitions 0003 already created.
DO $do$
DECLARE p text;
BEGIN
  FOR p IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class pr ON pr.oid = i.inhparent
    WHERE pr.relname = 'usage'
  LOOP
    PERFORM secure_usage_partition(p);
  END LOOP;
END
$do$;

----------------------------------------------------------------------
-- Grants: portal_app (the portal API and the /v1 gateway)
----------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON
  tenants, tenant_config, orgs, users, devices, sessions, refresh_tokens, api_keys, device_codes,
  login_otps
  TO portal_app;

-- why: expired rows are pruned, not retained. Everything else is soft-deleted via status columns.
GRANT DELETE ON device_codes, refresh_tokens, login_otps TO portal_app;

-- why SELECT only on jwks_keys: the portal and the gateway read the key set on every token issue
-- and every JWKS refresh, but minting, promoting and retiring a signing key is an ops action run as
-- portal_admin with the KMS in hand. A compromised portal_app cannot introduce a key it can sign
-- with, which is the whole point of keeping the private half out of the database.
GRANT SELECT ON jwks_keys TO portal_app;

-- why SELECT+INSERT only: the append-only trigger already blocks UPDATE/DELETE, but withholding
-- the grant means the attempt never reaches the trigger and shows up as a permission error.
GRANT SELECT, INSERT ON wallet_ledger, usage, audit_log TO portal_app;

----------------------------------------------------------------------
-- Grants: tenant_readonly (inherited by every tenant_<slug> login role)
----------------------------------------------------------------------
GRANT SELECT ON
  tenants, tenant_config, orgs, users, devices, sessions, wallet_ledger, usage, audit_log
  TO tenant_readonly;

-- why column-level: a tenant export must never carry secret material. key_hash and the raw
-- refresh/device-code hashes stay out of reach entirely.
GRANT SELECT (id, tenant_id, org_id, user_id, kind, key_prefix, name, scopes,
              spend_cap_micros, rate_limit_rpm, status, created_by, created_at, updated_at,
              last_used_at, expires_at, revoked_at, revoked_reason)
  ON api_keys TO tenant_readonly;

-- refresh_tokens, device_codes, login_otps: no grant. Nightly exports have no business reading a
-- live refresh hash, a pending device code, or a password-equivalent OTP hash.
-- jwks_keys: no grant either. It is not tenant data, and private_key_ref names a secret-store entry
-- that should not travel in a per-tenant export even though it is not itself a key.
REVOKE ALL ON refresh_tokens, device_codes, login_otps, jwks_keys FROM tenant_readonly;

----------------------------------------------------------------------
-- Ownership
----------------------------------------------------------------------
-- why: FORCE RLS is only meaningful if a single non-login role owns everything and no human
-- connects as it.
DO $do$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO portal_admin', t);
  END LOOP;
END
$do$;

COMMIT;

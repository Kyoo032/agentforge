-- 0007_tenant_resolvers.sql
-- The `portal_admin`-owned SECURITY DEFINER resolvers `schema.md` and `device-code-login.md` both
-- say are missing from 0005.
--
-- The problem they solve, in the words of `schema.md` (login_otps): "resolving the tenant from the
-- e-mail address means reading `users` across tenants, which `portal_app` cannot do -- RLS fails
-- closed without `app.tenant_id`." The same chicken-and-egg exists on every pre-authentication
-- path: a refresh token arrives with no `tid`, an authorization code arrives with no `tid`, and
-- /authorize is handed a `client_id` before anyone has signed in.
--
-- The shape is deliberately minimal and identical for all of them:
--   * SECURITY DEFINER, owned by portal_admin, so the lookup runs under the permissive
--     `p_<table>_admin` policy 0004 installs (and works on a managed instance where BYPASSRLS
--     could not be granted).
--   * `SET search_path = public, pg_temp` on every one, so a caller cannot point them at a
--     shadow table -- the standard SECURITY DEFINER hardening.
--   * Each returns **at most a tenant id** and nothing else. It cannot confirm that a token, an
--     address or a code is valid to anyone who does not already hold it: an unknown value and a
--     value belonging to a suspended tenant both come back NULL, and the caller then runs the
--     real check inside the tenant scope, where the ordinary reason codes apply.
--   * EXECUTE is revoked from PUBLIC and granted only to portal_app.
--
-- The caller's contract: resolve, then `BEGIN; SET LOCAL app.tenant_id = <result>; ...; COMMIT`.
-- A NULL result means "carry on with no tenant scope", which fails closed everywhere except the
-- two tables whose policies expose a NULL window on purpose (device_codes, oauth_clients).

BEGIN;

CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT t.id FROM tenants t WHERE t.slug = p_slug;
$fn$;

-- why NULL when the address matches more than one tenant: `device-code-login.md`, GET /activate --
-- "an address matching users in more than one tenant sends nothing while still rendering the same
-- neutral 'check your email' page". Returning one of them would pick a tenant for the user.
CREATE OR REPLACE FUNCTION resolve_tenant_for_email(p_email citext)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  -- LIMIT 2 is the whole trick: we only ever need to know "exactly one" from "more than one",
  -- so the scan stops at the second tenant instead of collecting every match.
  WITH matches AS (
    SELECT DISTINCT u.tenant_id FROM users u WHERE u.email = p_email LIMIT 2
  )
  SELECT m.tenant_id FROM matches m WHERE (SELECT count(*) FROM matches) = 1;
$fn$;

CREATE OR REPLACE FUNCTION resolve_tenant_for_refresh(p_token_hash bytea)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT rt.tenant_id FROM refresh_tokens rt WHERE rt.token_hash = p_token_hash;
$fn$;

CREATE OR REPLACE FUNCTION resolve_tenant_for_device_code(p_device_code_hash bytea)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT dc.tenant_id FROM device_codes dc WHERE dc.device_code_hash = p_device_code_hash;
$fn$;

CREATE OR REPLACE FUNCTION resolve_tenant_for_user_code(p_user_code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT dc.tenant_id FROM device_codes dc
   WHERE dc.user_code = p_user_code AND dc.status IN ('pending','approved');
$fn$;

CREATE OR REPLACE FUNCTION resolve_tenant_for_auth_code(p_code_hash bytea)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT ac.tenant_id FROM auth_codes ac WHERE ac.code_hash = p_code_hash;
$fn$;

CREATE OR REPLACE FUNCTION resolve_tenant_for_client(p_client_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT c.tenant_id FROM oauth_clients c WHERE c.client_id = p_client_id AND c.status = 'active';
$fn$;

DO $do$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'resolve_tenant_by_slug(text)',
    'resolve_tenant_for_email(citext)',
    'resolve_tenant_for_refresh(bytea)',
    'resolve_tenant_for_device_code(bytea)',
    'resolve_tenant_for_user_code(text)',
    'resolve_tenant_for_auth_code(bytea)',
    'resolve_tenant_for_client(text)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO portal_admin', sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO portal_app', sig);
  END LOOP;
END
$do$;

COMMENT ON FUNCTION resolve_tenant_by_slug(text) IS
  'Pre-authentication tenant lookup by slug. Returns at most a tenant id.';
COMMENT ON FUNCTION resolve_tenant_for_email(citext) IS
  'Tenant for an address, or NULL when it is unknown OR matches more than one tenant.';
COMMENT ON FUNCTION resolve_tenant_for_refresh(bytea) IS
  'Tenant behind a presented refresh token hash, so the caller can set app.tenant_id before
   calling rotate_refresh_token. Returns nothing else about the token.';

COMMIT;

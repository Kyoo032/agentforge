-- 0001_extensions_and_roles.sql
-- Toko Token AI control plane (api.tokotokenai.com) -- extensions, roles, tenant GUC convention.
-- Target: PostgreSQL 16 (TencentDB for PostgreSQL, ap-jakarta).
-- Run as the instance's privileged account. Safe to re-run.

BEGIN;

-- why: gen_random_uuid() is built in on PG13+, but we still want pgcrypto for digest()/hmac()
-- in test fixtures and for ad-hoc hash checks from psql.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- why: case-insensitive e-mail without a functional index on every lookup path.
CREATE EXTENSION IF NOT EXISTS citext;

----------------------------------------------------------------------
-- Roles
----------------------------------------------------------------------
-- portal_admin  : owns every object, runs migrations, bypasses RLS (support / billing back office).
-- portal_app    : the only role the portal API and the /v1 gateway log in as. Serves ALL tenants,
--                 therefore it must SET LOCAL app.tenant_id at the top of every transaction.
-- tenant_readonly : NOLOGIN group role holding the read-only grant set.
-- tenant_<slug> : one LOGIN role per whitelabel partner, INHERITs tenant_readonly and carries
--                 a role-level `SET app.tenant_id`, so the per-tenant connection string is
--                 self-scoping. Used by nightly exports and (later) tenant-side BI.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_admin') THEN
    CREATE ROLE portal_admin NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app') THEN
    CREATE ROLE portal_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenant_readonly') THEN
    CREATE ROLE tenant_readonly NOLOGIN;
  END IF;
END
$$;

-- why: BYPASSRLS needs superuser to grant. On managed instances where the admin account is not
-- a superuser this ALTER fails; 0004 therefore also installs an explicit `portal_admin` policy
-- with USING (true) so the back office works either way.
DO $$
BEGIN
  BEGIN
    ALTER ROLE portal_admin BYPASSRLS;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'could not grant BYPASSRLS to portal_admin; relying on the permissive policy in 0004';
  END;
END
$$;

-- Login roles get their password from the secret manager at provisioning time, never from a
-- migration file. Create them out of band:
--   CREATE ROLE portal_app_login LOGIN PASSWORD '<from secret manager>' IN ROLE portal_app;

----------------------------------------------------------------------
-- app.tenant_id convention
----------------------------------------------------------------------
-- `app.tenant_id` is a custom GUC (placeholder parameter, no extension needed). Every RLS policy
-- reads it through app_tenant_id(). Two ways it gets set:
--
--   1. Gateway / portal API (role portal_app, one pool for all tenants):
--        BEGIN;
--        SET LOCAL app.tenant_id = '5f3a...';   -- resolved from the JWT `tid` claim
--        ... queries ...
--        COMMIT;
--      SET LOCAL is mandatory: it is rolled back with the transaction, so a pooled connection
--      can never leak a tenant scope into the next checkout. A plain SET would survive.
--
--   2. Per-tenant connection string (role tenant_<slug>):
--        ALTER ROLE tenant_jast SET app.tenant_id = '5f3a...';
--      The setting is applied at connect time, so the DSN alone scopes the session.

CREATE OR REPLACE FUNCTION app_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  -- why: the `true` arg makes current_setting() return NULL instead of erroring when the GUC was
  -- never set; a NULL comparison makes every RLS policy evaluate false, i.e. fail closed.
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app_tenant_id() IS
  'Current request tenant from the app.tenant_id GUC; NULL (fail-closed) when unset.';

----------------------------------------------------------------------
-- Tenant role provisioning helper
----------------------------------------------------------------------
-- why: a function keeps the four provisioning steps (role, membership, GUC, connect grant)
-- atomic and identical for every partner. Called by the provisioning script as portal_admin
-- with a password pulled from the secret manager -- never with a literal in a checked-in file.
CREATE OR REPLACE FUNCTION create_tenant_role(p_slug text, p_tenant_id uuid, p_password text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := 'tenant_' || p_slug;
BEGIN
  IF p_slug !~ '^[a-z][a-z0-9_]{1,30}$' THEN
    RAISE EXCEPTION 'invalid tenant slug %', p_slug;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L IN ROLE tenant_readonly', v_role, p_password);
  ELSE
    EXECUTE format('ALTER ROLE %I PASSWORD %L', v_role, p_password);
  END IF;

  EXECUTE format('ALTER ROLE %I SET app.tenant_id = %L', v_role, p_tenant_id::text);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), v_role);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_role);
END
$$;

COMMENT ON FUNCTION create_tenant_role(text, uuid, text) IS
  'Provision the per-tenant read-only login role tenant_<slug> with a pinned app.tenant_id.';

GRANT USAGE ON SCHEMA public TO portal_app, tenant_readonly;
GRANT EXECUTE ON FUNCTION app_tenant_id() TO portal_app, tenant_readonly;

COMMIT;

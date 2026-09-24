-- 0010_app_login_role.sql
-- The role the portal's server logs in as, exactly as 0001 describes it and leaves to someone else.
--
-- `0001_extensions_and_roles.sql:53-55` describes `portal_app_login`: a LOGIN role, a member of
-- portal_app and nothing else, whose password comes from the secret manager at provisioning time
-- and never from a migration file. Nothing ever created it. The portal therefore served its requests
-- on the connection it migrated with, and in `apps/portal/compose.yml` that is the cluster
-- superuser, which bypasses every policy in 0004_rls.sql. Tenant isolation held in the test suite,
-- which connects as portal_app_test, and in no deployment.
--
-- This file creates the role WITHOUT a password, the half of provisioning 0001 lets a migration do.
-- The password still arrives out of band:
--   * production: an operator sets it from the secret manager (`\password portal_app_login` in psql
--     sends a SCRAM verifier, which keeps the plaintext out of the server's statement log);
--   * development only: `apps/portal/src/boot.ts` sets it from PORTAL_DATABASE_URL on every migrate,
--     so the compose database and the review instance need nothing but the two DSNs.
-- A role with no password cannot log in over TCP, so until then it exists and does nothing.
--
-- The attributes are spelled out instead of left to the defaults, because the property the server
-- relies on is "this role cannot see past a policy". `apps/portal/src/boot.ts` refuses, in
-- production, to serve as anything that can.
--
-- An existing role is left exactly as it is. Roles are cluster-wide, and altering one that another
-- session is altering at the same moment (its password, say) fails with "tuple concurrently
-- updated". A role somebody made privileged by hand is caught by the boot check, not here.
--
-- On a managed instance whose owner account may not create roles, the CREATE is skipped with a
-- NOTICE, as 0001 does for BYPASSRLS, and the role is created out of band by whoever can.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app_login') THEN
    BEGIN
      CREATE ROLE portal_app_login
        LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT
        IN ROLE portal_app;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'could not create portal_app_login; create it out of band as 0001 describes';
      -- Another migration run created it between the check and the CREATE.
      WHEN duplicate_object OR unique_violation THEN
        NULL;
    END;
  END IF;
END
$$;

-- CONNECT belongs to PUBLIC by default. A hardened instance revokes that, and the server would then
-- be refused at the door, before any policy is reached.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO portal_app', current_database());
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'could not grant CONNECT on this database to portal_app; grant it out of band';
END
$$;

COMMIT;

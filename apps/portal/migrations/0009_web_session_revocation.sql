-- 0009_web_session_revocation.sql
-- Make the portal's own 30-day browser session revocable, and correct one comment 0006 got wrong.
--
-- ## web_session_versions
--
-- The portal's browser session is a signed cookie, not a row (`src/security/web-session.ts`).
-- That was a deliberate trade and it cost exactly one thing: the cookie could not be ended before
-- it expired. On a shared browser that is not a theoretical gap -- signing out of the app left the
-- portal cookie behind, so the next person to press "Sign in" was signed in as the previous one,
-- with no address and no code (`docs/internal/security-register.md`, SR-21).
--
-- Two shapes would fix it: one row per browser session, or one counter per user. This is the
-- counter, because it is the smaller correct thing:
--
--   * nothing to insert on a successful sign-in, so nothing to prune afterwards;
--   * a revocation is one UPSERT, and it takes effect on the very next request;
--   * no row means version 1, so every cookie minted before a user was ever revoked stays valid
--     without this table having to be back-filled.
--
-- What it does NOT buy is per-browser revocation: bumping the counter ends that user's portal
-- cookie in every browser at once. That is the right blast radius for the two callers that use it
-- -- `POST /auth/logout` with `all_devices: true`, which already means "everywhere" -- and the
-- shared-browser case is handled by clearing the cookie on `POST /logout`, which needs no row at
-- all. Per-browser granularity would need a session id in the cookie and a row to match, and the
-- same follow-up `devices` already has (SR-23).
--
-- ## auth_codes.state_hash
--
-- 0006's comment says an authorization code is "bound to client_id, redirect_uri and
-- sha256(state)". The first two are true and enforced (`store/postgres/auth-codes.ts`). The third
-- never was: the host does not send `state` to `/auth/token` -- its login-CSRF control is its own
-- `__Host-` cookie comparison, which runs before the portal is called -- so the comparison here
-- could only ever be skipped, and the dead branch has been removed (SR-43). 0006 itself is applied
-- and immutable (the runner checksums it), so the correction is made here, where a reader of
-- `\d+ auth_codes` will see it.

BEGIN;

CREATE TABLE IF NOT EXISTS web_session_versions (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT web_session_versions_version_chk CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS ix_web_session_versions_tenant ON web_session_versions (tenant_id);

COMMENT ON TABLE web_session_versions IS
  'Per-user counter carried in the portal''s browser session cookie. A cookie whose `ver` is behind
   the stored version is refused on the next request. No row means version 1.';

----------------------------------------------------------------------
-- RLS + grants, in the plain tenant-scoped shape 0004 defines
----------------------------------------------------------------------
-- tenant_id is NOT NULL and the table is only ever reached inside store.tx(tenantId, ...), so this
-- takes the standard shape and fails closed with no tenant in scope. No pre-authentication window:
-- the only readers already know whose session they are checking.
ALTER TABLE web_session_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_session_versions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_web_session_versions_tenant ON web_session_versions;
CREATE POLICY p_web_session_versions_tenant ON web_session_versions
  FOR ALL
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

DROP POLICY IF EXISTS p_web_session_versions_admin ON web_session_versions;
CREATE POLICY p_web_session_versions_admin ON web_session_versions
  FOR ALL TO portal_admin
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON web_session_versions TO portal_app;

-- Nothing here belongs in a tenant's nightly export: it is a revocation counter, not their data.
REVOKE ALL ON web_session_versions FROM tenant_readonly;

ALTER TABLE web_session_versions OWNER TO portal_admin;

----------------------------------------------------------------------
-- The comment correction
----------------------------------------------------------------------
COMMENT ON COLUMN auth_codes.state_hash IS
  'sha256 of the `state` the browser carried. Written for audit and NEVER compared: the
   login-CSRF binding on `state` is the host''s own __Host- cookie check, made before /auth/token
   is called. See apps/portal/migrations/0009 and security-register SR-43.';

COMMIT;

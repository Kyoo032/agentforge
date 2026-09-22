-- 0008_oauth_client_scope.sql
-- Close the pre-authentication window on `oauth_clients`.
--
-- Why this exists: 0006 gave `oauth_clients` the `device_codes` shape --
--
--   USING (tenant_id = app_tenant_id() OR app_tenant_id() IS NULL)
--
-- -- on the reasoning that `/authorize` reads the client before a tenant is in scope. That turned
-- out not to be true of the code that was then written. Every call site reaches the table inside
-- `store.tx(tenantId, ...)`:
--
--   apps/portal/src/flows/authorize.ts  checkClient      -- resolves the tenant first, then scopes
--   apps/portal/src/flows/token.ts      verifySecret     -- inside the auth-code's tenant scope
--   apps/portal/src/seed/seed.ts        create / rotate  -- inside the seeded tenant's scope
--
-- The tenant is resolved by `resolve_tenant_for_client(text)` (0007), which is SECURITY DEFINER
-- and owned by `portal_admin`, so it answers without the policy's help and returns **at most a
-- tenant id**. The NULL window therefore bought nothing and cost something real: with it, a
-- `portal_app` connection that has not set `app.tenant_id` can `SELECT *` every tenant's client
-- rows -- names, `redirect_uris`, and the `secret_hash` column. Those hashes are sha256 of a
-- 32-byte random secret and are not crackable, but an enumerable list of every partner's client
-- ids and registered callbacks is reconnaissance we do not have to hand out, and "fails closed
-- without a tenant" is the property the rest of this schema has.
--
-- `device_codes` keeps its NULL window, which is not the same case: a device code is minted
-- *before* anyone has authenticated and its `tenant_id` is legitimately NULL on the row itself
-- (`0004_rls.sql`, and `device_codes.tenant_id` is the one nullable tenant in the schema).
--
-- Found by `apps/portal/src/security/rls.test.ts`, which connects as a non-superuser member of
-- `portal_app` rather than as the cluster superuser -- see the header of `src/testing/pg.ts`.

BEGIN;

DROP POLICY IF EXISTS p_oauth_clients_app ON oauth_clients;
CREATE POLICY p_oauth_clients_app ON oauth_clients
  FOR ALL TO portal_app
  USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());

COMMENT ON TABLE oauth_clients IS
  'Confidential clients for the browser login. secret_hash is sha256 of the raw secret, shown once.
   Tenant-scoped with no pre-authentication window (0008): the tenant is resolved by
   resolve_tenant_for_client(text) before the row is read.';

COMMIT;

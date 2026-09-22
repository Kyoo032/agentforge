/**
 * The pre-authentication tenant resolvers.
 *
 * Each is one call to a SECURITY DEFINER function from
 * `apps/portal/migrations/0007_tenant_resolvers.sql`, run **outside** a tenant scope because
 * answering "which tenant?" is the thing that has to happen before a scope exists.
 *
 * They return a tenant id or nothing, so a caller who does not already hold a valid token, code or
 * address learns nothing from one.
 */
import type { Pool } from "pg";
import { normaliseEmail, normaliseUserCode, sha256 } from "../../crypto";
import type { TenantResolvers } from "../types";

export function createResolvers(pool: Pool): TenantResolvers {
  const one = async (sql: string, param: unknown): Promise<string | null> => {
    const { rows } = await pool.query<{ tenant_id: string | null }>(sql, [param]);
    const value = rows[0]?.tenant_id ?? null;
    return value === null ? null : String(value);
  };

  const resolvers: TenantResolvers = {
    bySlug: (slug) => one(`SELECT resolve_tenant_by_slug($1) AS tenant_id`, slug),
    byEmail: (email) => one(`SELECT resolve_tenant_for_email($1) AS tenant_id`, normaliseEmail(email)),
    byRefreshToken: (rawToken) =>
      one(`SELECT resolve_tenant_for_refresh($1) AS tenant_id`, sha256(rawToken)),
    byDeviceCode: (rawDeviceCode) =>
      one(`SELECT resolve_tenant_for_device_code($1) AS tenant_id`, sha256(rawDeviceCode)),
    byUserCode: (userCode) =>
      one(`SELECT resolve_tenant_for_user_code($1) AS tenant_id`, normaliseUserCode(userCode)),
    byAuthCode: (rawCode) => one(`SELECT resolve_tenant_for_auth_code($1) AS tenant_id`, sha256(rawCode)),
    byClientId: (clientId) => one(`SELECT resolve_tenant_for_client($1) AS tenant_id`, clientId),
  };
  return Object.freeze(resolvers);
}

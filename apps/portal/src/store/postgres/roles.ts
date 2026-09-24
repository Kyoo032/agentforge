/**
 * The two role facts the boot sequence needs: who a connection is, and (in development only) the
 * password of the one login role the portal may provision itself.
 */
import type { PoolClient } from "pg";
import type { ConnectionRole } from "../types";

/** The server's login role, as `0001_extensions_and_roles.sql:53-55` names it. */
export const APP_LOGIN_ROLE = "portal_app_login";

interface RoleRow {
  name: string;
  superuser: boolean;
  bypass_rls: boolean;
  portal_admin: boolean;
  portal_app: boolean;
  privileged_roles: string[];
}

/**
 * `pg_has_role` raises for a role name that does not exist, and a database that has not been
 * migrated has neither `portal_admin` nor `portal_app`, so each check is guarded by an existence
 * test instead of assumed.
 */
const CONNECTION_ROLE_SQL = `
  SELECT r.rolname AS name,
         r.rolsuper AS superuser,
         r.rolbypassrls AS bypass_rls,
         CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_admin')
              THEN pg_has_role(r.oid, 'portal_admin', 'MEMBER') ELSE false END AS portal_admin,
         CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portal_app')
              THEN pg_has_role(r.oid, 'portal_app', 'MEMBER') ELSE false END AS portal_app,
         ARRAY(
           SELECT p.rolname::text FROM pg_roles p
            WHERE p.oid <> r.oid
              AND (p.rolsuper OR p.rolbypassrls)
              AND pg_has_role(r.oid, p.oid, 'MEMBER')
            ORDER BY p.rolname
         ) AS privileged_roles
    FROM pg_roles r
   WHERE r.rolname = current_user`;

export async function readConnectionRole(client: PoolClient): Promise<ConnectionRole> {
  const { rows } = await client.query<RoleRow>(CONNECTION_ROLE_SQL);
  const row = rows[0];
  if (!row) {
    // current_user always has a pg_roles row; no row means the catalog read itself was refused.
    throw new Error("could not read the connection's own role from pg_roles");
  }
  return Object.freeze({
    name: row.name,
    superuser: row.superuser,
    bypassRls: row.bypass_rls,
    portalAdmin: row.portal_admin,
    portalApp: row.portal_app,
    privilegedRoles: Object.freeze([...row.privileged_roles]),
  });
}

/**
 * Development only; `src/boot.ts` makes that decision and passes nothing in production.
 *
 * `ALTER ROLE` takes no bind parameters, so the password is quoted with the driver's own
 * `escapeLiteral`. The role name is a constant, never read from a DSN, so no other role's password
 * can be reset through this.
 */
export async function setAppLoginPassword(client: PoolClient, password: string): Promise<void> {
  await client.query(`ALTER ROLE ${APP_LOGIN_ROLE} PASSWORD ${client.escapeLiteral(password)}`);
}

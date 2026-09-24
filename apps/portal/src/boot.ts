/**
 * The database half of booting the portal: migrate as the schema owner, then serve as a plain member
 * of `portal_app`, and in production never serve as anything that can see past a row-level security
 * policy.
 *
 * The portal used to migrate and serve on one DSN. Migrations need the schema owner (0004 re-owns
 * every table to `portal_admin`, 0007 creates `SECURITY DEFINER` functions), and in
 * `apps/portal/compose.yml` the owner is the cluster superuser. So every request ran as a role that
 * bypasses RLS, and the tenant policies held in the test suite and in no deployment.
 *
 * Now there are two connections and they never overlap. `PORTAL_MIGRATE_DATABASE_URL` is opened,
 * migrates and is closed before anything listens. `PORTAL_DATABASE_URL` serves, and `pg_roles` is
 * asked who it really is before it does.
 */
import { PortalConfigError, type PortalConfig } from "./config";
import type { Logger } from "./log";
import { openMigrationStore, openStore } from "./store";
import { APP_LOGIN_ROLE } from "./store/postgres/roles";
import type { Clock, ConnectionRole, MigrationResult, PortalStore } from "./store/types";

export type RoleProblemCode = "superuser" | "bypassrls" | "portal_admin" | "privileged_member" | "not_portal_app";

export interface RoleProblem {
  readonly code: RoleProblemCode;
  readonly message: string;
}

const FIX =
  `Connect PORTAL_DATABASE_URL as ${APP_LOGIN_ROLE} (a LOGIN member of portal_app and nothing else, ` +
  "created by apps/portal/migrations/0010_app_login_role.sql, password set out of band) and keep " +
  "the schema owner for PORTAL_MIGRATE_DATABASE_URL.";

/** Every way `role` can see past the tenant policies, plus the one membership it cannot lack. */
export function serverRoleProblems(role: ConnectionRole): readonly RoleProblem[] {
  const who = `PORTAL_DATABASE_URL connects as "${role.name}"`;
  if (role.superuser) {
    // A superuser is a member of every role and skips every policy; nothing else needs saying.
    return [
      {
        code: "superuser",
        message: `${who}, a superuser, which bypasses every row-level security policy in 0004_rls.sql. ${FIX}`,
      },
    ];
  }
  const problems: RoleProblem[] = [];
  if (role.bypassRls) {
    problems.push({
      code: "bypassrls",
      message: `${who}, which has BYPASSRLS, so every row-level security policy in 0004_rls.sql is skipped. ${FIX}`,
    });
  }
  if (role.portalAdmin) {
    problems.push({
      code: "portal_admin",
      message:
        `${who}, a member of portal_admin, whose policy on every table is USING (true): it reads ` +
        `and writes every tenant. ${FIX}`,
    });
  }
  const others = role.privilegedRoles.filter((name) => name !== "portal_admin" || !role.portalAdmin);
  if (others.length > 0) {
    problems.push({
      code: "privileged_member",
      message:
        `${who}, which can SET ROLE to ${others.map((name) => `"${name}"`).join(", ")} ` +
        `(superuser or BYPASSRLS), so one injected statement escapes every policy. ${FIX}`,
    });
  }
  if (!role.portalApp) {
    problems.push({
      code: "not_portal_app",
      message:
        `${who}, which is not a member of portal_app. Every grant in 0004_rls.sql is made to ` +
        `portal_app, so the first query would be refused. ${FIX}`,
    });
  }
  return problems;
}

function userAndPassword(dsn: string): { readonly user: string; readonly password: string } | null {
  try {
    const url = new URL(dsn);
    // Decoded the way the driver decodes them when it connects.
    return { user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) };
  } catch {
    return null;
  }
}

/**
 * Whether the migration step should set `portal_app_login`'s password, and to what.
 *
 * Only outside production: `0001_extensions_and_roles.sql:53-55` provisions login roles out of band,
 * from the secret manager, and a production process does not reach into `pg_authid`. Only for that
 * one role, named exactly, so no DSN can be used to reset some other role's password. And only when
 * the owner's DSN is a different role, since the owner is the one doing the setting.
 */
export function appLoginToProvision(config: PortalConfig): { readonly password: string } | null {
  if (config.production) {
    return null;
  }
  const server = userAndPassword(config.databaseUrl);
  const owner = userAndPassword(config.migrateDatabaseUrl);
  if (!server || !owner || server.user !== APP_LOGIN_ROLE || owner.user === APP_LOGIN_ROLE) {
    return null;
  }
  return server.password ? { password: server.password } : null;
}

/** Opens the owner's connection, migrates, and closes it again, whatever happened. */
export async function migrateAsOwner(config: PortalConfig): Promise<MigrationResult> {
  const migrator = openMigrationStore(config);
  try {
    const appLogin = appLoginToProvision(config);
    return await migrator.migrate(appLogin ? { appLoginPassword: appLogin.password } : {});
  } finally {
    await migrator.close();
  }
}

/**
 * Refuses, in production, a server connection that can see past a policy. Outside production the
 * same finding is a warning, because the one-DSN setup local development used before the split
 * still has to boot. It is loud about what that setup gives up.
 */
export async function checkServerRole(store: PortalStore, config: PortalConfig, log: Logger): Promise<ConnectionRole> {
  const role = await store.connectionRole();
  const problems = serverRoleProblems(role);
  if (problems.length === 0) {
    return role;
  }
  if (config.production) {
    throw new PortalConfigError(problems.map((problem) => problem.message));
  }
  log.warn("portal_db_role_bypasses_rls", {
    role: role.name,
    problems: problems.map((problem) => problem.code),
    hint: FIX,
  });
  return role;
}

/** Everything `main.ts` needs before it builds the server: a migrated schema and a checked store. */
export async function prepareStore(config: PortalConfig, log: Logger, clock?: Clock): Promise<PortalStore> {
  const migration = await migrateAsOwner(config);
  log.info("portal_migrated", { applied: migration.applied.length, skipped: migration.skipped.length });

  const store = openStore(config, clock);
  try {
    await checkServerRole(store, config, log);
    return store;
  } catch (error) {
    await store.close().catch(() => undefined);
    throw error;
  }
}

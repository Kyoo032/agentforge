/**
 * The boot sequence's database half. Migrations run as the schema owner, on a connection of their
 * own. The server runs as a plain member of `portal_app`, and a production process refuses a server
 * connection that can see past a row-level security policy.
 *
 * Why this exists: the portal used to migrate and serve on one DSN, and the compose file handed
 * that DSN the cluster superuser, so every request ran as a role that bypasses RLS. Every tenant
 * policy in `0004_rls.sql` held in the test suite, which connects as `portal_app_test`, and in no
 * deployment.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { appLoginToProvision, prepareStore, serverRoleProblems } from "./boot";
import { PortalConfigError, type PortalConfig } from "./config";
import { createLogger } from "./log";
import type { ConnectionRole, PortalStore } from "./store/types";
import { openPostgresStore } from "./store/postgres";
import { APP_ROLE, appRoleUrl, createTestDatabase, type TestDatabase } from "./testing/pg";
import { testConfig } from "./testing/server";

let database: TestDatabase;
let appUrl: string;
const opened: PortalStore[] = [];
const createdRoles: string[] = [];

function capture() {
  const lines: string[] = [];
  const log = createLogger({ env: { PORTAL_LOG_LEVEL: "debug" }, sink: (_level, line) => lines.push(line) });
  const events = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { log, events };
}

function withUser(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

/** A throwaway LOGIN role with the attributes under test. Names and passwords are hex only. */
async function throwawayRole(attributes: string, memberOf: readonly string[]): Promise<string> {
  const name = `portal_boot_${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");
  const admin = new pg.Client({ connectionString: inject("portalTestDb").adminUrl });
  await admin.connect();
  try {
    const membership = memberOf.length > 0 ? ` IN ROLE ${memberOf.join(", ")}` : "";
    await admin.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}' ${attributes}${membership}`);
  } finally {
    await admin.end();
  }
  createdRoles.push(name);
  return withUser(database.url, name, password);
}

function track(store: PortalStore): PortalStore {
  opened.push(store);
  return store;
}

function config(overrides: Partial<PortalConfig>): PortalConfig {
  return testConfig({ databaseUrl: database.url, migrateDatabaseUrl: database.url, ...overrides });
}

beforeAll(async () => {
  database = await createTestDatabase();
  appUrl = await appRoleUrl(database);
}, 120_000);

afterAll(async () => {
  for (const store of opened) {
    await store.close().catch(() => undefined);
  }
  await database?.drop();
  if (createdRoles.length > 0) {
    const admin = new pg.Client({ connectionString: inject("portalTestDb").adminUrl });
    await admin.connect();
    try {
      for (const name of createdRoles) {
        await admin.query(`DROP ROLE IF EXISTS ${name}`);
      }
    } finally {
      await admin.end();
    }
  }
});

const PLAIN: ConnectionRole = {
  name: "portal_app_login",
  superuser: false,
  bypassRls: false,
  portalAdmin: false,
  portalApp: true,
  privilegedRoles: [],
};

describe("serverRoleProblems", () => {
  it("has nothing to say about a plain member of portal_app", () => {
    expect(serverRoleProblems(PLAIN)).toEqual([]);
  });

  it("names every way a role can see past the tenant policies", () => {
    const codes = (role: Partial<ConnectionRole>) => serverRoleProblems({ ...PLAIN, ...role }).map((p) => p.code);

    expect(codes({ superuser: true })).toContain("superuser");
    expect(codes({ bypassRls: true })).toEqual(["bypassrls"]);
    expect(codes({ portalAdmin: true })).toEqual(["portal_admin"]);
    expect(codes({ privilegedRoles: ["postgres"] })).toEqual(["privileged_member"]);
    expect(codes({ portalApp: false })).toEqual(["not_portal_app"]);
  });

  it("says in each message which role it is, and what to connect as instead", () => {
    const [problem] = serverRoleProblems({ ...PLAIN, name: "portal", superuser: true });
    expect(problem.message).toContain('"portal"');
    expect(problem.message).toContain("portal_app_login");
    expect(problem.message).toContain("PORTAL_MIGRATE_DATABASE_URL");
  });
});

describe("the server connection's role, read from pg_roles", () => {
  it("reports the suite's own role as a plain member of portal_app", async () => {
    const store = track(openPostgresStore({ databaseUrl: appUrl, maxConnections: 1 }));
    expect(await store.connectionRole()).toEqual({ ...PLAIN, name: APP_ROLE });
  });

  it("reports the cluster superuser the compose file used to hand the server", async () => {
    const store = track(openPostgresStore({ databaseUrl: database.url, maxConnections: 1 }));
    const role = await store.connectionRole();
    expect(role.superuser).toBe(true);
    expect(serverRoleProblems(role).map((p) => p.code)).toContain("superuser");
  });

  it("reports BYPASSRLS, membership of portal_admin, and a missing portal_app membership", async () => {
    const bypass = track(
      openPostgresStore({ databaseUrl: await throwawayRole("NOSUPERUSER BYPASSRLS", ["portal_app"]), maxConnections: 1 }),
    );
    expect((await bypass.connectionRole()).bypassRls).toBe(true);

    const admin = track(
      openPostgresStore({ databaseUrl: await throwawayRole("NOSUPERUSER", ["portal_app", "portal_admin"]), maxConnections: 1 }),
    );
    expect((await admin.connectionRole()).portalAdmin).toBe(true);

    const stranger = track(openPostgresStore({ databaseUrl: await throwawayRole("NOSUPERUSER", []), maxConnections: 1 }));
    expect((await stranger.connectionRole()).portalApp).toBe(false);
  });
});

describe("appLoginToProvision", () => {
  const login = (password = "dev-password") =>
    `postgres://portal_app_login:${password}@127.0.0.1:5433/tokotoken_portal`;
  const owner = "postgres://portal:owner@127.0.0.1:5433/tokotoken_portal";

  it("hands the migration step portal_app_login's password outside production", () => {
    expect(appLoginToProvision(testConfig({ databaseUrl: login(), migrateDatabaseUrl: owner }))).toEqual({
      password: "dev-password",
    });
  });

  it("never in production, where login roles are provisioned out of band (0001)", () => {
    expect(
      appLoginToProvision(testConfig({ production: true, databaseUrl: login(), migrateDatabaseUrl: owner })),
    ).toBeNull();
  });

  it("never for any other role, so a DSN cannot be used to reset somebody else's password", () => {
    for (const databaseUrl of [
      "postgres://portal:pw@127.0.0.1:5433/tokotoken_portal",
      "postgres://postgres:pw@127.0.0.1:5433/tokotoken_portal",
      "postgres://portal_admin:pw@127.0.0.1:5433/tokotoken_portal",
      "postgres://PORTAL_APP_LOGIN:pw@127.0.0.1:5433/tokotoken_portal",
    ]) {
      expect(appLoginToProvision(testConfig({ databaseUrl, migrateDatabaseUrl: owner })), databaseUrl).toBeNull();
    }
  });

  it("not without a password, and not when the owner's DSN is the same one", () => {
    expect(
      appLoginToProvision(
        testConfig({ databaseUrl: "postgres://portal_app_login@127.0.0.1:5433/db", migrateDatabaseUrl: owner }),
      ),
    ).toBeNull();
    expect(appLoginToProvision(testConfig({ databaseUrl: login(), migrateDatabaseUrl: login() }))).toBeNull();
  });

  it("decodes a percent-encoded password, as the driver will when it connects", () => {
    expect(appLoginToProvision(testConfig({ databaseUrl: login("p%40ss%2Fw"), migrateDatabaseUrl: owner }))).toEqual({
      password: "p@ss/w",
    });
  });
});

describe("prepareStore", () => {
  it("refuses to boot in production when the server connects as a superuser", async () => {
    const { log } = capture();
    const refused = prepareStore(config({ production: true }), log);
    await expect(refused).rejects.toBeInstanceOf(PortalConfigError);
    await expect(refused).rejects.toThrow(/superuser/);
  });

  it("refuses to boot in production for BYPASSRLS, and for membership of portal_admin", async () => {
    const { log } = capture();
    const bypassUrl = await throwawayRole("NOSUPERUSER BYPASSRLS", ["portal_app"]);
    await expect(prepareStore(config({ production: true, databaseUrl: bypassUrl }), log)).rejects.toThrow(
      /BYPASSRLS/,
    );

    const adminUrl = await throwawayRole("NOSUPERUSER", ["portal_app", "portal_admin"]);
    await expect(prepareStore(config({ production: true, databaseUrl: adminUrl }), log)).rejects.toThrow(
      /portal_admin/,
    );
  });

  it("boots outside production on the one superuser DSN compose used to hand out, and says so", async () => {
    const { log, events } = capture();
    const store = track(await prepareStore(config({}), log));

    expect((await store.connectionRole()).superuser).toBe(true);
    const warning = events().find((event) => event.event === "portal_db_role_bypasses_rls");
    expect(warning?.level).toBe("warn");
  });

  it("boots in production as a plain member of portal_app, having migrated as the owner", async () => {
    const { log, events } = capture();
    const store = track(await prepareStore(config({ production: true, databaseUrl: appUrl }), log));

    expect((await store.connectionRole()).name).toBe(APP_ROLE);
    expect(events().some((event) => event.event === "portal_db_role_bypasses_rls")).toBe(false);
    expect(events().some((event) => event.event === "portal_migrated")).toBe(true);
    // A real scoped read through the server connection, so "booted" means "can serve".
    expect(await store.resolve.bySlug("no-such-tenant")).toBeNull();
  });

  it("outside production, gives portal_app_login the password its DSN names and serves as it", async () => {
    const { log, events } = capture();
    const password = randomBytes(12).toString("hex");
    const store = track(
      await prepareStore(config({ databaseUrl: withUser(database.url, "portal_app_login", password) }), log),
    );

    expect(await store.connectionRole()).toEqual(PLAIN);
    expect(events().some((event) => event.event === "portal_db_role_bypasses_rls")).toBe(false);
    expect(JSON.stringify(events())).not.toContain(password);
  });

  it("in production, sets no password at all: the login role is provisioned out of band", async () => {
    const { log } = capture();
    const unprovisioned = withUser(database.url, "portal_app_login", randomBytes(12).toString("hex"));
    await expect(prepareStore(config({ production: true, databaseUrl: unprovisioned }), log)).rejects.toThrow(
      /password authentication failed/,
    );
  });
});

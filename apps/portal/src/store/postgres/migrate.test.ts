/**
 * The migration runner against a genuinely empty database: the five files the backend team owns,
 * then ours, then the same run again.
 */
import { readFile } from "node:fs/promises";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../testing/pg";
import { listMigrations, runMigrations } from "./migrate";

let database: TestDatabase;
let pool: pg.Pool;

beforeAll(async () => {
  database = await createTestDatabase({ fromTemplate: false });
  pool = new pg.Pool({ connectionString: database.url, max: 2 });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await database?.drop();
});

async function migrate(): Promise<{ applied: readonly string[]; skipped: readonly string[] }> {
  const client = await pool.connect();
  try {
    return await runMigrations(client);
  } finally {
    client.release();
  }
}

async function tableExists(name: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = $1) AS ok`,
    [name],
  );
  return rows[0].ok;
}

describe("runMigrations", () => {
  it("reads the backend team's files from docs/internal/portal/migrations, not a copy", async () => {
    const files = await listMigrations();
    const shared = files.filter((file) => file.source === "docs").map((file) => file.id);
    expect(shared).toEqual([
      "0001_extensions_and_roles.sql",
      "0002_core_tables.sql",
      "0003_billing_and_usage.sql",
      "0004_rls.sql",
      "0005_functions.sql",
    ]);
    for (const file of files.filter((candidate) => candidate.source === "docs")) {
      expect(file.path).toContain("docs");
      expect(file.path).toContain("portal");
    }
  });

  it("applies every file once, then skips them all on a second run", async () => {
    const first = await migrate();
    expect(first.applied).toContain("0002_core_tables.sql");
    expect(first.applied).toContain("0006_browser_login.sql");
    expect(first.applied).toContain("0007_tenant_resolvers.sql");
    expect(first.skipped).toHaveLength(0);

    const second = await migrate();
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toEqual(first.applied);

    const third = await migrate();
    expect(third.applied).toHaveLength(0);
  });

  it("creates the tables the login flow reads", async () => {
    for (const table of [
      "tenants",
      "tenant_config",
      "orgs",
      "users",
      "devices",
      "sessions",
      "refresh_tokens",
      "device_codes",
      "login_otps",
      "audit_log",
      "oauth_clients",
      "auth_codes",
    ]) {
      expect(await tableExists(table), table).toBe(true);
    }
  });

  it("keeps its bookkeeping out of public, where 0004 re-owns every table", async () => {
    expect(await tableExists("migrations")).toBe(false);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM portal_meta.migrations`,
    );
    // Counted from the directories rather than pinned to a number, so adding a migration is not
    // also a test edit. 0008 arriving is what showed that the pin was the brittle half.
    expect(rows[0].n).toBe((await listMigrations()).length);
  });

  it("installs 0005's functions and 0007's resolvers", async () => {
    const { rows } = await pool.query<{ proname: string }>(
      `SELECT proname FROM pg_proc WHERE proname = ANY($1::text[])`,
      [
        [
          "count_active_users",
          "login_precheck",
          "rotate_refresh_token",
          "revoke_session_chain",
          "expire_device_codes",
          "prune_login_otps",
          "resolve_tenant_by_slug",
          "resolve_tenant_for_refresh",
        ],
      ],
    );
    expect(rows).toHaveLength(8);
  });

  /**
   * `0001_extensions_and_roles.sql:53-55` describes the role the portal should log in as and
   * leaves creating it to someone else: `CREATE ROLE portal_app_login LOGIN ... IN ROLE portal_app`.
   * Nobody did, so the portal connected as the migration role, which in compose is the cluster
   * superuser. 0010 creates it, with nothing but `portal_app` membership. Roles are cluster-wide,
   * so this reads attributes, never the password another suite may have set meanwhile.
   */
  it("creates portal_app_login as 0001 describes it: a LOGIN member of portal_app and nothing more", async () => {
    const { rows } = await pool.query<{
      login: boolean;
      superuser: boolean;
      bypass: boolean;
      createrole: boolean;
      createdb: boolean;
      app: boolean;
      admin: boolean;
    }>(
      `SELECT r.rolcanlogin AS login, r.rolsuper AS superuser, r.rolbypassrls AS bypass,
              r.rolcreaterole AS createrole, r.rolcreatedb AS createdb,
              pg_has_role(r.oid, 'portal_app', 'MEMBER') AS app,
              pg_has_role(r.oid, 'portal_admin', 'MEMBER') AS admin
         FROM pg_roles r WHERE r.rolname = 'portal_app_login'`,
    );
    expect(rows).toEqual([
      { login: true, superuser: false, bypass: false, createrole: false, createdb: false, app: true, admin: false },
    ]);
  });

  it("puts no password in a migration file, as 0001 requires of login roles", async () => {
    for (const file of (await listMigrations()).filter((candidate) => candidate.source === "portal")) {
      const sql = await readFile(file.path, "utf8");
      expect(sql, file.id).not.toMatch(/PASSWORD\s+'/i);
      expect(sql, file.id).not.toMatch(/PASSWORD\s+\$/i);
    }
  });

  it("re-applies cleanly when the tracking rows are lost but the schema is not", async () => {
    // A database restored from a dump that did not carry portal_meta. Every file claims to be
    // safe to re-run; this is the claim being tested rather than trusted.
    await pool.query(`DELETE FROM portal_meta.migrations`);
    const again = await migrate();
    expect(again.applied).toHaveLength((await listMigrations()).length);
    expect(await tableExists("tenants")).toBe(true);
  });

  it("refuses to run when an applied file has been edited", async () => {
    await pool.query(`UPDATE portal_meta.migrations SET checksum = 'tampered' WHERE id = $1`, [
      "0002_core_tables.sql",
    ]);
    await expect(migrate()).rejects.toThrow(/has changed since it was applied/);
    // Put it back, so the file stays usable for anything that runs after this one.
    await pool.query(`DELETE FROM portal_meta.migrations WHERE id = $1`, ["0002_core_tables.sql"]);
    await migrate();
  });
});

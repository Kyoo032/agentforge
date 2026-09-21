import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_OWNER_ID, LOCAL_TENANT_ID, PERSONAL_ORG_SLUG } from "@agentforge/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureLocalOwner } from "./ensure-local-owner";
import { ensureSchema } from "./ensure-schema";
import { ensureTenant, getLocalTenant, getTenantById } from "./tenants";
import * as schema from "./schema";
import { organizations, tenants } from "./schema";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realMigrations = path.join(packageDir, "drizzle");

/** Every kernel table a pre-Phase-3 desktop database has, for the baseline-stamp case. */
const KERNEL_TABLES = [
  "agent_tool_bindings",
  "agent_versions",
  "agents",
  "media",
  "messages",
  "organization_members",
  "organizations",
  "runs",
  "threads",
  "tool_invocations",
  "tools",
  "user",
  "workspace_members",
  "workspaces",
] as const;

let tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Build a genuine pre-Phase-3 database: replay the committed migration files 0000-0014 exactly as
 * `applyPendingMigrations` would, then stamp the journal at 0014.
 *
 * Deliberately not `ensureSchema` with a truncated migrations folder — `ensureSchema` also runs the
 * `ensureTenantTables` healer, which would create the very table this fixture must not have. The
 * files are the real ones, so this is a replay of the old repo, not a hand-written approximation.
 */
function migrateThrough0014(sqlite: Database.Database): void {
  const journalPath = path.join(realMigrations, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const through = journal.entries.filter((entry) => entry.idx < 15);
  expect(through.at(-1)?.tag).toBe("0014_auth_sessions");

  // Generated migrations are not topologically ordered, so FKs go off for the DDL, as in ensureSchema.
  sqlite.pragma("foreign_keys = OFF");
  for (const entry of through) {
    const file = readFileSync(path.join(realMigrations, `${entry.tag}.sql`), "utf8");
    for (const statement of file.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        sqlite.exec(trimmed);
      }
    }
  }
  sqlite.pragma("foreign_keys = ON");

  // Stamped at 0014, so the real `ensureSchema` below takes the apply-pending path and runs 0015
  // for real, rather than baseline-stamping it. Only `created_at` is compared, as in 0001's test.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);
  const stamp = sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
  for (const entry of through) {
    stamp.run(`stamped-${entry.tag}`, entry.when);
  }
}

/**
 * Seed a 0014 database the way the pre-Phase-3 `ensureLocalOwner` did — one org, one desk, one
 * owner — plus a little content, so the assertions below can prove nothing was re-seeded or lost.
 * Written as raw SQL on purpose: today's `ensureLocalOwner` writes `tenant_id`, which this
 * database does not have yet.
 */
function seedSingleOrg(sqlite: Database.Database): {
  orgId: string;
  workspaceId: string;
} {
  const orgId = "org-existing";
  const workspaceId = "ws-existing";
  sqlite
    .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)")
    .run(LOCAL_OWNER_ID, "You", "local@agentforge.local");
  sqlite
    .prepare("INSERT INTO organizations (id, name, slug, industry_pack, created_at) VALUES (?, ?, ?, ?, 1)")
    .run(orgId, "Personal", PERSONAL_ORG_SLUG, "generic");
  sqlite
    .prepare("INSERT INTO workspaces (id, organization_id, name, slug, created_at) VALUES (?, ?, ?, ?, 1)")
    .run(workspaceId, orgId, "Default", "home");
  sqlite
    .prepare("INSERT INTO organization_members (id, organization_id, user_id, role) VALUES (?, ?, ?, ?)")
    .run("om-1", orgId, LOCAL_OWNER_ID, "owner");
  sqlite
    .prepare("INSERT INTO workspace_members (id, workspace_id, organization_id, user_id, role) VALUES (?, ?, ?, ?, ?)")
    .run("wm-1", workspaceId, orgId, LOCAL_OWNER_ID, "owner");
  sqlite
    .prepare(
      `INSERT INTO agents
         (id, organization_id, workspace_id, name, slug, description, visibility, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'Assistant', 'assistant', '', 'private', ?, 1, 1)`,
    )
    .run("ag-1", orgId, workspaceId, LOCAL_OWNER_ID);
  sqlite
    .prepare(
      `INSERT INTO threads (id, organization_id, workspace_id, agent_id, user_id, title, created_at)
       VALUES (?, ?, ?, ?, ?, 'An existing chat', 1)`,
    )
    .run("th-1", orgId, workspaceId, "ag-1", LOCAL_OWNER_ID);
  sqlite
    .prepare(
      `INSERT INTO artifacts (id, workspace_id, mode, kind, title, mime, body, meta, size_bytes, created_at, updated_at)
       VALUES (?, ?, 'chat', 'text', 'Existing artifact', 'text/plain', 'body', '{}', 4, 1, 1)`,
    )
    .run("ar-1", workspaceId);
  sqlite
    .prepare(
      `INSERT INTO datasets (id, workspace_id, name, filename, rows, cols, columns, storage_path, size_bytes, created_at)
       VALUES (?, ?, 'Existing dataset', 'a.csv', 2, 1, '[]', 'datasets/a.csv', 9, 1)`,
    )
    .run("ds-1", workspaceId);
  return { orgId, workspaceId };
}

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
  ).map((row) => row.name);
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (column) => column.name,
  );
}

function indexNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function count(sqlite: Database.Database, table: string): number {
  return (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("0015_tenants on a fresh database", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates tenants with exactly the local tenant row", () => {
    expect(tableNames(sqlite)).toContain("tenants");
    const rows = sqlite.prepare("SELECT id, slug, name, status FROM tenants").all();
    expect(rows).toEqual([{ id: LOCAL_TENANT_ID, slug: "local", name: "Local", status: "active" }]);
  });

  it("puts tenant_id on organizations and on nothing else", () => {
    expect(columnNames(sqlite, "organizations")).toContain("tenant_id");
    // The design hangs every other table off organizations; a second tenant_id column would need a
    // backfill through a join it does not have, and an invariant nothing enforces.
    const carriers = tableNames(sqlite).filter(
      (name) => name !== "tenants" && name !== "organizations" && columnNames(sqlite, name).includes("tenant_id"),
    );
    // auth_sessions carries the portal's tenant id from Phase 2; it predates this migration.
    // tenant_usage is the Phase 5 lane A ledger (0016): it is keyed on the tenant rather than
    // reached through an organization, because a billable event has to outlive the org it came
    // from. tenant_state is the Phase 4 secrets and gate store (0018): a tenant's sealed settings
    // are the tenant's, not any one organization's, and the tenant is all a wrap-key rotation has
    // to walk. tenant_plan, tenant_seat and billing_events are Phase 5 lane B (0017): an
    // entitlement, a seat and a provider's delivery are all bought by the tenant, and none of them
    // has an organization to be reached through. tenant_storage is Phase 6 (0019): how many bytes
    // a tenant is holding is a property of the tenant, and the quota it feeds is per tenant, not
    // per organization. tenant_reset_audit is Phase 8 (0020): it records that a tenant erased its
    // own content, so it has to hang off the thing that survives that act — the tenant — and never
    // off the organization the reset deletes. Nothing else is allowed to carry a second tenant_id.
    expect(carriers.sort()).toEqual([
      "auth_sessions",
      "billing_events",
      "tenant_plan",
      "tenant_reset_audit",
      "tenant_seat",
      "tenant_state",
      "tenant_storage",
      "tenant_usage",
    ]);
  });

  it("moves organization slug uniqueness onto (tenant_id, slug)", () => {
    const indexes = indexNames(sqlite, "organizations");
    expect(indexes).toContain("organizations_tenant_slug");
    expect(indexes).toContain("organizations_tenant_idx");
    expect(indexes).not.toContain("organizations_slug_unique");

    const insert = sqlite.prepare(
      "INSERT INTO organizations (id, tenant_id, name, slug, industry_pack, created_at) VALUES (?, ?, ?, ?, 'generic', 1)",
    );
    sqlite
      .prepare("INSERT INTO tenants (id, slug, name, status, created_at) VALUES ('t-2', 'two', 'Two', 'active', 1)")
      .run();
    insert.run("o-1", LOCAL_TENANT_ID, "Personal", PERSONAL_ORG_SLUG);
    // The whole point: two tenants may each have a "personal" org.
    expect(() => insert.run("o-2", "t-2", "Personal", PERSONAL_ORG_SLUG)).not.toThrow();
    // Within one tenant the slug is still unique.
    expect(() => insert.run("o-3", "t-2", "Personal again", PERSONAL_ORG_SLUG)).toThrow(/UNIQUE/);
  });

  it("cascades organizations away when their tenant is deleted", () => {
    sqlite.pragma("foreign_keys = ON");
    sqlite
      .prepare("INSERT INTO tenants (id, slug, name, status, created_at) VALUES ('t-gone', 'gone', 'Gone', 'active', 1)")
      .run();
    sqlite
      .prepare(
        "INSERT INTO organizations (id, tenant_id, name, slug, industry_pack, created_at) VALUES ('o-gone', 't-gone', 'O', 'o', 'generic', 1)",
      )
      .run();
    sqlite.prepare("DELETE FROM tenants WHERE id = 't-gone'").run();
    expect(count(sqlite, "organizations")).toBe(0);
  });

  it("declares tenants in the drizzle schema, matching the migration", () => {
    // Drift guard, same as knowledge_retrievals: migration + ensureSchema + schema.ts, or
    // `drizzle-kit generate` emits a CREATE TABLE for it all over again.
    const config = getTableConfig(tenants);
    expect(config.name).toBe("tenants");
    expect(config.columns.map((column) => column.name).sort()).toEqual([
      "created_at",
      "id",
      "name",
      "slug",
      "status",
    ]);
    const org = getTableConfig(organizations);
    const tenantId = org.columns.find((column) => column.name === "tenant_id");
    expect(tenantId?.notNull).toBe(true);
    expect(org.indexes.map((entry) => entry.config.name).sort()).toEqual([
      "organizations_tenant_idx",
      "organizations_tenant_slug",
    ]);
    expect(
      org.indexes.find((entry) => entry.config.name === "organizations_tenant_slug")?.config.unique,
    ).toBe(true);
  });

  it("is safe to apply twice", () => {
    // SQLite has no `ADD COLUMN IF NOT EXISTS`, so a bare ALTER is a hard failure the second time
    // the file runs — a re-stamped journal, a repaired install, or this test.
    expect(() => ensureSchema(sqlite)).not.toThrow();
    expect(count(sqlite, "tenants")).toBe(1);
    expect(columnNames(sqlite, "organizations").filter((name) => name === "tenant_id")).toEqual(["tenant_id"]);
  });
});

describe("0015_tenants on a database seeded like today's single-org install", () => {
  let sqlite: Database.Database;
  let seeded: { orgId: string; workspaceId: string };

  beforeEach(() => {
    sqlite = new Database(":memory:");
    migrateThrough0014(sqlite);
    expect(tableNames(sqlite)).not.toContain("tenants");
    seeded = seedSingleOrg(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("backfills the existing organization into the local tenant", () => {
    ensureSchema(sqlite);
    const rows = sqlite.prepare("SELECT id FROM tenants").all();
    expect(rows).toEqual([{ id: LOCAL_TENANT_ID }]);
    const orgs = sqlite.prepare("SELECT id, tenant_id FROM organizations").all();
    expect(orgs).toEqual([{ id: seeded.orgId, tenant_id: LOCAL_TENANT_ID }]);
  });

  it("leaves the owner, the desk and the content untouched", () => {
    const threadsBefore = count(sqlite, "threads");
    const artifactsBefore = count(sqlite, "artifacts");
    const datasetsBefore = count(sqlite, "datasets");

    ensureSchema(sqlite);

    const owner = sqlite.prepare("SELECT id FROM user").all();
    expect(owner).toEqual([{ id: LOCAL_OWNER_ID }]);
    const desks = sqlite.prepare("SELECT id, organization_id FROM workspaces").all();
    expect(desks).toEqual([{ id: seeded.workspaceId, organization_id: seeded.orgId }]);
    expect(count(sqlite, "threads")).toBe(threadsBefore);
    expect(count(sqlite, "artifacts")).toBe(artifactsBefore);
    expect(count(sqlite, "datasets")).toBe(datasetsBefore);
  });

  it("opens with no re-seed: ensureLocalOwner reuses the existing org and desk", async () => {
    ensureSchema(sqlite);
    const db = drizzle(sqlite, { schema });

    const tenant = await ensureLocalOwner(db);

    expect(tenant.tenantId).toBe(LOCAL_TENANT_ID);
    expect(tenant.organizationId).toBe(seeded.orgId);
    expect(tenant.workspaceId).toBe(seeded.workspaceId);
    expect(tenant.userId).toBe(LOCAL_OWNER_ID);
    expect(tenant.role).toBe("owner");
    // Nothing new was created: still one org, one desk, one user, one tenant.
    expect(count(sqlite, "organizations")).toBe(1);
    expect(count(sqlite, "workspaces")).toBe(1);
    expect(count(sqlite, "user")).toBe(1);
    expect(count(sqlite, "tenants")).toBe(1);
  });
});

describe("0015_tenants on a baseline-stamped database", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    // `ensureSchema` marks every migration applied without running it when all kernel tables are
    // present and the journal is empty. 0015 is stamped but never runs, so only the healer can
    // create `tenants` here — this is the case ensure-schema.ts:209-213 creates.
    sqlite = new Database(":memory:");
    for (const name of KERNEL_TABLES) {
      if (name === "user") {
        sqlite.exec(
          `CREATE TABLE "user" (
            id text PRIMARY KEY NOT NULL,
            name text NOT NULL,
            email text NOT NULL,
            email_verified integer NOT NULL,
            image text,
            created_at integer NOT NULL,
            updated_at integer NOT NULL
          )`,
        );
      } else if (name === "organizations") {
        sqlite.exec(
          `CREATE TABLE organizations (
            id text PRIMARY KEY NOT NULL,
            name text NOT NULL,
            slug text NOT NULL,
            industry_pack text NOT NULL,
            created_at integer NOT NULL
          );
          CREATE UNIQUE INDEX organizations_slug_unique ON organizations (slug);`,
        );
      } else {
        sqlite.exec(`CREATE TABLE "${name}" (id text PRIMARY KEY NOT NULL)`);
      }
    }
    sqlite
      .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)")
      .run(LOCAL_OWNER_ID, "You", "local@agentforge.local");
    sqlite
      .prepare("INSERT INTO organizations (id, name, slug, industry_pack, created_at) VALUES (?, ?, ?, ?, 1)")
      .run("org-baseline", "Personal", PERSONAL_ORG_SLUG, "generic");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("does not refuse to open: tenants is deliberately not a required kernel table", () => {
    // `tenants` in REQUIRED_TABLES would make present>0 && missing>0 true here and throw
    // "Refusing to migrate or baseline-stamp" on the frozen desktop's first launch.
    expect(() => ensureSchema(sqlite)).not.toThrow();
  });

  it("heals the tenant root that the stamp skipped", () => {
    ensureSchema(sqlite);

    // Proof this really is the baseline-stamp path: 0015 was stamped, not run.
    const stamped = count(sqlite, "__drizzle_migrations");
    expect(stamped).toBeGreaterThanOrEqual(15);

    expect(sqlite.prepare("SELECT id FROM tenants").all()).toEqual([{ id: LOCAL_TENANT_ID }]);
    expect(columnNames(sqlite, "organizations")).toContain("tenant_id");
    expect(sqlite.prepare("SELECT id, tenant_id FROM organizations").all()).toEqual([
      { id: "org-baseline", tenant_id: LOCAL_TENANT_ID },
    ]);
    const indexes = indexNames(sqlite, "organizations");
    expect(indexes).toContain("organizations_tenant_slug");
    expect(indexes).not.toContain("organizations_slug_unique");
    expect(sqlite.prepare("SELECT id FROM user").all()).toEqual([{ id: LOCAL_OWNER_ID }]);
  });

  it("is safe to run twice", () => {
    ensureSchema(sqlite);
    expect(() => ensureSchema(sqlite)).not.toThrow();
    expect(count(sqlite, "tenants")).toBe(1);
    expect(count(sqlite, "organizations")).toBe(1);
  });
});

describe("the SQLite busy_timeout", () => {
  it("is 5000 ms on the connection the app opens", async () => {
    // WAL gives concurrent readers with one writer; without this a second writer gets SQLITE_BUSY
    // immediately instead of waiting, which is the whole Phase 3 database-engine change.
    const dataDir = tempDir("af-data-");
    const previousDataDir = process.env.AGENTFORGE_DATA_DIR;
    const previousUrl = process.env.DATABASE_URL;
    process.env.AGENTFORGE_DATA_DIR = dataDir;
    delete process.env.DATABASE_URL;
    try {
      const { sql } = await import("./client");
      expect(sql.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(sql.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(sql.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.AGENTFORGE_DATA_DIR;
      } else {
        process.env.AGENTFORGE_DATA_DIR = previousDataDir;
      }
      if (previousUrl !== undefined) {
        process.env.DATABASE_URL = previousUrl;
      }
    }
  });
});

describe("tenant provisioning", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    db = drizzle(sqlite, { schema });
  });

  afterEach(() => {
    sqlite.close();
  });

  it("writes a portal tenant once and returns the same row on a second sign-in", async () => {
    const first = await ensureTenant(db, { id: "t-portal", slug: "acme", name: "Acme" });
    expect(first.id).toBe("t-portal");
    expect(first.status).toBe("active");

    const second = await ensureTenant(db, { id: "t-portal", slug: "acme", name: "Acme" });
    expect(second.id).toBe(first.id);
    // Idempotent: a second sign-in is not a second tenant. Two rows = the local tenant
    // migration 0015 wrote, plus this one.
    expect(count(sqlite, "tenants")).toBe(2);
  });

  it("keeps the local tenant reachable beside provisioned ones", async () => {
    await ensureTenant(db, { id: "t-portal", slug: "acme", name: "Acme" });
    const local = await getLocalTenant(db);
    expect(local?.id).toBe(LOCAL_TENANT_ID);
    expect(await getTenantById(db, "nobody")).toBeNull();
  });
});

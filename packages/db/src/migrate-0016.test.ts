import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_TENANT_ID } from "@agentforge/core";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "./ensure-schema";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realMigrations = path.join(packageDir, "drizzle");

/**
 * Every column the Phase 5 lane A ledger must carry, whichever path created the table.
 *
 * Exact equality, not a subset: a column added to this table without a line here is a column
 * nobody reviewed. `billing_period_start` is lane B's, added by drizzle/0017_tenant_plan.sql and
 * by the healer, and it is in this list rather than in a second one because the two paths have to
 * agree about the *whole* shape of the table — which is the property these cases exist to hold.
 */
const LEDGER_COLUMNS = [
  "id",
  "tenant_id",
  "organization_id",
  "workspace_id",
  "user_id",
  "mode",
  "model",
  "unit",
  "quantity",
  "input_tokens",
  "output_tokens",
  "cost_usd_micros",
  "unpriced_reason",
  "run_id",
  "at",
  // Phase 5 lane B (drizzle/0017_tenant_plan.sql): the billing period this row counted against.
  "billing_period_start",
] as const;

function tableNames(sqlite: Database.Database): string[] {
  return (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
}

function indexNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

function insertRow(sqlite: Database.Database, over: Record<string, unknown> = {}): void {
  const row = {
    id: `u-${Math.random().toString(36).slice(2)}`,
    tenant_id: LOCAL_TENANT_ID,
    organization_id: "org-1",
    workspace_id: "ws-1",
    user_id: "user-1",
    mode: "chat",
    model: "gpt-5.6-sol",
    unit: "tokens",
    quantity: 140,
    input_tokens: 100,
    output_tokens: 40,
    cost_usd_micros: 2_500,
    unpriced_reason: null,
    run_id: "run-1",
    at: Date.now(),
    ...over,
  };
  sqlite
    .prepare(
      `INSERT INTO tenant_usage
         (id, tenant_id, organization_id, workspace_id, user_id, mode, model, unit, quantity,
          input_tokens, output_tokens, cost_usd_micros, unpriced_reason, run_id, at)
       VALUES (@id, @tenant_id, @organization_id, @workspace_id, @user_id, @mode, @model, @unit, @quantity,
               @input_tokens, @output_tokens, @cost_usd_micros, @unpriced_reason, @run_id, @at)`,
    )
    .run(row);
}

describe("0016_tenant_usage on a fresh database", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates tenant_usage with the full lane A column set", () => {
    expect(tableNames(sqlite)).toContain("tenant_usage");
    expect(columnNames(sqlite, "tenant_usage").sort()).toEqual([...LEDGER_COLUMNS].sort());
  });

  it("indexes the three reads the ledger is actually for", () => {
    const indexes = indexNames(sqlite, "tenant_usage");
    // The allowance query: this tenant, this period.
    expect(indexes).toContain("tenant_usage_tenant_at_idx");
    // The account screen's per-mode split.
    expect(indexes).toContain("tenant_usage_tenant_mode_idx");
    // Finding the rows a later repricing pass has to close.
    expect(indexes).toContain("tenant_usage_unpriced_idx");
  });

  it("starts empty — a migrated desktop has no retroactive spend", () => {
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_usage").get() as { n: number }).n).toBe(0);
  });

  it("accepts a priced row and an unpriced one", () => {
    insertRow(sqlite);
    insertRow(sqlite, { cost_usd_micros: null, unpriced_reason: "tiered_billing", mode: "research" });
    const rows = sqlite.prepare("SELECT mode, cost_usd_micros, unpriced_reason FROM tenant_usage ORDER BY mode").all();
    expect(rows).toEqual([
      { mode: "chat", cost_usd_micros: 2_500, unpriced_reason: null },
      { mode: "research", cost_usd_micros: null, unpriced_reason: "tiered_billing" },
    ]);
  });

  it("refuses a row for a tenant that does not exist", () => {
    expect(() => insertRow(sqlite, { tenant_id: "no-such-tenant" })).toThrow(/FOREIGN KEY/i);
  });

  it("takes a tenant's ledger with the tenant, and leaves it alone when an org goes", () => {
    sqlite
      .prepare("INSERT INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, 'active', 1)")
      .run("tenant-b", "b", "B");
    insertRow(sqlite, { tenant_id: "tenant-b" });
    insertRow(sqlite);

    sqlite.prepare("DELETE FROM tenants WHERE id = ?").run("tenant-b");
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_usage").get() as { n: number }).n).toBe(1);

    // `organization_id` is deliberately not a foreign key: a ledger must survive an org deletion,
    // or a period's billable spend disappears with it.
    const orgs = sqlite.prepare("SELECT id FROM organizations").all() as Array<{ id: string }>;
    for (const org of orgs) {
      sqlite.prepare("DELETE FROM organizations WHERE id = ?").run(org.id);
    }
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_usage").get() as { n: number }).n).toBe(1);
  });
});

describe("0016_tenant_usage on an existing database", () => {
  /**
   * Replay the committed migrations 0000-0015 exactly as `applyPendingMigrations` would, then
   * stamp the journal at 0015 — a genuine pre-Phase-5 database, not an approximation. `ensureSchema`
   * then takes the apply-pending path and runs 0016 for real.
   */
  function migrateThrough0015(sqlite: Database.Database): void {
    const journal = JSON.parse(readFileSync(path.join(realMigrations, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string; when: number }>;
    };
    const through = journal.entries.filter((entry) => entry.idx < 16);
    expect(through.at(-1)?.tag).toBe("0015_tenants");

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

  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("adds the ledger to a database stamped at 0015, and touches nothing else", () => {
    migrateThrough0015(sqlite);
    sqlite
      .prepare(
        "INSERT INTO organizations (id, tenant_id, name, slug, industry_pack, created_at) VALUES (?, ?, ?, ?, ?, 1)",
      )
      .run("org-existing", LOCAL_TENANT_ID, "Personal", "personal", "generic");
    const before = tableNames(sqlite).sort();
    expect(before).not.toContain("tenant_usage");

    ensureSchema(sqlite);

    expect(columnNames(sqlite, "tenant_usage").sort()).toEqual([...LEDGER_COLUMNS].sort());
    // Additive only: 0016 adds one table and removes none.
    expect(before.every((name) => tableNames(sqlite).includes(name))).toBe(true);
    // The existing organization is untouched — no re-seed, no lost row.
    expect(sqlite.prepare("SELECT id, tenant_id, slug FROM organizations").all()).toEqual([
      { id: "org-existing", tenant_id: LOCAL_TENANT_ID, slug: "personal" },
    ]);

    insertRow(sqlite, { organization_id: "org-existing" });
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_usage").get() as { n: number }).n).toBe(1);
  });

  it("heals a database baseline-stamped past 0016 without the table", () => {
    migrateThrough0015(sqlite);
    // The baseline-stamp case every healer in ensure-schema.ts covers: the journal row is there,
    // the table is not, because the database was stamped rather than migrated.
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run("stamped-0016_tenant_usage", 1788820000008);
    expect(tableNames(sqlite)).not.toContain("tenant_usage");

    ensureSchema(sqlite);

    expect(columnNames(sqlite, "tenant_usage").sort()).toEqual([...LEDGER_COLUMNS].sort());
    expect(indexNames(sqlite, "tenant_usage")).toContain("tenant_usage_tenant_at_idx");
    insertRow(sqlite);
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_usage").get() as { n: number }).n).toBe(1);
  });

  it("is idempotent: a second ensureSchema keeps the rows already in the ledger", () => {
    migrateThrough0015(sqlite);
    ensureSchema(sqlite);
    insertRow(sqlite);
    ensureSchema(sqlite);
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_usage").get() as { n: number }).n).toBe(1);
  });
});

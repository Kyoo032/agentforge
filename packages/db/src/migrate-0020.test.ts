/**
 * Phase 8 — `tenant_reset_audit`, the record of a per-tenant reset.
 *
 * The same three things 0019 had to get right, plus one that is specific to this table.
 *
 * 1. It exists on a fresh database, and on one baseline-stamped past 0020 without it (the healer in
 *    `ensure-schema.ts`).
 * 2. Its `when` sits above every migration already in the journal, because the runner is
 *    forward-only on `when` and a lower one would be silently skipped on every database that has
 *    already run 0017, 0018 and 0019.
 * 3. It must not touch `tenant_usage`, `tenant_plan`, `tenant_state` or `tenant_storage`.
 * 4. **It outlives the reset it records but goes with the tenant.** That is the whole point of
 *    hanging it off `tenants`, which a reset keeps, rather than off `organizations`, which a reset
 *    deletes — a cascade from the org would take the audit trail with the thing it is auditing.
 *
 * The skip-hazard test asserts the migration's own JOURNAL ROW rather than the table's existence,
 * because the healer creates the table too: a test that only looked for the table would pass on a
 * database where the migration never ran.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "./ensure-schema";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realMigrations = path.join(packageDir, "drizzle");

const AUDIT_COLUMNS = [
  "id",
  "tenant_id",
  "user_id",
  "organization_id",
  "outcome",
  "detail",
  "rows_deleted",
  "objects_deleted",
  "bytes_freed",
  "started_at",
  "finished_at",
] as const;

type JournalEntry = { idx: number; when: number; tag: string };

function journal(): JournalEntry[] {
  const raw = readFileSync(path.join(realMigrations, "meta", "_journal.json"), "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

function tableNames(sqlite: Database.Database): string[] {
  return (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
}

function seedTenant(sqlite: Database.Database, tenantId: string): void {
  sqlite
    .prepare("INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(tenantId, tenantId, tenantId, "active", Date.now());
}

function insertAudit(sqlite: Database.Database, id: string, tenantId: string, outcome: string): void {
  sqlite
    .prepare(
      `INSERT INTO tenant_reset_audit
         (id, tenant_id, user_id, organization_id, outcome, detail, rows_deleted, objects_deleted, bytes_freed, started_at, finished_at)
       VALUES (?, ?, 'u', 'o', ?, NULL, 0, 0, 0, ?, NULL)`,
    )
    .run(id, tenantId, outcome, Date.now());
}

describe("0020_tenant_reset_audit on a fresh database", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates the table with exactly the columns the reset writes", () => {
    expect(tableNames(sqlite)).toContain("tenant_reset_audit");
    expect(columnNames(sqlite, "tenant_reset_audit").sort()).toEqual([...AUDIT_COLUMNS].sort());
  });

  it("indexes by tenant and time, which is how an operator reads it", () => {
    const indexes = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tenant_reset_audit'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(indexes).toContain("tenant_reset_audit_tenant_idx");
  });

  it("keeps rows for a tenant whose content has been purged", () => {
    sqlite.pragma("foreign_keys = ON");
    seedTenant(sqlite, "kept-tenant");
    insertAudit(sqlite, "audit-1", "kept-tenant", "completed");
    // A reset deletes the tenant's organizations; the audit hangs off `tenants`, which it keeps.
    sqlite.prepare("DELETE FROM organizations WHERE tenant_id = ?").run("kept-tenant");
    const rows = sqlite
      .prepare("SELECT count(*) AS n FROM tenant_reset_audit WHERE tenant_id = ?")
      .get("kept-tenant") as { n: number };
    expect(rows.n).toBe(1);
  });

  it("goes with the tenant when an operator deletes the tenant itself", () => {
    sqlite.pragma("foreign_keys = ON");
    seedTenant(sqlite, "doomed-tenant");
    insertAudit(sqlite, "audit-2", "doomed-tenant", "completed");
    sqlite.prepare("DELETE FROM tenants WHERE id = ?").run("doomed-tenant");
    const rows = sqlite.prepare("SELECT count(*) AS n FROM tenant_reset_audit").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("holds a `started` row for a reset that never finished", () => {
    seedTenant(sqlite, "interrupted");
    insertAudit(sqlite, "audit-3", "interrupted", "started");
    const row = sqlite
      .prepare("SELECT outcome, finished_at FROM tenant_reset_audit WHERE id = ?")
      .get("audit-3") as { outcome: string; finished_at: number | null };
    // The shape a killed process leaves: a prompt to run the reset again, never a lock.
    expect(row.outcome).toBe("started");
    expect(row.finished_at).toBeNull();
  });

  it("leaves the other tenant tables alone", () => {
    const names = tableNames(sqlite);
    for (const table of ["tenant_usage", "tenant_plan", "tenant_state", "tenant_storage"]) {
      expect(names).toContain(table);
    }
    // `tenant_storage` in particular: 0019 is the migration directly below this one.
    expect(columnNames(sqlite, "tenant_storage")).toContain("bytes_used");
  });
});

describe("0020's place in the journal", () => {
  it("carries a `when` above every entry before it", () => {
    const entries = journal();
    const index = entries.findIndex((entry) => entry.tag === "0020_tenant_reset_audit");
    expect(index, "0020 is missing from the journal").toBeGreaterThan(-1);
    const before = entries.slice(0, index);
    expect(before.length).toBeGreaterThan(0);
    const when = entries[index]?.when ?? 0;
    for (const entry of before) {
      // The runner applies a migration only when `lastAppliedCreatedAt < entry.when`, so a `when`
      // below any already-applied entry is silently skipped forever. Asserted against the entries
      // BEFORE this one rather than against every other entry, so 0021 does not turn this red for
      // doing the right thing — which is exactly what 0020 did to the same assertion in 0019.
      expect(when, `${entry.tag} is at or above 0020`).toBeGreaterThan(entry.when);
    }
  });

  it("sits after 0019 in the entries array, so array order and `when` order agree", () => {
    const tags = journal().map((entry) => entry.tag);
    expect(tags.indexOf("0020_tenant_reset_audit")).toBeGreaterThan(tags.indexOf("0019_tenant_storage"));
  });

  it("names a file that exists and creates the table it claims to", () => {
    const sql = readFileSync(path.join(realMigrations, "0020_tenant_reset_audit.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `tenant_reset_audit`");
    expect(sql).toContain("REFERENCES `tenants`(`id`)");
    // Declared defensively, like 0010-0019, because the healer mirrors it for a stamped database.
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS `tenant_reset_audit_tenant_idx`");
  });
});

describe("the skip hazard", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("stamps 0020's own journal row when the runner applies it", () => {
    ensureSchema(sqlite);
    const entry = journal().find((row) => row.tag === "0020_tenant_reset_audit");
    expect(entry, "0020 is missing from the journal").toBeTruthy();
    const stamped = sqlite
      .prepare("SELECT count(*) AS n FROM `__drizzle_migrations` WHERE created_at >= ?")
      .get(entry?.when ?? 0) as { n: number };
    // Asserting the ROW, not the table: the healer creates the table too, so a test that looked
    // for the table would pass on a database where this migration was never applied.
    expect(stamped.n).toBeGreaterThan(0);
  });

  it("still has a usable table on a database stamped past 0020 without it", () => {
    ensureSchema(sqlite);
    sqlite.exec("DROP TABLE tenant_reset_audit");
    expect(tableNames(sqlite)).not.toContain("tenant_reset_audit");
    // Second boot: the journal row is already there, so the runner applies nothing and the healer
    // is the only thing that can put the table back.
    ensureSchema(sqlite);
    expect(tableNames(sqlite)).toContain("tenant_reset_audit");
    seedTenant(sqlite, "healed");
    insertAudit(sqlite, "audit-4", "healed", "completed");
    const rows = sqlite.prepare("SELECT count(*) AS n FROM tenant_reset_audit").get() as { n: number };
    expect(rows.n).toBe(1);
  });
});

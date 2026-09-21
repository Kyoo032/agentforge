/**
 * Phase 6 — `tenant_storage`, the per-tenant byte counter.
 *
 * Three things this has to get right and one it has to leave alone. It has to create the table on
 * a fresh database and on one baseline-stamped past 0019 without it (the healer in
 * `ensure-schema.ts`); the counter has to be one row per tenant and go with the tenant; and its
 * `when` has to sit above every migration already in the journal, because the runner is
 * forward-only on `when` and a lower one would be silently skipped on every database that has
 * already run 0017 and 0018. It must not touch `tenant_usage`, `tenant_plan` or `tenant_state`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_TENANT_ID } from "@agentforge/core";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "./ensure-schema";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realMigrations = path.join(packageDir, "drizzle");

const STORAGE_COLUMNS = ["tenant_id", "bytes_used", "object_count", "measured_at", "updated_at"] as const;

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

function put(sqlite: Database.Database, tenantId: string, bytesUsed: number, objectCount = 1): void {
  seedTenant(sqlite, tenantId);
  sqlite
    .prepare(
      `INSERT INTO tenant_storage (tenant_id, bytes_used, object_count, measured_at, updated_at)
       VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET bytes_used = excluded.bytes_used, object_count = excluded.object_count`,
    )
    .run(tenantId, bytesUsed, objectCount, Date.now());
}

describe("0019_tenant_storage on a fresh database", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates tenant_storage with exactly the five columns the accounting writes", () => {
    expect(tableNames(sqlite)).toContain("tenant_storage");
    expect(columnNames(sqlite, "tenant_storage").sort()).toEqual([...STORAGE_COLUMNS].sort());
  });

  it("starts empty — a migrated database has counted nobody's bytes yet", () => {
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_storage").get() as { n: number }).n).toBe(0);
  });

  it("defaults a new row to zero bytes and zero objects", () => {
    seedTenant(sqlite, "tenant-a");
    sqlite.prepare("INSERT INTO tenant_storage (tenant_id, updated_at) VALUES (?, ?)").run("tenant-a", Date.now());
    expect(sqlite.prepare("SELECT bytes_used, object_count, measured_at FROM tenant_storage").get()).toEqual({
      bytes_used: 0,
      object_count: 0,
      measured_at: null,
    });
  });

  it("keys one row per tenant", () => {
    put(sqlite, "tenant-a", 100);
    put(sqlite, "tenant-b", 250);
    seedTenant(sqlite, "tenant-a");
    expect(() =>
      sqlite
        .prepare("INSERT INTO tenant_storage (tenant_id, bytes_used, updated_at) VALUES (?, ?, ?)")
        .run("tenant-a", 999, Date.now()),
    ).toThrow(/UNIQUE|PRIMARY/i);

    expect(sqlite.prepare("SELECT tenant_id, bytes_used FROM tenant_storage ORDER BY tenant_id").all()).toEqual([
      { tenant_id: "tenant-a", bytes_used: 100 },
      { tenant_id: "tenant-b", bytes_used: 250 },
    ]);
  });

  it("takes a tenant's counter with the tenant, like tenant_state and unlike the ledger", () => {
    put(sqlite, "tenant-gone", 4096);
    sqlite.prepare("DELETE FROM tenants WHERE id = ?").run("tenant-gone");
    // A byte count has no meaning without the tenant. The usage ledger makes the opposite choice
    // on purpose, because spend has to outlive what it billed for.
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_storage").get() as { n: number }).n).toBe(0);
  });

  it("refuses a counter for a tenant this host has never heard of", () => {
    expect(() =>
      sqlite
        .prepare("INSERT INTO tenant_storage (tenant_id, bytes_used, updated_at) VALUES (?, ?, ?)")
        .run("tenant-nobody-provisioned", 1, Date.now()),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("leaves the Phase 4 and Phase 5 tables alone", () => {
    for (const table of ["tenant_usage", "tenant_plan", "tenant_seat", "billing_events", "tenant_state"]) {
      expect(tableNames(sqlite)).toContain(table);
      expect((sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
  });

  it("keeps the local tenant row migration 0015 created", () => {
    expect(sqlite.prepare("SELECT id FROM tenants").all()).toEqual([{ id: LOCAL_TENANT_ID }]);
  });
});

describe("0019_tenant_storage is in the committed migration set", () => {
  const journal = JSON.parse(readFileSync(path.join(realMigrations, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const whenOf = (tag: string): number => {
    const entry = journal.entries.find((row) => row.tag === tag);
    if (!entry) {
      throw new Error(`${tag} is not in the migration journal`);
    }
    return entry.when;
  };

  it("carries a `when` above every migration already in the journal", () => {
    // The runner applies a migration only when `lastAppliedCreatedAt < entry.when`, so `when` is
    // what decides what runs. 0018 took 1788820000010 and 0017 took 1788820000011, which is why
    // the idx column reads 18 then 17; anything below the highest of those would be skipped on
    // every database that has run them, and this table would never exist on a live server.
    const mine = whenOf("0019_tenant_storage");
    for (const entry of journal.entries.filter((row) => row.tag !== "0019_tenant_storage")) {
      expect(mine).toBeGreaterThan(entry.when);
    }
  });

  it("sits after 0017 and 0018 in the entries array, so array order and `when` order agree", () => {
    // The runner iterates the array and reads `lastAppliedCreatedAt` once before the loop, so the
    // two orders agreeing is what keeps "read the journal top to bottom" honest. Asserted as an
    // ORDER rather than as "0019 is last", which would go red on the next correct migration.
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.indexOf("0019_tenant_storage")).toBeGreaterThan(tags.indexOf("0018_tenant_state"));
    expect(tags.indexOf("0019_tenant_storage")).toBeGreaterThan(tags.indexOf("0017_tenant_plan"));
    const whens = journal.entries.map((entry) => entry.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });

  it("creates the same table the ensure-schema healer does", () => {
    const sqlText = readFileSync(path.join(realMigrations, "0019_tenant_storage.sql"), "utf8");
    for (const column of STORAGE_COLUMNS) {
      expect(sqlText).toContain(column);
    }
    expect(sqlText).toContain("ON DELETE cascade");
    // Additive only: nothing here may alter a table another phase owns.
    expect(sqlText).not.toContain("ALTER TABLE");
  });

  it("heals a database stamped past 0019 that never got the table", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite.exec("DROP TABLE tenant_storage");
    expect(tableNames(sqlite)).not.toContain("tenant_storage");

    ensureSchema(sqlite);

    expect(tableNames(sqlite)).toContain("tenant_storage");
    expect(columnNames(sqlite, "tenant_storage").sort()).toEqual([...STORAGE_COLUMNS].sort());
    sqlite.close();
  });

  it("actually ran as a migration, rather than only being healed into place", () => {
    // `ensureSchema` applies the migrations and THEN runs the healers, so "the table exists" is
    // not evidence the migration ran. The stamped row is.
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const stamps = sqlite.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at").all() as Array<{
      created_at: number;
    }>;
    expect(stamps.map((row) => row.created_at)).toContain(whenOf("0019_tenant_storage"));
    sqlite.close();
  });
});

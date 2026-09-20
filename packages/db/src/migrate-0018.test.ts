/**
 * Phase 4 — `tenant_state`, the per-tenant secrets and gate store.
 *
 * Two things this has to get right and one it has to leave alone. It has to create the table on a
 * fresh database and on one that was baseline-stamped past 0018 without it (the healer in
 * `ensure-schema.ts`); the composite primary key has to be the uniqueness rule, so one tenant's
 * `settings` write cannot land beside another of its own; and it must not touch `tenant_usage`,
 * which belongs to Phase 5.
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

const STATE_COLUMNS = ["tenant_id", "key", "value", "updated_at"] as const;

function tableNames(sqlite: Database.Database): string[] {
  return (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
    (row) => row.name,
  );
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
}

/**
 * The foreign key is enforced, so a row needs its tenant. That is the intended shape rather than
 * test scaffolding: `tenant_state` cannot hold secrets for a tenant this host has never heard of,
 * and lane C's `ensurePortalOwner` writes the tenant row on first sign-in, before any settings save.
 */
function seedTenant(sqlite: Database.Database, tenantId: string): void {
  sqlite
    .prepare("INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(tenantId, tenantId, tenantId, "active", Date.now());
}

function put(sqlite: Database.Database, tenantId: string, key: string, value: string): void {
  seedTenant(sqlite, tenantId);
  sqlite
    .prepare(
      `INSERT INTO tenant_state (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(tenantId, key, value, Date.now());
}

describe("0018_tenant_state on a fresh database", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates tenant_state with exactly the four columns the backend writes", () => {
    expect(tableNames(sqlite)).toContain("tenant_state");
    expect(columnNames(sqlite, "tenant_state").sort()).toEqual([...STATE_COLUMNS].sort());
  });

  it("starts empty — a migrated database has nobody's secrets in it yet", () => {
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_state").get() as { n: number }).n).toBe(0);
  });

  it("keys one row per tenant and payload kind", () => {
    put(sqlite, "tenant-a", "settings", "envelope-a");
    put(sqlite, "tenant-a", "gateway_gate", "verdict-a");
    put(sqlite, "tenant-b", "settings", "envelope-b");

    const rows = sqlite
      .prepare("SELECT tenant_id, key, value FROM tenant_state ORDER BY tenant_id, key")
      .all() as Array<{ tenant_id: string; key: string; value: string }>;
    expect(rows).toEqual([
      { tenant_id: "tenant-a", key: "gateway_gate", value: "verdict-a" },
      { tenant_id: "tenant-a", key: "settings", value: "envelope-a" },
      { tenant_id: "tenant-b", key: "settings", value: "envelope-b" },
    ]);
  });

  it("refuses a second row for the same tenant and key", () => {
    put(sqlite, "tenant-a", "settings", "first");
    seedTenant(sqlite, "tenant-a");
    expect(() =>
      sqlite
        .prepare("INSERT INTO tenant_state (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)")
        .run("tenant-a", "settings", "second", Date.now()),
    ).toThrow(/UNIQUE|PRIMARY/i);
    // An upsert is the supported write, and it replaces rather than duplicating.
    put(sqlite, "tenant-a", "settings", "second");
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_state").get() as { n: number }).n).toBe(1);
  });

  it("takes a tenant's state with the tenant, unlike the usage ledger", () => {
    put(sqlite, "tenant-gone", "settings", "envelope");

    sqlite.prepare("DELETE FROM tenants WHERE id = ?").run("tenant-gone");

    // The cascade is the point: a sealed key must not outlive the tenant it belongs to. The ledger
    // deliberately makes the opposite choice, because spend has to outlive what it billed for.
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_state").get() as { n: number }).n).toBe(0);
  });

  it("indexes the one query that does not start from a tenant id", () => {
    const indexes = (sqlite.prepare("PRAGMA index_list(tenant_state)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    // The rotation drill walks every tenant holding a `settings` payload.
    expect(indexes).toContain("tenant_state_key_idx");
  });

  it("leaves the Phase 5 ledger alone", () => {
    // Phase 5 lane A owns `tenant_usage` and lane B alters it; 0018 must be additive beside it.
    expect(tableNames(sqlite)).toContain("tenant_usage");
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_usage").get() as { n: number }).n).toBe(0);
  });

  it("keeps the local tenant row migration 0015 created", () => {
    const rows = sqlite.prepare("SELECT id FROM tenants").all() as Array<{ id: string }>;
    expect(rows).toEqual([{ id: LOCAL_TENANT_ID }]);
  });

  it("refuses state for a tenant this host has never heard of", () => {
    // Fail closed: the foreign key is the reason a stray tenant id cannot become a row of secrets.
    expect(() =>
      sqlite
        .prepare("INSERT INTO tenant_state (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)")
        .run("tenant-nobody-provisioned", "settings", "envelope", Date.now()),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe("0018_tenant_state is in the committed migration set", () => {
  it("is listed in the journal after 0016, with a later timestamp", () => {
    const journal = JSON.parse(readFileSync(path.join(realMigrations, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ tag: string; when: number }>;
    };
    const whenOf = (tag: string): number => {
      const entry = journal.entries.find((row) => row.tag === tag);
      if (!entry) {
        throw new Error(`${tag} is not in the migration journal`);
      }
      return entry.when;
    };
    // The runner applies a migration only when `lastAppliedCreatedAt < entry.when`, so ordering by
    // `when` is what actually decides what runs — the `idx` gap at 17 is cosmetic.
    expect(whenOf("0018_tenant_state")).toBeGreaterThan(whenOf("0016_tenant_usage"));

    // 0017 is reserved for Phase 5 lane B, which was in flight when this landed. When it arrives it
    // must take a `when` ABOVE this one (see the header of 0018_tenant_state.sql): a lower one on an
    // already-migrated database is forward-only skipped and its ALTERs never run.
    //
    // This asserts that ordering rather than 0017's absence on purpose. The earlier version of this
    // case demanded no `0017` tag exist at all, which would have gone red on lane B's perfectly
    // correct migration — and the obvious way to make a red like that go away is to delete the line,
    // taking the real rule with it.
    for (const entry of journal.entries.filter((row) => row.tag.startsWith("0017"))) {
      expect(entry.when).toBeGreaterThan(whenOf("0018_tenant_state"));
    }
  });

  it("creates the same table the ensure-schema healer does", () => {
    const sqlText = readFileSync(path.join(realMigrations, "0018_tenant_state.sql"), "utf8");
    // Both paths have to agree, because a baseline-stamped database only ever sees the healer.
    for (const column of STATE_COLUMNS) {
      expect(sqlText).toContain(column);
    }
    expect(sqlText).toContain("PRIMARY KEY (`tenant_id`, `key`)");
    expect(sqlText).toContain("ON DELETE cascade");
    // Additive only: nothing here may touch the Phase 5 ledger.
    expect(sqlText).not.toContain("ALTER TABLE `tenant_usage`");
  });

  it("heals a database stamped past 0018 that never got the table", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite.exec("DROP TABLE tenant_state");
    expect(tableNames(sqlite)).not.toContain("tenant_state");

    ensureSchema(sqlite);

    expect(tableNames(sqlite)).toContain("tenant_state");
    expect(columnNames(sqlite, "tenant_state").sort()).toEqual([...STATE_COLUMNS].sort());
    sqlite.close();
  });
});

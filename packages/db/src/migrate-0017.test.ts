/**
 * Phase 5 lane B — `tenant_plan`, `tenant_seat`, `billing_events`, and the period stamp on the
 * ledger.
 *
 * Four things this has to get right. It has to create everything on a fresh database and on one
 * baseline-stamped past it without the tables (the healer in `ensure-schema.ts`); it has to leave
 * a database that has never met the billing webhook behaving exactly as it did before Phase 5,
 * which means **no seed row**; it has to survive the journal's `idx` gap, where ordering is by
 * `when` and getting that wrong means the ALTER never runs; and the ALTER itself has to land on a
 * ledger that may or may not already exist.
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

const PLAN_COLUMNS = [
  "tenant_id",
  "kind",
  "status",
  "allowance_usd_micros",
  "spent_usd_micros",
  "unpriced_count",
  "period_start",
  "period_end",
  "seat_cap",
  "margin_multiple_micros",
  "currency",
  "updated_at",
] as const;

const SEAT_COLUMNS = ["tenant_id", "user_id", "organization_id", "claimed_at", "revoked_at", "revoked_by"] as const;

const EVENT_COLUMNS = ["event_id", "tenant_id", "kind", "occurred_at", "received_at", "applied", "detail"] as const;

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

function seedTenant(sqlite: Database.Database, tenantId: string): void {
  sqlite
    .prepare("INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(tenantId, tenantId, tenantId, "active", Date.now());
}

function insertPlan(sqlite: Database.Database, tenantId: string): void {
  seedTenant(sqlite, tenantId);
  sqlite
    .prepare(
      `INSERT INTO tenant_plan (tenant_id, kind, status, allowance_usd_micros, spent_usd_micros, unpriced_count,
         period_start, period_end, seat_cap, margin_multiple_micros, currency, updated_at)
       VALUES (?, 'personal', 'active', 1000, 0, 0, 0, 1, NULL, 1000000, 'USD', ?)`,
    )
    .run(tenantId, Date.now());
}

describe("0017_tenant_plan on a fresh database", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("creates the three tables with exactly the columns the store writes", () => {
    expect(tableNames(sqlite)).toEqual(expect.arrayContaining(["tenant_plan", "tenant_seat", "billing_events"]));
    expect(columnNames(sqlite, "tenant_plan").sort()).toEqual([...PLAN_COLUMNS].sort());
    expect(columnNames(sqlite, "tenant_seat").sort()).toEqual([...SEAT_COLUMNS].sort());
    expect(columnNames(sqlite, "billing_events").sort()).toEqual([...EVENT_COLUMNS].sort());
  });

  it("seeds no plan row, so a database that has never been sold anything is not blocked", () => {
    // This is the lane's own done-when: the desktop boots against an existing database with no
    // plan row and behaves exactly as it does today. "No row" is the default plan, in code.
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_plan").get() as { n: number }).n).toBe(0);
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_seat").get() as { n: number }).n).toBe(0);
    expect(sqlite.prepare("SELECT id FROM tenants").all()).toEqual([{ id: LOCAL_TENANT_ID }]);
  });

  it("gives the ledger the period column and its index", () => {
    expect(columnNames(sqlite, "tenant_usage")).toContain("billing_period_start");
    expect(indexNames(sqlite, "tenant_usage")).toContain("tenant_usage_period_idx");
    // Lane A's three indexes are untouched: this migration alters the table, it does not rebuild it.
    expect(indexNames(sqlite, "tenant_usage")).toEqual(
      expect.arrayContaining(["tenant_usage_tenant_at_idx", "tenant_usage_tenant_mode_idx", "tenant_usage_unpriced_idx"]),
    );
  });

  it("defaults the period stamp to null, because old rows were counted against nothing", () => {
    seedTenant(sqlite, "tenant-a");
    sqlite
      .prepare(
        `INSERT INTO tenant_usage (id, tenant_id, organization_id, mode, model, unit, quantity, at)
         VALUES ('u1', 'tenant-a', 'org-a', 'chat', 'm', 'tokens', 1, 1)`,
      )
      .run();
    expect(sqlite.prepare("SELECT billing_period_start AS p FROM tenant_usage").get()).toEqual({ p: null });
  });

  it("holds one plan row per tenant and refuses a second", () => {
    insertPlan(sqlite, "tenant-a");
    expect(() => insertPlan(sqlite, "tenant-a")).toThrow(/UNIQUE|PRIMARY/i);
  });

  it("takes a tenant's entitlement and seats with the tenant, unlike the ledger", () => {
    insertPlan(sqlite, "tenant-gone");
    sqlite
      .prepare("INSERT INTO tenant_seat (tenant_id, user_id, organization_id, claimed_at) VALUES (?, ?, ?, ?)")
      .run("tenant-gone", "user-1", "org-1", Date.now());

    sqlite.prepare("DELETE FROM tenants WHERE id = ?").run("tenant-gone");

    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_plan").get() as { n: number }).n).toBe(0);
    expect((sqlite.prepare("SELECT count(*) AS n FROM tenant_seat").get() as { n: number }).n).toBe(0);
  });

  it("refuses a plan for a tenant this host has never heard of", () => {
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO tenant_plan (tenant_id, period_start, period_end, updated_at) VALUES (?, 0, 1, ?)`,
        )
        .run("tenant-nobody", Date.now()),
    ).toThrow(/FOREIGN KEY/i);
  });

  it("accepts a billing event for a tenant it has never heard of", () => {
    // Deliberately no foreign key: the portal can sell to somebody before they first sign in, and
    // refusing that delivery would make the webhook un-replayable — the provider retires the
    // event and the plan never lands. It is stored unapplied instead.
    sqlite
      .prepare(
        `INSERT INTO billing_events (event_id, tenant_id, kind, occurred_at, received_at, applied, detail)
         VALUES ('evt-1', 'tenant-not-yet', 'entitlement.set', 1, 2, 0, 'unknown_tenant')`,
      )
      .run();
    expect((sqlite.prepare("SELECT count(*) AS n FROM billing_events").get() as { n: number }).n).toBe(1);
  });

  it("refuses a second delivery of the same event id, which is the idempotency", () => {
    const insert = (): void => {
      sqlite
        .prepare(
          `INSERT INTO billing_events (event_id, tenant_id, kind, occurred_at, received_at, applied)
           VALUES ('evt-dup', 't', 'entitlement.set', 1, 2, 1)`,
        )
        .run();
    };
    insert();
    expect(insert).toThrow(/UNIQUE|PRIMARY/i);
  });

  it("keys a seat on the person, so one person cannot hold two of a tenant's seats", () => {
    seedTenant(sqlite, "tenant-a");
    const claim = (): void => {
      sqlite
        .prepare("INSERT INTO tenant_seat (tenant_id, user_id, organization_id, claimed_at) VALUES (?, ?, ?, ?)")
        .run("tenant-a", "user-1", "org-1", Date.now());
    };
    claim();
    expect(claim).toThrow(/UNIQUE|PRIMARY/i);
  });

  it("indexes the one query sign-in runs", () => {
    expect(indexNames(sqlite, "tenant_seat")).toContain("tenant_seat_live_idx");
    expect(indexNames(sqlite, "billing_events")).toContain("billing_events_tenant_idx");
  });

  it("defaults a plan row to the values the pure default says", () => {
    seedTenant(sqlite, "tenant-a");
    sqlite
      .prepare("INSERT INTO tenant_plan (tenant_id, period_start, period_end, updated_at) VALUES (?, 0, 1, ?)")
      .run("tenant-a", Date.now());
    expect(sqlite.prepare("SELECT kind, status, spent_usd_micros, margin_multiple_micros, currency FROM tenant_plan").get()).toEqual(
      { kind: "personal", status: "active", spent_usd_micros: 0, margin_multiple_micros: 1_000_000, currency: "USD" },
    );
  });
});

describe("0017_tenant_plan is in the committed migration set", () => {
  const journal = (): { entries: Array<{ idx: number; tag: string; when: number }> } =>
    JSON.parse(readFileSync(path.join(realMigrations, "meta", "_journal.json"), "utf8"));

  const whenOf = (tag: string): number => {
    const entry = journal().entries.find((row) => row.tag === tag);
    if (!entry) {
      throw new Error(`${tag} is not in the migration journal`);
    }
    return entry.when;
  };

  it("carries a `when` above 0018's, or it would never run", () => {
    // The hazard 0018's own header names. The runner applies a migration only when
    // `lastAppliedCreatedAt < entry.when`, so a `when` below 0018's is silently skipped on every
    // database that has already run 0018 — and with it, the ALTER on the ledger.
    expect(whenOf("0017_tenant_plan")).toBeGreaterThan(whenOf("0018_tenant_state"));
    expect(whenOf("0017_tenant_plan")).toBeGreaterThan(whenOf("0016_tenant_usage"));
  });

  it("sits after 0018 in the entries array, so array order and `when` order agree", () => {
    // The runner iterates the array, and `lastAppliedCreatedAt` is read once before the loop, so
    // the two orders agreeing is what keeps "read the journal top to bottom" an honest way to
    // understand what happens. The `idx` gap at 17 is cosmetic and stays that way.
    //
    // This asserts the ORDER rather than "0017 is the last entry", which is what it said when 0017
    // was the newest migration in the repository. Phase 6's 0019 then made that line red without
    // anything being wrong, and the obvious way to make a red like that go away is to delete it,
    // taking the real rule with it. The rule is: ascending by `when`, and after 0018.
    const entries = journal().entries;
    const tags = entries.map((entry) => entry.tag);
    expect(tags.indexOf("0017_tenant_plan")).toBeGreaterThan(tags.indexOf("0018_tenant_state"));
    const whens = entries.map((entry) => entry.when);
    expect([...whens].sort((a, b) => a - b)).toEqual(whens);
  });

  it("creates the same tables the ensure-schema healer does", () => {
    const sqlText = readFileSync(path.join(realMigrations, "0017_tenant_plan.sql"), "utf8");
    for (const column of [...PLAN_COLUMNS, ...SEAT_COLUMNS, ...EVENT_COLUMNS]) {
      expect(sqlText).toContain(column);
    }
    expect(sqlText).toContain("ALTER TABLE `tenant_usage` ADD `billing_period_start` integer");
    // The net under that ALTER: a database baseline-stamped past 0016 without the table would
    // otherwise abort the whole migration transaction.
    expect(sqlText).toContain("CREATE TABLE IF NOT EXISTS `tenant_usage`");
    // `billing_events` must not gain a foreign key: see the case above.
    expect(sqlText).not.toMatch(/`tenant_id` text NOT NULL REFERENCES `tenants`[^\n]*\n\s*-- entitlement\.set/);
  });

  it("heals a database stamped past 0017 that never got the tables", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite.exec("DROP TABLE tenant_plan; DROP TABLE tenant_seat; DROP TABLE billing_events");

    ensureSchema(sqlite);

    expect(columnNames(sqlite, "tenant_plan").sort()).toEqual([...PLAN_COLUMNS].sort());
    expect(columnNames(sqlite, "tenant_seat").sort()).toEqual([...SEAT_COLUMNS].sort());
    expect(columnNames(sqlite, "billing_events").sort()).toEqual([...EVENT_COLUMNS].sort());
    sqlite.close();
  });

  it("heals a ledger that has the table but not the period column", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    // The shape a database stamped past 0017 has: 0016's table, without 0017's ALTER.
    sqlite.exec("DROP TABLE tenant_usage");
    sqlite.exec(`
      CREATE TABLE tenant_usage (
        id text PRIMARY KEY NOT NULL, tenant_id text NOT NULL, organization_id text NOT NULL,
        workspace_id text, user_id text, mode text NOT NULL, model text NOT NULL, unit text NOT NULL,
        quantity integer NOT NULL, input_tokens integer DEFAULT 0 NOT NULL,
        output_tokens integer DEFAULT 0 NOT NULL, cost_usd_micros integer, unpriced_reason text,
        run_id text, at integer NOT NULL
      );
    `);
    expect(columnNames(sqlite, "tenant_usage")).not.toContain("billing_period_start");

    ensureSchema(sqlite);

    expect(columnNames(sqlite, "tenant_usage")).toContain("billing_period_start");
    expect(indexNames(sqlite, "tenant_usage")).toContain("tenant_usage_period_idx");
    sqlite.close();
  });

  /** A database as it stood after 0016: lane A's ledger, and nothing Phase 4 or lane B added. */
  function databaseStoppedAt0016(): Database.Database {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite.exec("DROP TABLE tenant_plan; DROP TABLE tenant_seat; DROP TABLE billing_events; DROP TABLE tenant_state");
    // The ledger has to go back to its 0016 shape too, or the ALTER in 0017 meets a column that
    // is already there. SQLite cannot drop a column before 3.35 and drizzle cannot branch, so the
    // table is rebuilt exactly as 0016 wrote it.
    sqlite.exec("DROP TABLE tenant_usage");
    sqlite.exec(`
      CREATE TABLE tenant_usage (
        id text PRIMARY KEY NOT NULL, tenant_id text NOT NULL, organization_id text NOT NULL,
        workspace_id text, user_id text, mode text NOT NULL, model text NOT NULL, unit text NOT NULL,
        quantity integer NOT NULL, input_tokens integer DEFAULT 0 NOT NULL,
        output_tokens integer DEFAULT 0 NOT NULL, cost_usd_micros integer, unpriced_reason text,
        run_id text, at integer NOT NULL
      );
    `);
    sqlite.exec(`DELETE FROM __drizzle_migrations WHERE created_at > ${whenOf("0016_tenant_usage")}`);
    return sqlite;
  }

  it("runs on a database that stopped at 0016, without losing 0018", () => {
    // The real upgrade path for the hosted deploy, driven rather than reasoned about.
    const sqlite = databaseStoppedAt0016();
    const through16 = journal().entries.filter((entry) => entry.when <= whenOf("0016_tenant_usage")).length;
    expect((sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n).toBe(through16);

    ensureSchema(sqlite);

    expect(tableNames(sqlite)).toEqual(
      expect.arrayContaining(["tenant_plan", "tenant_seat", "billing_events", "tenant_state"]),
    );
    // Both migrations ran, in either order, and the ledger carries the ALTER.
    expect(columnNames(sqlite, "tenant_usage")).toContain("billing_period_start");
    sqlite.close();
  });

  it("applies 0017 on a database that already ran 0018 — the skip hazard, driven", () => {
    // 0018's header says a `when` below its own would be SILENTLY skipped here. This is that
    // claim as a test: stamp a database at exactly 0018's `when` and watch 0017 still apply.
    //
    // The assertion is the JOURNAL ROW, not the table. `ensureSchema` runs `applyPendingMigrations`
    // and THEN the healers (`ensureTenantPlanTables`), so "`tenant_plan` exists afterwards" is
    // true even when the migration was skipped — the healer would have built it. Only a row
    // stamped with 0017's own `when` proves the migration itself ran, which is the hazard this
    // test exists for.
    const sqlite = databaseStoppedAt0016();
    sqlite.exec(
      `INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('0018-stand-in', ${whenOf("0018_tenant_state")})`,
    );
    const stampedFor0017 = (): number =>
      (
        sqlite
          .prepare("SELECT count(*) AS n FROM __drizzle_migrations WHERE created_at = ?")
          .get(whenOf("0017_tenant_plan")) as { n: number }
      ).n;
    expect(stampedFor0017()).toBe(0);

    ensureSchema(sqlite);

    expect(stampedFor0017()).toBe(1);
    expect(tableNames(sqlite)).toContain("tenant_plan");
    expect(columnNames(sqlite, "tenant_usage")).toContain("billing_period_start");
    sqlite.close();
  });
});

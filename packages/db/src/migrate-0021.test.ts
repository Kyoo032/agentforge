/**
 * 0021 — `auth_sessions` stores a digest of the cookie id, and when the portal last vouched for it.
 *
 * Four things this has to get right, the same three every migration since 0017 has had to, plus
 * one of its own:
 *
 * 1. `portal_checked_at` exists on a fresh database, on an upgraded one, and on one baseline-stamped
 *    past 0021 without it (the healer in `ensure-schema.ts`).
 * 2. Its `when` sits above every entry before it, because the runner is forward-only on `when`.
 * 3. It touches no other table.
 * 4. **It deletes every session row that was already there.** Each of those rows is keyed by a raw
 *    cookie id, which the host no longer looks up, so they are dead as sessions — and deleting them
 *    takes the last replayable ids off disk rather than leaving them for the 30-day purge.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "./ensure-schema";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realMigrations = path.join(packageDir, "drizzle");
const TAG = "0021_auth_session_hardening";

type JournalEntry = { idx: number; when: number; tag: string };

function journal(): JournalEntry[] {
  const raw = readFileSync(path.join(realMigrations, "meta", "_journal.json"), "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
}

function insertSession(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      "INSERT INTO auth_sessions (id, tenant_id, user_id, org_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES (?, 'tnt', 'usr', 'org', 1, 1, 2, 3)",
    )
    .run(id);
}

function count(sqlite: Database.Database, table: string): number {
  return (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/**
 * Replay the committed migrations up to and including 0020, exactly as the runner would, and stamp
 * the journal there. Deliberately not `ensureSchema` with a truncated folder: its healers would add
 * the very column this fixture must not have yet.
 */
function migrateThrough0020(sqlite: Database.Database): void {
  const entries = journal();
  const through = entries.slice(0, entries.findIndex((entry) => entry.tag === "0020_tenant_reset_audit") + 1);
  expect(through.at(-1)?.tag).toBe("0020_tenant_reset_audit");
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );
  const stamp = sqlite.prepare("INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES (?, ?)");
  for (const entry of through) {
    const file = readFileSync(path.join(realMigrations, `${entry.tag}.sql`), "utf8");
    for (const statement of file.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        sqlite.exec(trimmed);
      }
    }
    stamp.run(`replayed-${entry.tag}`, entry.when);
  }
  sqlite.pragma("foreign_keys = ON");
}

describe("0021 on a fresh database", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    ensureSchema(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("adds portal_checked_at and refresh_sealed, nullable, after the columns 0014 made", () => {
    expect(columnNames(sqlite, "auth_sessions")).toEqual([
      "id",
      "tenant_id",
      "user_id",
      "org_id",
      "created_at",
      "last_seen_at",
      "expires_at",
      "absolute_expires_at",
      "revoked_at",
      "portal_checked_at",
      "refresh_sealed",
    ]);
    insertSession(sqlite, "a".repeat(64));
    const row = sqlite.prepare("SELECT portal_checked_at, refresh_sealed FROM auth_sessions").get() as {
      portal_checked_at: unknown;
      refresh_sealed: unknown;
    };
    expect(row.portal_checked_at).toBeNull();
    expect(row.refresh_sealed).toBeNull();
  });

  it("leaves rows written after it alone on the next boot", () => {
    insertSession(sqlite, "b".repeat(64));
    ensureSchema(sqlite);
    expect(count(sqlite, "auth_sessions")).toBe(1);
  });
});

describe("0021 on a database upgraded from 0020", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    migrateThrough0020(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("starts from a table without the column, so the fixture is honest", () => {
    expect(columnNames(sqlite, "auth_sessions")).not.toContain("portal_checked_at");
  });

  it("deletes every session keyed by a raw cookie id, and nothing else", () => {
    insertSession(sqlite, "raw-cookie-id-one");
    insertSession(sqlite, "raw-cookie-id-two");
    const tenantsBefore = count(sqlite, "tenants");
    ensureSchema(sqlite);
    expect(count(sqlite, "auth_sessions")).toBe(0);
    expect(count(sqlite, "tenants")).toBe(tenantsBefore);
    expect(columnNames(sqlite, "auth_sessions")).toContain("portal_checked_at");
  });

  it("stamps its own journal row, so the delete never runs twice", () => {
    ensureSchema(sqlite);
    const entry = journal().find((row) => row.tag === TAG);
    expect(entry, `${TAG} is missing from the journal`).toBeTruthy();
    const stamped = sqlite
      .prepare("SELECT count(*) AS n FROM `__drizzle_migrations` WHERE created_at = ?")
      .get(entry?.when ?? 0) as { n: number };
    expect(stamped.n).toBe(1);
    insertSession(sqlite, "c".repeat(64));
    ensureSchema(sqlite);
    expect(count(sqlite, "auth_sessions")).toBe(1);
  });
});

describe("0021's place in the journal", () => {
  it("carries a `when` above every entry before it", () => {
    const entries = journal();
    const index = entries.findIndex((entry) => entry.tag === TAG);
    expect(index, `${TAG} is missing from the journal`).toBeGreaterThan(-1);
    const when = entries[index]?.when ?? 0;
    for (const entry of entries.slice(0, index)) {
      expect(when, `${entry.tag} is at or above 0021`).toBeGreaterThan(entry.when);
    }
  });

  it("sits after 0020 in the entries array", () => {
    const tags = journal().map((entry) => entry.tag);
    expect(tags.indexOf(TAG)).toBeGreaterThan(tags.indexOf("0020_tenant_reset_audit"));
  });

  it("names a file that rebuilds the table with the column and both indexes, and no ALTER", () => {
    const sql = readFileSync(path.join(realMigrations, `${TAG}.sql`), "utf8");
    expect(sql).toContain("DROP TABLE IF EXISTS `auth_sessions`");
    expect(sql).toContain("`portal_checked_at` integer");
    expect(sql).toContain("`refresh_sealed` text");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS `auth_sessions_user_seen_idx`");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS `auth_sessions_expires_idx`");
    // An ALTER cannot be replayed: a database whose journal is rewound past 0021 (the 0017 and 0018
    // suites build exactly that) would meet a column that is already there and abort the boot.
    const statements = sql
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/ALTER TABLE/i);
  });

  it("can be replayed on a database that already has the column", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const entry = journal().find((row) => row.tag === TAG);
    sqlite.exec(`DELETE FROM __drizzle_migrations WHERE created_at >= ${entry?.when ?? 0}`);
    expect(() => ensureSchema(sqlite)).not.toThrow();
    expect(columnNames(sqlite, "auth_sessions")).toContain("portal_checked_at");
    const indexes = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'auth_sessions'")
        .all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    expect(indexes).toEqual(expect.arrayContaining(["auth_sessions_user_seen_idx", "auth_sessions_expires_idx"]));
    sqlite.close();
  });
});

describe("the healer", () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(":memory:");
  });

  afterEach(() => {
    sqlite.close();
  });

  it("adds the column to a database stamped past 0021 without it", () => {
    ensureSchema(sqlite);
    sqlite.exec("DROP TABLE auth_sessions");
    // Recreated the pre-0021 way: the journal already says 0021 ran, so only the healer can help.
    sqlite.exec(`CREATE TABLE auth_sessions (
      id text PRIMARY KEY NOT NULL, tenant_id text NOT NULL, user_id text NOT NULL, org_id text NOT NULL,
      created_at integer NOT NULL, last_seen_at integer NOT NULL, expires_at integer NOT NULL,
      absolute_expires_at integer NOT NULL, revoked_at integer)`);
    insertSession(sqlite, "d".repeat(64));
    ensureSchema(sqlite);
    expect(columnNames(sqlite, "auth_sessions")).toContain("portal_checked_at");
    expect(columnNames(sqlite, "auth_sessions")).toContain("refresh_sealed");
    // A healer adds; it never deletes. Only the migration, once, clears the raw ids.
    expect(count(sqlite, "auth_sessions")).toBe(1);
  });

  it("creates the table with the column when it is missing altogether", () => {
    ensureSchema(sqlite);
    sqlite.exec("DROP TABLE auth_sessions");
    ensureSchema(sqlite);
    expect(columnNames(sqlite, "auth_sessions")).toContain("portal_checked_at");
  });
});

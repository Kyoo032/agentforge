import Database from "better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { ensureSchema, listKernelTables } from "./ensure-schema";
import { authSessions } from "./schema";

function columnsOf(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
}

describe("auth_sessions", () => {
  it("is created by the migration on a fresh database", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    expect(listKernelTables(sqlite)).toContain("auth_sessions");
    expect(columnsOf(sqlite, "auth_sessions")).toEqual([
      "id",
      "tenant_id",
      "user_id",
      "org_id",
      "created_at",
      "last_seen_at",
      "expires_at",
      "absolute_expires_at",
      "revoked_at",
    ]);
    sqlite.close();
  });

  it("matches the drizzle table definition", () => {
    const config = getTableConfig(authSessions);
    expect(config.name).toBe("auth_sessions");
    expect(config.columns.map((column) => column.name)).toEqual([
      "id",
      "tenant_id",
      "user_id",
      "org_id",
      "created_at",
      "last_seen_at",
      "expires_at",
      "absolute_expires_at",
      "revoked_at",
    ]);
    expect(config.indexes.map((index) => index.config.name).sort()).toEqual([
      "auth_sessions_expires_idx",
      "auth_sessions_user_seen_idx",
    ]);
  });

  it("survives a second ensureSchema and keeps its rows", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite
      .prepare(
        "INSERT INTO auth_sessions (id, tenant_id, user_id, org_id, created_at, last_seen_at, expires_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run("s1", "tnt", "usr", "org", 1, 1, 2, 3);
    ensureSchema(sqlite);
    const row = sqlite.prepare("SELECT id, revoked_at FROM auth_sessions").get() as {
      id: string;
      revoked_at: number | null;
    };
    expect(row).toEqual({ id: "s1", revoked_at: null });
    sqlite.close();
  });

  it("is created on a database that was baseline-stamped before the migration existed", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite.exec("DROP TABLE auth_sessions");
    // A stamped journal makes the migration a no-op; ensure-schema's defensive CREATE is the net.
    ensureSchema(sqlite);
    expect(listKernelTables(sqlite)).toContain("auth_sessions");
    sqlite.close();
  });
});

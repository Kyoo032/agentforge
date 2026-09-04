import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { assertKernelTables, ensureSchema, listKernelTables } from "./ensure-schema";

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

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("ensureSchema", () => {
  it("creates kernel tables on an empty database", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const tables = listKernelTables(sqlite);
    expect(KERNEL_TABLES.every((name) => tables.includes(name))).toBe(true);
    expect(tables).toEqual(
      expect.arrayContaining([
        ...KERNEL_TABLES,
        "knowledge_soul",
        "knowledge_memories",
        "knowledge_sources",
        "knowledge_settings",
        "knowledge_vectors",
        "knowledge_maps",
      ]),
    );
    assertKernelTables(sqlite);
    sqlite.close();
  });

  it("is safe to run twice", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    ensureSchema(sqlite);
    sqlite
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)",
      )
      .run("u1", "You", "local@agentforge.local");
    const count = sqlite.prepare("SELECT count(*) AS n FROM user").get() as { n: number };
    expect(count.n).toBe(1);
    sqlite.close();
  });

  it("baseline-stamps existing kernel tables without recreating them", () => {
    const sqlite = new Database(":memory:");
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
      } else {
        sqlite.exec(`CREATE TABLE "${name}" (id text PRIMARY KEY NOT NULL)`);
      }
    }
    sqlite
      .prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)",
      )
      .run("u-baseline", "Baseline", "baseline@agentforge.local");

    expect(() => ensureSchema(sqlite)).not.toThrow();
    const count = sqlite.prepare("SELECT count(*) AS n FROM user").get() as { n: number };
    expect(count.n).toBe(1);
    const row = sqlite.prepare("SELECT id FROM user WHERE id = ?").get("u-baseline") as
      | { id: string }
      | undefined;
    expect(row?.id).toBe("u-baseline");
    const journal = sqlite
      .prepare("SELECT count(*) AS n FROM __drizzle_migrations")
      .get() as { n: number };
    expect(journal.n).toBeGreaterThan(0);
    const cols = sqlite.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    expect(cols.map((column) => column.name)).toEqual(
      expect.arrayContaining(["id", "template_pack", "product_modes"]),
    );
    sqlite.close();
  });

  it("heals template_pack when the journal already stamped 0001", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE workspaces (
        id text PRIMARY KEY NOT NULL,
        organization_id text NOT NULL,
        name text NOT NULL,
        slug text NOT NULL,
        created_at integer NOT NULL
      );
    `);
    for (const name of KERNEL_TABLES) {
      if (name === "workspaces") {
        continue;
      }
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
      } else {
        sqlite.exec(`CREATE TABLE "${name}" (id text PRIMARY KEY NOT NULL)`);
      }
    }
    sqlite.exec(`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    sqlite
      .prepare(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`)
      .run("already-stamped-0001", 1788560000000);

    ensureSchema(sqlite);
    const row = sqlite.prepare("SELECT template_pack FROM workspaces LIMIT 1").get();
    expect(row).toBeUndefined();
    const cols = sqlite.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    expect(cols.some((column) => column.name === "template_pack")).toBe(true);
    expect(cols.some((column) => column.name === "product_modes")).toBe(true);
    sqlite.close();
  });

  it("records organization_id FKs on agent_versions and agent_tool_bindings", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);

    const versionFks = sqlite.pragma("foreign_key_list('agent_versions')") as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    expect(
      versionFks.some((fk) => fk.from === "organization_id" && fk.table === "organizations"),
    ).toBe(true);

    const bindingFks = sqlite.pragma("foreign_key_list('agent_tool_bindings')") as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    expect(
      bindingFks.some((fk) => fk.from === "organization_id" && fk.table === "organizations"),
    ).toBe(true);
    sqlite.close();
  });

  it("creates unique indexes tools_key_unique and user_email_unique", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const indexes = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('tools_key_unique', 'user_email_unique') ORDER BY 1`,
      )
      .all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual(["tools_key_unique", "user_email_unique"]);
    sqlite.close();
  });

  it("has no schema drift against drizzle-kit check", () => {
    let drizzleKitBin: string | undefined;
    try {
      const require = createRequire(path.join(packageDir, "package.json"));
      const main = require.resolve("drizzle-kit");
      const candidate = path.join(path.dirname(main), "bin.cjs");
      if (existsSync(candidate)) {
        drizzleKitBin = candidate;
      }
    } catch {
      // resolved below
    }
    if (!drizzleKitBin) {
      console.warn("skipping anti-drift: drizzle-kit unavailable");
      return;
    }

    try {
      execFileSync(process.execPath, [drizzleKitBin, "check"], {
        cwd: packageDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const detail = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n");
      throw new Error(`drizzle-kit check failed (schema drift):\n${detail}`);
    }
  });
});

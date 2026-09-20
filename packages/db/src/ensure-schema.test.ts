import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { assertKernelTables, ensureSchema, listKernelTables } from "./ensure-schema";
import {
  knowledgeGraphEdges,
  knowledgeGraphNodes,
  knowledgeRetrievals,
  knowledgeVectors,
  knowledgeVerify,
  knowledgeWorkspaceBackend,
} from "./schema";

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
        "knowledge_retrievals",
        "knowledge_graph_nodes",
        "knowledge_graph_edges",
        "knowledge_verify",
        "edit_projects",
        "edit_ops",
        "edit_snapshots",
        "edit_jobs",
        "edit_cards",
        "edit_unplaced",
        "artifacts",
        "datasets",
        "market_cache",
        "market_news_fts",
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
      .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)")
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
      .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)")
      .run("u-baseline", "Baseline", "baseline@agentforge.local");

    expect(() => ensureSchema(sqlite)).not.toThrow();
    const count = sqlite.prepare("SELECT count(*) AS n FROM user").get() as { n: number };
    expect(count.n).toBe(1);
    const row = sqlite.prepare("SELECT id FROM user WHERE id = ?").get("u-baseline") as { id: string } | undefined;
    expect(row?.id).toBe("u-baseline");
    const journal = sqlite.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number };
    expect(journal.n).toBeGreaterThan(0);
    const cols = sqlite.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>;
    expect(cols.map((column) => column.name)).toEqual(expect.arrayContaining(["id", "template_pack", "product_modes"]));
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
      if (name === "organizations") {
        // Migrations replayed from 0001 onward touch these columns (0015 re-keys slug uniqueness
        // onto (tenant_id, slug)), so the stub has to carry what a real 0001-era database has.
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
      } else if (name === "user") {
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

  it("adds work-origin columns and a unique origin index to knowledge_sources", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const cols = (sqlite.prepare("PRAGMA table_info(knowledge_sources)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(cols).toEqual(expect.arrayContaining(["origin_kind", "origin_id"]));
    const insert = sqlite.prepare(
      `INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at, origin_kind, origin_id)
       VALUES (?, 'ws', 'card', 'Chat', 'Indexed', 1, NULL, 1, ?, ?)`,
    );
    insert.run("s1", "thread", "t1");
    expect(() => insert.run("s2", "thread", "t1")).toThrow(/UNIQUE/);
    // File / URL / Paste sources have no origin; NULLs never collide.
    insert.run("s3", null, null);
    insert.run("s4", null, null);
    sqlite.close();
  });

  it("heals knowledge_sources origin columns on a table created before 0008", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite.exec(`
      DROP INDEX IF EXISTS knowledge_sources_origin_idx;
      ALTER TABLE knowledge_sources DROP COLUMN origin_id;
      ALTER TABLE knowledge_sources DROP COLUMN origin_kind;
    `);
    ensureSchema(sqlite);
    const cols = (sqlite.prepare("PRAGMA table_info(knowledge_sources)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(cols).toEqual(expect.arrayContaining(["origin_kind", "origin_id"]));
    const indexes = sqlite.prepare("PRAGMA index_list(knowledge_sources)").all() as Array<{ name: string; unique: number }>;
    expect(indexes.some((row) => row.name === "knowledge_sources_origin_idx" && row.unique === 1)).toBe(true);
    sqlite.close();
  });

  it("creates knowledge_retrievals with its workspace indexes", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const cols = (sqlite.prepare("PRAGMA table_info(knowledge_retrievals)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "thread_id",
        "run_id",
        "source_id",
        "chunk_index",
        "score",
        "backend",
        "created_at",
      ]),
    );
    const indexes = (sqlite.prepare("PRAGMA index_list(knowledge_retrievals)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    expect(indexes).toEqual(
      expect.arrayContaining(["knowledge_retrievals_ws_created_idx", "knowledge_retrievals_ws_source_idx"]),
    );
    sqlite
      .prepare(
        `INSERT INTO knowledge_retrievals
           (id, workspace_id, thread_id, run_id, source_id, chunk_index, score, backend, created_at)
         VALUES (?, 'ws', 't1', 'r1', 's1', 0, 0.5, 'builtin', 1)`,
      )
      .run("kr-1");
    const row = sqlite.prepare("SELECT score FROM knowledge_retrievals WHERE id = ?").get("kr-1") as { score: number };
    expect(row.score).toBeCloseTo(0.5);
    sqlite.close();
  });

  it("declares knowledge_retrievals in the drizzle schema, matching the migration", () => {
    // Drift guard: the table exists in drizzle/0010 and in ensureSchema, so it has to exist in
    // schema.ts too or `drizzle-kit generate` would emit a CREATE TABLE for it all over again.
    const config = getTableConfig(knowledgeRetrievals);
    expect(config.name).toBe("knowledge_retrievals");
    expect(config.columns.map((column) => column.name).sort()).toEqual(
      ["backend", "chunk_index", "created_at", "id", "run_id", "score", "source_id", "thread_id", "workspace_id"],
    );
    const notNull = config.columns.filter((column) => column.notNull).map((column) => column.name).sort();
    expect(notNull).toEqual(["backend", "chunk_index", "created_at", "id", "score", "source_id", "workspace_id"]);
    expect(config.columns.find((column) => column.name === "score")?.getSQLType()).toBe("real");
    expect(config.indexes.map((entry) => entry.config.name).sort()).toEqual([
      "knowledge_retrievals_ws_created_idx",
      "knowledge_retrievals_ws_source_idx",
    ]);
    expect(config.indexes.every((entry) => entry.config.unique !== true)).toBe(true);
  });

  it("indexes knowledge_vectors by workspace and model", () => {
    // Every query resolves which embedding model's rows to search with COUNT(*) per model, and
    // retrieval then reads those rows: without (workspace_id, model) both scan the whole table.
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const indexes = (sqlite.prepare("PRAGMA index_list(knowledge_vectors)").all() as Array<{ name: string }>).map(
      (row) => row.name,
    );
    expect(indexes).toEqual(
      expect.arrayContaining(["knowledge_vectors_ws_source_idx", "knowledge_vectors_ws_model_idx"]),
    );
    const columns = (
      sqlite.prepare("PRAGMA index_info(knowledge_vectors_ws_model_idx)").all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(columns).toEqual(["workspace_id", "model"]);
    sqlite.close();
  });

  it("declares the knowledge_vectors indexes in the drizzle schema, matching the migration", () => {
    // Drift guard: migration 0012 + ensureSchema + schema.ts, or `drizzle-kit generate` re-emits it.
    const config = getTableConfig(knowledgeVectors);
    expect(config.indexes.map((entry) => entry.config.name).sort()).toEqual([
      "knowledge_vectors_ws_model_idx",
      "knowledge_vectors_ws_source_idx",
    ]);
    const model = config.indexes.find((entry) => entry.config.name === "knowledge_vectors_ws_model_idx");
    expect(model?.config.columns.map((column) => (column as { name: string }).name)).toEqual([
      "workspace_id",
      "model",
    ]);
    expect(config.indexes.every((entry) => entry.config.unique !== true)).toBe(true);
  });

  it("creates the knowledge graph tables with their workspace indexes", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const nodeCols = (
      sqlite.prepare("PRAGMA table_info(knowledge_graph_nodes)").all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(nodeCols).toEqual(
      expect.arrayContaining(["id", "workspace_id", "kind", "label", "payload", "updated_at"]),
    );
    const edgeCols = (
      sqlite.prepare("PRAGMA table_info(knowledge_graph_edges)").all() as Array<{ name: string; pk: number }>
    ).filter((column) => column.pk > 0);
    expect(edgeCols.map((column) => column.name).sort()).toEqual(["from_id", "kind", "to_id", "workspace_id"]);

    const nodeIndexes = (
      sqlite.prepare("PRAGMA index_list(knowledge_graph_nodes)").all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(nodeIndexes).toEqual(expect.arrayContaining(["knowledge_graph_nodes_ws_kind_idx"]));
    const edgeIndexes = (
      sqlite.prepare("PRAGMA index_list(knowledge_graph_edges)").all() as Array<{ name: string }>
    ).map((row) => row.name);
    expect(edgeIndexes).toEqual(expect.arrayContaining(["knowledge_graph_edges_ws_kind_idx"]));

    // The composite key is what makes an edge upsert idempotent instead of an append.
    const insert = sqlite.prepare(
      `INSERT INTO knowledge_graph_edges (workspace_id, from_id, to_id, kind, weight, updated_at)
       VALUES ('ws', 'a', 'b', 'covers', 1, 1)`,
    );
    insert.run();
    expect(() => insert.run()).toThrow(/UNIQUE/);
    sqlite.close();
  });

  it("creates knowledge_verify keyed by workspace", () => {
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    sqlite
      .prepare(
        `INSERT INTO knowledge_verify (workspace_id, ok, detail, created_at) VALUES ('ws', 1, 'retrieved in 4 ms', 7)
         ON CONFLICT(workspace_id) DO UPDATE SET ok = excluded.ok`,
      )
      .run();
    const row = sqlite.prepare("SELECT ok, detail, created_at FROM knowledge_verify WHERE workspace_id = 'ws'").get() as {
      ok: number;
      detail: string;
      created_at: number;
    };
    expect(row).toEqual({ ok: 1, detail: "retrieved in 4 ms", created_at: 7 });
    sqlite.close();
  });

  it("declares the graph and verify tables in the drizzle schema, matching the migration", () => {
    // Same drift guard as knowledge_retrievals: migration + ensureSchema + schema.ts, or nothing.
    expect(getTableConfig(knowledgeGraphNodes).name).toBe("knowledge_graph_nodes");
    expect(getTableConfig(knowledgeGraphNodes).columns.map((column) => column.name).sort()).toEqual([
      "id",
      "kind",
      "label",
      "payload",
      "updated_at",
      "workspace_id",
    ]);
    const edges = getTableConfig(knowledgeGraphEdges);
    expect(edges.name).toBe("knowledge_graph_edges");
    expect(edges.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "workspace_id",
      "from_id",
      "to_id",
      "kind",
    ]);
    expect(edges.columns.find((column) => column.name === "weight")?.getSQLType()).toBe("real");
    expect(edges.indexes.map((entry) => entry.config.name)).toEqual(["knowledge_graph_edges_ws_kind_idx"]);
    const verify = getTableConfig(knowledgeVerify);
    expect(verify.name).toBe("knowledge_verify");
    expect(verify.columns.map((column) => column.name).sort()).toEqual([
      "created_at",
      "detail",
      "ok",
      "workspace_id",
    ]);
  });

  it("applies the weknora backend migration twice without throwing", () => {
    // SQLite has no `ADD COLUMN IF NOT EXISTS`, so a bare ALTER in a migration is a hard failure the
    // second time the file is applied — a re-stamped journal, a repaired install, or this test.
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const file = path.join(packageDir, "drizzle", "0013_knowledge_weknora.sql");
    const statements = readFileSync(file, "utf8")
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (let pass = 0; pass < 2; pass += 1) {
      for (const statement of statements) {
        expect(() => sqlite.exec(statement)).not.toThrow();
      }
    }
    // And the column 0013 deliberately leaves to ensure-schema is there, exactly once.
    const columns = (sqlite.pragma("table_info(knowledge_sources)") as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns.filter((name) => name === "external_id")).toEqual(["external_id"]);
    sqlite.close();
  });

  it("carries the gateway credential fingerprint on the workspace binding", () => {
    // Drift guard: migration 0013 + ensureSchema + schema.ts, or `drizzle-kit generate` re-emits it.
    const sqlite = new Database(":memory:");
    ensureSchema(sqlite);
    const columns = (sqlite.pragma("table_info(knowledge_workspace_backend)") as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns).toEqual(expect.arrayContaining(["gateway_base_url", "gateway_key_fp"]));
    expect(getTableConfig(knowledgeWorkspaceBackend).columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["gateway_base_url", "gateway_key_fp"]),
    );
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
    expect(versionFks.some((fk) => fk.from === "organization_id" && fk.table === "organizations")).toBe(true);

    const bindingFks = sqlite.pragma("foreign_key_list('agent_tool_bindings')") as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    expect(bindingFks.some((fk) => fk.from === "organization_id" && fk.table === "organizations")).toBe(true);
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

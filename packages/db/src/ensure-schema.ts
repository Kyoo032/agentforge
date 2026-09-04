import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

const MIGRATIONS_TABLE = "__drizzle_migrations";

const REQUIRED_TABLES = [
  "user",
  "organizations",
  "organization_members",
  "workspaces",
  "workspace_members",
  "agents",
  "agent_versions",
  "tools",
  "agent_tool_bindings",
  "threads",
  "messages",
  "runs",
  "tool_invocations",
  "media",
] as const;

type JournalEntry = {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
};

type Journal = {
  entries: JournalEntry[];
};

type Migration = {
  tag: string;
  sql: string[];
  folderMillis: number;
  hash: string;
};

/** Resolve the committed drizzle migrations folder (journal + SQL). */
export function migrationsFolder(): string {
  const tried: string[] = [];
  const envDir = process.env.AGENTFORGE_MIGRATIONS_DIR?.trim();
  if (envDir) {
    tried.push(envDir);
    if (existsSync(envDir)) {
      return envDir;
    }
  }
  const relative = path.resolve(process.cwd(), "../../packages/db/drizzle");
  tried.push(relative);
  if (existsSync(relative)) {
    return relative;
  }
  throw new Error(
    `Agentforge migrations folder not found. Tried:\n${tried.map((p) => `  - ${p}`).join("\n")}`,
  );
}

function readMigrations(folder: string): Migration[] {
  const journalPath = path.join(folder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json file at ${journalPath}`);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  const migrations: Migration[] = [];
  for (const entry of journal.entries) {
    const migrationPath = path.join(folder, `${entry.tag}.sql`);
    if (!existsSync(migrationPath)) {
      throw new Error(`No file ${migrationPath} found in ${folder} folder`);
    }
    const query = readFileSync(migrationPath, "utf8");
    migrations.push({
      tag: entry.tag,
      sql: query.split("--> statement-breakpoint"),
      folderMillis: entry.when,
      // Match drizzle-orm/migrator.js: sha256 of the full SQL file contents.
      hash: createHash("sha256").update(query).digest("hex"),
    });
  }
  return migrations;
}

function ensureMigrationsTable(sqlite: Database.Database): void {
  // Same shape as drizzle-orm SQLiteSyncDialect.migrate
  sqlite.exec(`
			CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric
			)
		`);
}

function lastAppliedCreatedAt(sqlite: Database.Database): number | undefined {
  const row = sqlite
    .prepare(
      `SELECT id, hash, created_at FROM \`${MIGRATIONS_TABLE}\` ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { id: number; hash: string; created_at: number | string } | undefined;
  if (!row) {
    return undefined;
  }
  return Number(row.created_at);
}

function migrationRowCount(sqlite: Database.Database): number {
  const table = sqlite
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(MIGRATIONS_TABLE) as { ok: number } | undefined;
  if (!table) {
    return 0;
  }
  const row = sqlite.prepare(`SELECT count(*) AS n FROM \`${MIGRATIONS_TABLE}\``).get() as {
    n: number;
  };
  return row.n;
}

function countKernelTables(sqlite: Database.Database): { present: string[]; missing: string[] } {
  const have = new Set(listKernelTables(sqlite));
  const present = REQUIRED_TABLES.filter((name) => have.has(name));
  const missing = REQUIRED_TABLES.filter((name) => !have.has(name));
  return { present: [...present], missing: [...missing] };
}

function stampMigrations(sqlite: Database.Database, migrations: Migration[]): void {
  ensureMigrationsTable(sqlite);
  const insert = sqlite.prepare(
    `INSERT INTO \`${MIGRATIONS_TABLE}\` ("hash", "created_at") VALUES(?, ?)`,
  );
  for (const migration of migrations) {
    insert.run(migration.hash, migration.folderMillis);
  }
}

function applyPendingMigrations(
  sqlite: Database.Database,
  migrations: Migration[],
  lastCreatedAt: number | undefined,
): void {
  ensureMigrationsTable(sqlite);
  const insert = sqlite.prepare(
    `INSERT INTO \`${MIGRATIONS_TABLE}\` ("hash", "created_at") VALUES(?, ?)`,
  );
  const run = sqlite.transaction(() => {
    for (const migration of migrations) {
      if (lastCreatedAt !== undefined && !(lastCreatedAt < migration.folderMillis)) {
        continue;
      }
      for (const stmt of migration.sql) {
        const trimmed = stmt.trim();
        if (trimmed.length > 0) {
          sqlite.exec(trimmed);
        }
      }
      insert.run(migration.hash, migration.folderMillis);
    }
  });
  run();
}

/**
 * Apply drizzle-kit migrations synchronously (better-sqlite3 has no top-level await at DB open).
 * Existing DBs that already have all kernel tables but no journal rows are baseline-stamped.
 */
function workspaceColumns(sqlite: Database.Database): string[] {
  try {
    return (sqlite.prepare("PRAGMA table_info(workspaces)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
  } catch {
    return [];
  }
}

export function ensureSchema(sqlite: Database.Database): void {
  const folder = migrationsFolder();
  const migrations = readMigrations(folder);
  const { present, missing } = countKernelTables(sqlite);

  if (present.length > 0 && missing.length > 0) {
    throw new Error(
      `SQLite schema is partially initialized (${present.length}/${REQUIRED_TABLES.length} kernel tables). ` +
        `Missing: ${missing.join(", ")}. Refusing to migrate or baseline-stamp.`,
    );
  }

  // SQLite validates parent tables on CREATE when foreign_keys is ON; generated
  // migrations are not topologically ordered. Apply DDL with FKs off, then re-enable.
  sqlite.pragma("foreign_keys = OFF");

  if (present.length === REQUIRED_TABLES.length) {
    if (migrationRowCount(sqlite) === 0) {
      const stamp = sqlite.transaction(() => {
        stampMigrations(sqlite, migrations);
      });
      stamp();
    } else {
      const last = lastAppliedCreatedAt(sqlite);
      applyPendingMigrations(sqlite, migrations, last);
    }
  } else {
    // Fresh install: no kernel tables yet.
    const last = migrationRowCount(sqlite) === 0 ? undefined : lastAppliedCreatedAt(sqlite);
    applyPendingMigrations(sqlite, migrations, last);
  }

  sqlite.pragma("foreign_keys = ON");
  ensureKnowledgeTables(sqlite);
  ensureWorkspaceColumns(sqlite);
  assertKernelTables(sqlite);
}

function ensureWorkspaceColumns(sqlite: Database.Database): void {
  const have = new Set(workspaceColumns(sqlite));
  if (have.size === 0) {
    return;
  }
  if (!have.has("template_pack")) {
    sqlite.exec("ALTER TABLE `workspaces` ADD `template_pack` text");
  }
  if (!have.has("product_modes")) {
    sqlite.exec("ALTER TABLE `workspaces` ADD `product_modes` text");
  }
}

function ensureKnowledgeTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_soul (
      workspace_id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      role text NOT NULL,
      voice text NOT NULL,
      rules text NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_memories (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      text text NOT NULL,
      pinned integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_memories_ws_idx ON knowledge_memories (workspace_id);
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      name text NOT NULL,
      type text NOT NULL,
      status text NOT NULL,
      chunks integer NOT NULL DEFAULT 0,
      error text,
      created_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_sources_ws_idx ON knowledge_sources (workspace_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks USING fts5(
      source_id,
      workspace_id,
      body
    );
    CREATE TABLE IF NOT EXISTS knowledge_settings (
      workspace_id text PRIMARY KEY NOT NULL,
      embedding_model text NOT NULL,
      brain_model text NOT NULL,
      verifier_model text NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_vectors (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      source_id text NOT NULL,
      chunk_index integer NOT NULL,
      body text NOT NULL,
      embedding text NOT NULL,
      model text NOT NULL,
      created_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_vectors_ws_source_idx ON knowledge_vectors (workspace_id, source_id);
    CREATE TABLE IF NOT EXISTS knowledge_maps (
      workspace_id text PRIMARY KEY NOT NULL,
      payload text NOT NULL,
      status text NOT NULL,
      error text,
      created_at integer NOT NULL
    );
  `);
}

export function listKernelTables(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name != '${MIGRATIONS_TABLE}'
       ORDER BY 1`,
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

export function assertKernelTables(sqlite: Database.Database): void {
  const have = new Set(listKernelTables(sqlite));
  const missing = REQUIRED_TABLES.filter((name) => !have.has(name));
  if (missing.length > 0) {
    throw new Error(`SQLite kernel tables missing: ${missing.join(", ")}`);
  }
}

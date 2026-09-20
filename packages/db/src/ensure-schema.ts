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
  "edit_projects",
  "edit_ops",
  "edit_snapshots",
  "edit_jobs",
  "edit_cards",
  "edit_unplaced",
] as const;

const EDIT_TABLES = [
  "edit_projects",
  "edit_ops",
  "edit_snapshots",
  "edit_jobs",
  "edit_cards",
  "edit_unplaced",
] as const;

function missingOnlyEditTables(missing: string[]): boolean {
  return missing.length > 0 && missing.every((name) => (EDIT_TABLES as readonly string[]).includes(name));
}

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
  // The app's own cwd: `apps/web`, `packages/host`, any package directory.
  const relative = path.resolve(process.cwd(), "../../packages/db/drizzle");
  tried.push(relative);
  if (existsSync(relative)) {
    return relative;
  }
  // The repository root, which is where the operator scripts document being run from
  // (`scripts/rotate-wrap-key.ts`). Without this the wrap-key rotation drill could not open the
  // hosted database at all: it failed here, on the import, before reading a single tenant.
  const fromRoot = path.resolve(process.cwd(), "packages/db/drizzle");
  tried.push(fromRoot);
  if (existsSync(fromRoot)) {
    return fromRoot;
  }
  throw new Error(`DPSBuddy migrations folder not found. Tried:\n${tried.map((p) => `  - ${p}`).join("\n")}`);
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
    .prepare(`SELECT id, hash, created_at FROM \`${MIGRATIONS_TABLE}\` ORDER BY created_at DESC LIMIT 1`)
    .get() as { id: number; hash: string; created_at: number | string } | undefined;
  if (!row) {
    return undefined;
  }
  return Number(row.created_at);
}

function migrationRowCount(sqlite: Database.Database): number {
  const table = sqlite
    .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
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
  const insert = sqlite.prepare(`INSERT INTO \`${MIGRATIONS_TABLE}\` ("hash", "created_at") VALUES(?, ?)`);
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
  const insert = sqlite.prepare(`INSERT INTO \`${MIGRATIONS_TABLE}\` ("hash", "created_at") VALUES(?, ?)`);
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

  if (present.length > 0 && missing.length > 0 && !missingOnlyEditTables(missing)) {
    throw new Error(
      `SQLite schema is partially initialized (${present.length}/${REQUIRED_TABLES.length} kernel tables). ` +
        `Missing: ${missing.join(", ")}. Refusing to migrate or baseline-stamp.`,
    );
  }

  // SQLite validates parent tables on CREATE when foreign_keys is ON; generated
  // migrations are not topologically ordered. Apply DDL with FKs off, then re-enable.
  sqlite.pragma("foreign_keys = OFF");

  if (present.length === REQUIRED_TABLES.length || missingOnlyEditTables(missing)) {
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
  ensureKnowledgeSourceOrigin(sqlite);
  ensureKnowledgeRetrievals(sqlite);
  ensureKnowledgeGraph(sqlite);
  ensureKnowledgeBackendTables(sqlite);
  ensureEditTables(sqlite);
  ensureArtifactTables(sqlite);
  ensureDatasetTables(sqlite);
  ensureMarketTables(sqlite);
  ensureAuthSessionTables(sqlite);
  ensureTenantTables(sqlite);
  ensureTenantUsageTable(sqlite);
  ensureTenantStateTable(sqlite);
  ensureWorkspaceColumns(sqlite);
  assertKernelTables(sqlite);
}

/**
 * One row per chunk a run was given (the measured Retrieved stage of the knowledge loop).
 * Mirrors drizzle/0010_knowledge_retrievals.sql for DBs stamped before it existed.
 */
function ensureKnowledgeRetrievals(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_retrievals (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      thread_id text,
      run_id text,
      source_id text NOT NULL,
      chunk_index integer NOT NULL,
      score real NOT NULL,
      backend text NOT NULL,
      created_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_retrievals_ws_created_idx ON knowledge_retrievals (workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS knowledge_retrievals_ws_source_idx ON knowledge_retrievals (workspace_id, source_id);
  `);
}

/**
 * Graph (topics / sources / threads and the edges between them) plus the Verified self-check row.
 * Mirrors drizzle/0011_knowledge_graph.sql for DBs stamped before it existed.
 */
function ensureKnowledgeGraph(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      kind text NOT NULL,
      label text NOT NULL,
      payload text,
      updated_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_graph_nodes_ws_kind_idx ON knowledge_graph_nodes (workspace_id, kind);
    CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
      workspace_id text NOT NULL,
      from_id text NOT NULL,
      to_id text NOT NULL,
      kind text NOT NULL,
      weight real DEFAULT 1 NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (workspace_id, from_id, to_id, kind)
    );
    CREATE INDEX IF NOT EXISTS knowledge_graph_edges_ws_kind_idx ON knowledge_graph_edges (workspace_id, kind);
    CREATE TABLE IF NOT EXISTS knowledge_verify (
      workspace_id text PRIMARY KEY NOT NULL,
      ok integer NOT NULL,
      detail text NOT NULL,
      created_at integer NOT NULL
    );
  `);
}

/**
 * Backend binding + outbox for a remote retrieval backend, and `knowledge_sources.external_id`.
 * Mirrors drizzle/0013_knowledge_weknora.sql for DBs stamped before it existed.
 */
function ensureKnowledgeBackendTables(sqlite: Database.Database): void {
  const have = new Set(tableColumns(sqlite, "knowledge_sources"));
  if (have.size > 0 && !have.has("external_id")) {
    sqlite.exec("ALTER TABLE `knowledge_sources` ADD `external_id` text");
  }
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS knowledge_sources_external_idx ON knowledge_sources (workspace_id, external_id);
    CREATE TABLE IF NOT EXISTS knowledge_workspace_backend (
      workspace_id text PRIMARY KEY NOT NULL,
      backend_id text NOT NULL,
      kb_id text,
      model_id text,
      embedding_model text,
      gateway_base_url text,
      gateway_key_fp text,
      updated_at integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_backend_outbox (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      op text NOT NULL,
      source_id text NOT NULL,
      external_id text,
      payload text,
      attempts integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_backend_outbox_ws_idx ON knowledge_backend_outbox (workspace_id, created_at);
  `);
  // The binding table predates the gateway columns on desks that ran an earlier build of 0013;
  // `CREATE TABLE IF NOT EXISTS` above is a no-op for them, so the columns are added explicitly.
  const binding = new Set(tableColumns(sqlite, "knowledge_workspace_backend"));
  if (!binding.has("gateway_base_url")) {
    sqlite.exec("ALTER TABLE `knowledge_workspace_backend` ADD `gateway_base_url` text");
  }
  if (!binding.has("gateway_key_fp")) {
    sqlite.exec("ALTER TABLE `knowledge_workspace_backend` ADD `gateway_key_fp` text");
  }
}

/** Market mode cache + headline search. Mirrors drizzle/0009_market.sql for DBs stamped before it existed. */
function ensureMarketTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS market_cache (
      id text PRIMARY KEY NOT NULL,
      ticker text NOT NULL,
      kind text NOT NULL,
      payload text NOT NULL,
      source_ref text NOT NULL,
      observed_at text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS market_cache_ticker_kind_idx ON market_cache (ticker, kind, observed_at);
    CREATE VIRTUAL TABLE IF NOT EXISTS market_news_fts USING fts5(
      ticker,
      title,
      summary,
      link UNINDEXED,
      published_at UNINDEXED
    );
  `);
}

/** Uploaded tables for analyst modes. Mirrors drizzle/0007_datasets.sql for DBs stamped before it existed. */
function ensureDatasetTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS datasets (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      name text NOT NULL,
      filename text NOT NULL,
      rows integer NOT NULL,
      cols integer NOT NULL,
      columns text NOT NULL,
      storage_path text NOT NULL,
      size_bytes integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS datasets_ws_idx ON datasets (workspace_id, created_at);
  `);
}

/** Kernel-neutral job outputs. Mirrors drizzle/0006_artifacts.sql for DBs stamped before it existed. */
/**
 * Hosted browser sessions. Mirrors drizzle/0014_auth_sessions.sql for DBs stamped before it existed.
 * Desktop and webdev never write it; the table is created anyway so one schema serves both targets.
 */
function ensureAuthSessionTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL,
      user_id text NOT NULL,
      org_id text NOT NULL,
      created_at integer NOT NULL,
      last_seen_at integer NOT NULL,
      expires_at integer NOT NULL,
      absolute_expires_at integer NOT NULL,
      revoked_at integer
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_user_seen_idx ON auth_sessions (user_id, last_seen_at);
    CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions (expires_at);
  `);
}

/**
 * The tenant root and `organizations.tenant_id`. Mirrors drizzle/0015_tenants.sql for DBs stamped
 * before it existed — in particular a **baseline-stamped** database (`ensureSchema` above marks
 * every migration applied without running it when all kernel tables are present and the journal is
 * empty), which would otherwise carry the 0015 journal row and no `tenants` table.
 *
 * `tenants` is deliberately NOT in `REQUIRED_TABLES`: an existing desktop database has every
 * current kernel table and no `tenants`, which would make the partial-init check above throw
 * "Refusing to migrate or baseline-stamp" on the frozen desktop's first launch. This healer is
 * what covers that case instead.
 *
 * Idempotent, and safe with `foreign_keys = ON`: the added column has no NOT NULL and defaults to
 * NULL, which is the one shape SQLite allows `ADD COLUMN ... REFERENCES` to take.
 */
function ensureTenantTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id text PRIMARY KEY NOT NULL,
      slug text NOT NULL,
      name text NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at integer NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_unique ON tenants (slug);
    INSERT OR IGNORE INTO tenants (id, slug, name, status, created_at)
    VALUES ('local-tenant', 'local', 'Local', 'active', CAST(strftime('%s','now') AS INTEGER) * 1000);
  `);

  const have = new Set(tableColumns(sqlite, "organizations"));
  if (have.size === 0) {
    return;
  }
  if (!have.has("tenant_id")) {
    sqlite.exec(
      "ALTER TABLE `organizations` ADD `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE cascade",
    );
  }
  // Backfills the column this healer just added, and repairs any row a partial 0015 left null.
  sqlite.exec("UPDATE `organizations` SET `tenant_id` = 'local-tenant' WHERE `tenant_id` IS NULL");
  sqlite.exec("CREATE INDEX IF NOT EXISTS organizations_tenant_idx ON organizations (tenant_id)");
  // Guarded rather than assumed: this healer runs on every boot, and a stripped or hand-built
  // schema without `slug` must not throw here — that would brick the open, not repair it.
  if (have.has("slug")) {
    sqlite.exec(`
      DROP INDEX IF EXISTS organizations_slug_unique;
      CREATE UNIQUE INDEX IF NOT EXISTS organizations_tenant_slug ON organizations (tenant_id, slug);
    `);
  }
}

/**
 * The Phase 5 usage ledger, for a database stamped past 0016 without it (the baseline-stamp case
 * every healer above covers). Mirrors drizzle/0016_tenant_usage.sql exactly, including the
 * deliberate absence of a foreign key on `organization_id`.
 */
function ensureTenantUsageTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tenant_usage (
      id text PRIMARY KEY NOT NULL,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE cascade,
      organization_id text NOT NULL,
      workspace_id text,
      user_id text,
      mode text NOT NULL,
      model text NOT NULL,
      unit text NOT NULL,
      quantity integer NOT NULL,
      input_tokens integer DEFAULT 0 NOT NULL,
      output_tokens integer DEFAULT 0 NOT NULL,
      cost_usd_micros integer,
      unpriced_reason text,
      run_id text,
      at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tenant_usage_tenant_at_idx ON tenant_usage (tenant_id, at);
    CREATE INDEX IF NOT EXISTS tenant_usage_tenant_mode_idx ON tenant_usage (tenant_id, mode, at);
    CREATE INDEX IF NOT EXISTS tenant_usage_unpriced_idx ON tenant_usage (unpriced_reason, at);
  `);
}

/**
 * Per-tenant secrets and gate state (Phase 4), for a database stamped past 0018 without the table.
 * Mirrors drizzle/0018_tenant_state.sql exactly, composite primary key included.
 *
 * This healer is also the net under the journal gap that migration's header describes: a hosted
 * database whose `__drizzle_migrations` row ordering skipped 0018 still gets the table here, so a
 * tenant's key is never written to a table that does not exist.
 */
function ensureTenantStateTable(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tenant_state (
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE cascade,
      key text NOT NULL,
      value text NOT NULL,
      updated_at integer NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );
    CREATE INDEX IF NOT EXISTS tenant_state_key_idx ON tenant_state (key);
  `);
}

function ensureArtifactTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      mode text NOT NULL,
      kind text NOT NULL,
      title text NOT NULL,
      mime text NOT NULL,
      body text NOT NULL,
      meta text NOT NULL,
      size_bytes integer DEFAULT 0 NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS artifacts_ws_mode_idx ON artifacts (workspace_id, mode, created_at);
  `);
}

function tableColumns(sqlite: Database.Database, table: string): string[] {
  try {
    return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
  } catch {
    return [];
  }
}

/**
 * Work-origin columns on knowledge_sources. Mirrors drizzle/0008_knowledge_source_origin.sql for
 * DBs whose journal was stamped past it before the columns existed (same healing as workspaces).
 */
function ensureKnowledgeSourceOrigin(sqlite: Database.Database): void {
  const have = new Set(tableColumns(sqlite, "knowledge_sources"));
  if (have.size === 0) {
    return;
  }
  if (!have.has("origin_kind")) {
    sqlite.exec("ALTER TABLE `knowledge_sources` ADD `origin_kind` text");
  }
  if (!have.has("origin_id")) {
    sqlite.exec("ALTER TABLE `knowledge_sources` ADD `origin_id` text");
  }
  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_origin_idx ON knowledge_sources (workspace_id, origin_kind, origin_id)",
  );
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

function ensureEditTables(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS edit_projects (
      id text PRIMARY KEY NOT NULL,
      organization_id text NOT NULL,
      workspace_id text NOT NULL,
      name text NOT NULL,
      fps integer NOT NULL,
      width integer NOT NULL,
      height integer NOT NULL,
      seq integer DEFAULT 0 NOT NULL,
      review_json text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE cascade,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS edit_projects_org_ws_idx ON edit_projects (organization_id, workspace_id);
    CREATE TABLE IF NOT EXISTS edit_ops (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      seq integer NOT NULL,
      parent text,
      clock integer NOT NULL,
      actor text NOT NULL,
      type text NOT NULL,
      payload_json text NOT NULL,
      inverse_json text,
      card_id text,
      undo_of text,
      created_at integer NOT NULL,
      FOREIGN KEY (project_id) REFERENCES edit_projects(id) ON DELETE cascade
    );
    CREATE UNIQUE INDEX IF NOT EXISTS edit_ops_project_seq ON edit_ops (project_id, seq);
    CREATE TABLE IF NOT EXISTS edit_snapshots (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      up_to_seq integer NOT NULL,
      doc_json text NOT NULL,
      created_at integer NOT NULL,
      FOREIGN KEY (project_id) REFERENCES edit_projects(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS edit_snapshots_project_seq_idx ON edit_snapshots (project_id, up_to_seq);
    CREATE TABLE IF NOT EXISTS edit_jobs (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      kind text NOT NULL,
      status text NOT NULL,
      target_clip_ids_json text NOT NULL,
      card_id text,
      request_json text NOT NULL,
      model text,
      tier text,
      estimate_usd real,
      actual_usd real,
      progress real DEFAULT 0 NOT NULL,
      output_asset_ids_json text,
      error text,
      created_at integer NOT NULL,
      started_at integer,
      finished_at integer,
      cancel_requested_at integer,
      FOREIGN KEY (project_id) REFERENCES edit_projects(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS edit_jobs_project_status_idx ON edit_jobs (project_id, status);
    CREATE TABLE IF NOT EXISTS edit_cards (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      run_id text NOT NULL,
      tool_key text NOT NULL,
      verb text NOT NULL,
      object text NOT NULL,
      op_ids_json text NOT NULL,
      job_id text,
      status text NOT NULL,
      thumbs_json text NOT NULL,
      estimate_usd real,
      tier text,
      created_at integer NOT NULL,
      decided_at integer,
      FOREIGN KEY (project_id) REFERENCES edit_projects(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS edit_cards_project_status_idx ON edit_cards (project_id, status);
    CREATE TABLE IF NOT EXISTS edit_unplaced (
      id text PRIMARY KEY NOT NULL,
      project_id text NOT NULL,
      job_id text NOT NULL,
      asset_id text NOT NULL,
      prompt text,
      created_at integer NOT NULL,
      placed_clip_id text,
      discarded_at integer,
      FOREIGN KEY (project_id) REFERENCES edit_projects(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS edit_unplaced_project_idx ON edit_unplaced (project_id);
  `);
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
      created_at integer NOT NULL,
      origin_kind text,
      origin_id text
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
    -- Mirrors drizzle/0012_knowledge_vectors_model_idx.sql for DBs stamped before it existed.
    CREATE INDEX IF NOT EXISTS knowledge_vectors_ws_model_idx ON knowledge_vectors (workspace_id, model);
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

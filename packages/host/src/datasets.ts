import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { sql } from "@agentforge/db";
import { localDataDir } from "@agentforge/db/vault-key";
import { ApiError, type TenantContext } from "@agentforge/core";
import {
  parseTabular,
  profileTable,
  toTypedTable,
  type ColumnType,
  type TableProfile,
  type TabularTable,
  type TypedTable,
} from "@agentforge/core/tabular";
import { deleteArtifactsByOwner, sweepOrphanSources } from "./knowledge";
import { resolveInsideTenantRoot, tenantRelativePath } from "./tenant-paths";
import { DATASET_TABLE, quoteIdentifier, sqlTypeFor, toSqlIdentifier } from "./sql-guard";
import { createQueryRunner, type QueryRunner, type RunnerLoad } from "./sql-runner";

/** IPC bytes envelope cap for one upload (also the tabular parser's own cap). */
export const DATASET_MAX_BYTES = 25 * 1024 * 1024;
/** Rows loaded into the query table; bounds ingest time and every join the model can write. */
export const DATASET_MAX_ROWS = 200_000;
/** SQLite heap cap per dataset connection (bytes): oversized blobs and joins fail instead of exhausting memory. */
export const DATASET_HEAP_LIMIT_BYTES = 128 * 1024 * 1024;
export const DATASET_NAME_MAX = 120;
export const DATASET_LIST_LIMIT = 100;

export type DatasetColumn = { name: string; identifier: string; type: ColumnType };

export type DatasetSummary = {
  id: string;
  workspaceId: string;
  name: string;
  filename: string;
  rows: number;
  cols: number;
  columns: DatasetColumn[];
  sizeBytes: number;
  createdAt: number;
};

/** A dataset loaded for querying: parsed table, profile, a same-thread SQLite (tests, sync callers), and the worker runner. */
export type LoadedDataset = DatasetSummary & {
  table: TabularTable;
  typed: TypedTable;
  profile: TableProfile;
  db: Database.Database;
  runner: QueryRunner;
};

export type CreateDatasetInput = {
  name: string;
  filename: string;
  bytes: Uint8Array;
};

export type DatasetStore = {
  create(tenant: TenantContext, input: CreateDatasetInput): LoadedDataset;
  list(tenant: TenantContext): DatasetSummary[];
  get(tenant: TenantContext, id: string): LoadedDataset | null;
  remove(tenant: TenantContext, id: string): boolean;
};

type Row = {
  id: string;
  workspace_id: string;
  name: string;
  filename: string;
  rows: number;
  cols: number;
  columns: string;
  storage_path: string;
  size_bytes: number;
  created_at: number;
};

export function datasetColumns(typed: TypedTable): DatasetColumn[] {
  const taken: string[] = [];
  return typed.headers.map((name, index) => {
    const identifier = toSqlIdentifier(name, taken);
    taken.push(identifier);
    return { name, identifier, type: typed.types[index] ?? "string" };
  });
}

/** DDL + insert + rows for one dataset table; shared by the same-thread DB and the worker. */
export function datasetLoad(typed: TypedTable, columns: DatasetColumn[]): RunnerLoad {
  const ddl = columns.map((column) => `${quoteIdentifier(column.identifier)} ${sqlTypeFor(column.type)}`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  return {
    ddl: `CREATE TABLE ${DATASET_TABLE} (${ddl})`,
    insertSql: `INSERT INTO ${DATASET_TABLE} VALUES (${placeholders})`,
    rows: typed.rows.map((row) => columns.map((_, index) => toSqliteValue(row[index]))),
    heapLimit: DATASET_HEAP_LIMIT_BYTES,
  };
}

/** Load a typed table into a fresh in-memory SQLite and lock it read-only. */
export function buildDatasetDb(typed: TypedTable, columns: DatasetColumn[]): Database.Database {
  const load = datasetLoad(typed, columns);
  const db = new Database(":memory:");
  db.exec(load.ddl);
  const insert = db.prepare(load.insertSql);
  const fill = db.transaction((rows: RunnerLoad["rows"]) => {
    for (const row of rows) {
      insert.run(row);
    }
  });
  fill(load.rows);
  db.pragma(`hard_heap_limit = ${DATASET_HEAP_LIMIT_BYTES}`);
  db.pragma("query_only = 1");
  return db;
}

function toSqliteValue(value: number | string | boolean | null | undefined): number | string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return value;
}

function parseOrThrow(input: CreateDatasetInput): TabularTable {
  if (input.bytes.byteLength > DATASET_MAX_BYTES) {
    throw new ApiError("invalid_request", "Dataset exceeds the 25 MB cap", 413);
  }
  let table: TabularTable | null;
  try {
    table = parseTabular({ bytes: input.bytes, filename: input.filename, maxRows: DATASET_MAX_ROWS + 1 });
  } catch (error) {
    throw new ApiError("invalid_request", error instanceof Error ? error.message : "Could not parse the file", 413);
  }
  if (!table) {
    throw new ApiError("invalid_request", "Could not find a header row plus at least one data row", 400);
  }
  if (table.rows.length > DATASET_MAX_ROWS) {
    throw new ApiError("invalid_request", `Dataset exceeds the ${DATASET_MAX_ROWS.toLocaleString()} row cap`, 413);
  }
  return table;
}

function summaryFromRow(row: Row): DatasetSummary {
  let columns: DatasetColumn[] = [];
  try {
    columns = JSON.parse(row.columns) as DatasetColumn[];
  } catch {
    columns = [];
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    filename: row.filename,
    rows: row.rows,
    cols: row.cols,
    columns,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

function loadFromTable(summary: DatasetSummary, table: TabularTable): LoadedDataset {
  const typed = toTypedTable(table);
  const columns = datasetColumns(typed);
  return {
    ...summary,
    columns,
    table,
    typed,
    profile: profileTable(table),
    db: buildDatasetDb(typed, columns),
    runner: createQueryRunner(datasetLoad(typed, columns)),
  };
}

function cacheKey(tenant: TenantContext, id: string): string {
  return `${tenant.workspaceId}:${id}`;
}

function dispose(dataset: LoadedDataset | undefined): void {
  if (dataset) {
    dataset.db.close();
    void dataset.runner.close();
  }
}

/**
 * Repository over the kernel `datasets` table. Raw files live under
 * `<rootDir>/tenants/<tenantId>/<workspaceId>/<id>.<ext>` — the tenant prefix is empty for the
 * local tenant, so a pre-Phase-3 file stays at `<rootDir>/<workspaceId>/<id>.<ext>`. Parsed tables
 * and their in-memory SQLite are cached per process and rebuilt from the file after a restart.
 */
export function createDatasetStore(db: Database.Database, rootDir: string): DatasetStore {
  const cache = new Map<string, LoadedDataset>();

  const storagePath = (tenant: TenantContext, id: string, filename: string): string => {
    const ext =
      path
        .extname(filename)
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, "") || ".csv";
    return tenantRelativePath(tenant.tenantId, [tenant.workspaceId], `${id}${ext}`);
  };

  /**
   * A `storage_path` read back out of the row, resolved against the root and refused when it does
   * not belong to this tenant. The row is already `workspace_id`-scoped; this is the second lock,
   * so a row whose path was written for another tenant cannot be read through a desk id collision.
   */
  const filePath = (tenant: TenantContext, relative: string): string => {
    // Symlinks resolved, like `mediaFilePath`: a link planted under this tenant's subtree would
    // otherwise pass a purely lexical containment test.
    const real = resolveInsideTenantRoot(rootDir, tenant.tenantId, path.resolve(rootDir, relative));
    if (real === null) {
      throw new ApiError("not_found", "Dataset not found", 404);
    }
    return real;
  };

  return {
    create(tenant, input) {
      const name =
        input.name.trim().slice(0, DATASET_NAME_MAX) || input.filename.trim().slice(0, DATASET_NAME_MAX) || "Dataset";
      const table = parseOrThrow(input);
      const id = crypto.randomUUID();
      const relative = storagePath(tenant, id, input.filename);
      const full = path.join(rootDir, relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, input.bytes);
      const summary: DatasetSummary = {
        id,
        workspaceId: tenant.workspaceId,
        name,
        filename: input.filename.trim() || "dataset.csv",
        rows: table.rows.length,
        cols: table.headers.length,
        columns: [],
        sizeBytes: input.bytes.byteLength,
        createdAt: Date.now(),
      };
      const loaded = loadFromTable(summary, table);
      try {
        db.prepare(
          `INSERT INTO datasets (id, workspace_id, name, filename, rows, cols, columns, storage_path, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          tenant.workspaceId,
          name,
          summary.filename,
          summary.rows,
          summary.cols,
          JSON.stringify(loaded.columns),
          relative,
          summary.sizeBytes,
          summary.createdAt,
        );
      } catch (error) {
        // No row means no dataset: do not leave an orphaned file behind.
        dispose(loaded);
        rmSync(full, { force: true });
        throw error;
      }
      cache.set(cacheKey(tenant, id), loaded);
      return loaded;
    },

    list(tenant) {
      const rows = db
        .prepare("SELECT * FROM datasets WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(tenant.workspaceId, DATASET_LIST_LIMIT) as Row[];
      return rows.map(summaryFromRow);
    },

    get(tenant, id) {
      const row = db.prepare("SELECT * FROM datasets WHERE workspace_id = ? AND id = ?").get(tenant.workspaceId, id) as
        | Row
        | undefined;
      const key = cacheKey(tenant, id);
      if (!row) {
        dispose(cache.get(key));
        cache.delete(key);
        return null;
      }
      const cached = cache.get(key);
      if (cached) {
        return cached;
      }
      const full = filePath(tenant, row.storage_path);
      if (!existsSync(full)) {
        throw new ApiError("not_found", "Dataset file is missing on disk", 404);
      }
      const summary = summaryFromRow(row);
      const table = parseOrThrow({ name: summary.name, filename: summary.filename, bytes: readFileSync(full) });
      const loaded = loadFromTable(summary, table);
      cache.set(key, loaded);
      return loaded;
    },

    remove(tenant, id) {
      const key = cacheKey(tenant, id);
      const active = cache.get(key);
      if (active && active.runner.inUse() > 0) {
        throw new ApiError("conflict", "Dataset is being analyzed right now; try again when the job finishes", 409);
      }
      const row = db
        .prepare("SELECT storage_path FROM datasets WHERE workspace_id = ? AND id = ?")
        .get(tenant.workspaceId, id) as { storage_path: string } | undefined;
      if (!row) {
        return false;
      }
      db.prepare("DELETE FROM datasets WHERE workspace_id = ? AND id = ?").run(tenant.workspaceId, id);
      dispose(active);
      cache.delete(key);
      rmSync(filePath(tenant, row.storage_path), { force: true });
      // The analyses this dataset produced go with it. A Data card's origin is the artifact, not the
      // dataset, so the card is only reachable through the artifacts — deleting the rows and then
      // sweeping is what stops Chat answering from numbers whose data is gone.
      deleteArtifactsByOwner(tenant, "datasetId", id, db);
      sweepOrphanSources(tenant);
      return true;
    },
  };
}

let defaultStore: DatasetStore | null = null;

export function datasetRoot(): string {
  return path.resolve(localDataDir(), "datasets");
}

export function datasetStore(): DatasetStore {
  if (!defaultStore) {
    defaultStore = createDatasetStore(sql, datasetRoot());
  }
  return defaultStore;
}

export function requireDataset(tenant: TenantContext, id: string): LoadedDataset {
  const dataset = datasetStore().get(tenant, id);
  if (!dataset) {
    throw new ApiError("not_found", "Dataset not found", 404);
  }
  return dataset;
}

import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";
import { z } from "zod";
import { ApiError, defineTool } from "@agentforge/core";
import { assertReadOnlySql } from "./sql-guard";
import { SQL_CELL_MAX_CHARS, SQL_ROW_CAP, SQL_TIME_CAP_MS, type SqlCell, type SqlResult } from "./sql-runner";

export { SQL_CELL_MAX_CHARS, SQL_ROW_CAP, SQL_TIME_CAP_MS };
export type { SqlCell, SqlResult };
export const SQL_STEP_CAP = 8;

export type SqlToolOutput = ({ success: true; sql: string } & SqlResult) | { success: false; error: string };

/** Per-job context: which dataset `run_sql` queries, and how many steps it has used. */
export type ActiveDataset = {
  id: string;
  /** Runs one read-only query in the dataset's worker (guarded, capped, killable). */
  query: (sql: string) => Promise<SqlResult>;
  stepCap?: number;
  /** Mutable counter for the running job (not data; one object per job). */
  steps: { used: number };
  onQuery?: (sql: string, result: SqlToolOutput) => void;
};

const storage = new AsyncLocalStorage<ActiveDataset>();

export function withActiveDataset<T>(context: ActiveDataset, fn: () => T): T {
  return storage.run(context, fn);
}

export function getActiveDataset(): ActiveDataset | undefined {
  return storage.getStore();
}

function cell(value: unknown): SqlCell {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value instanceof Uint8Array) {
    return `[blob ${value.byteLength} bytes]`;
  }
  const text = String(value);
  return text.length > SQL_CELL_MAX_CHARS ? `${text.slice(0, SQL_CELL_MAX_CHARS)}…` : text;
}

/**
 * Synchronous, same-thread query with a row cap and a soft time cap between rows.
 * Used by tests and internal callers only; model-written SQL goes through the worker runner.
 */
export function runReadOnlySql(
  db: Database.Database,
  rawSql: string,
  caps: { rowCap?: number; timeCapMs?: number } = {},
): SqlResult {
  const sqlText = assertReadOnlySql(rawSql);
  const rowCap = caps.rowCap ?? SQL_ROW_CAP;
  const timeCap = caps.timeCapMs ?? SQL_TIME_CAP_MS;
  const started = Date.now();
  let statement: Database.Statement;
  try {
    statement = db.prepare(sqlText);
  } catch (error) {
    throw new ApiError("invalid_sql", error instanceof Error ? error.message : "SQL did not compile", 400);
  }
  if (!statement.reader) {
    throw new ApiError("invalid_sql", "Only queries that return rows are allowed", 400);
  }
  const columns = statement.columns().map((column) => column.name);
  const rows: SqlCell[][] = [];
  let rowCount = 0;
  let truncated = false;
  for (const record of statement.raw(true).iterate() as IterableIterator<unknown[]>) {
    rowCount += 1;
    if (rows.length < rowCap) {
      rows.push(record.map(cell));
    } else {
      truncated = true;
      break;
    }
    if (Date.now() - started > timeCap) {
      truncated = true;
      break;
    }
  }
  return { columns, rows, rowCount, truncated, elapsedMs: Date.now() - started };
}

export const runSqlTool = defineTool({
  key: "run_sql",
  name: "Run SQL",
  description:
    "Run one read-only SQLite SELECT against the attached dataset (table `data`). Returns columns and up to 500 rows. Use it for every number you report.",
  schema: z.object({
    sql: z.string().min(1).describe("A single SELECT or WITH … SELECT statement over table data"),
  }),
  execute: async ({ sql: rawSql }): Promise<SqlToolOutput> => {
    const active = getActiveDataset();
    if (!active) {
      return { success: false, error: "No dataset is attached to this run." };
    }
    const cap = active.stepCap ?? SQL_STEP_CAP;
    if (active.steps.used >= cap) {
      return { success: false, error: `Query cap reached (${cap}). Answer with what you have.` };
    }
    active.steps.used += 1;
    let output: SqlToolOutput;
    try {
      output = { success: true, sql: rawSql.trim(), ...(await active.query(rawSql)) };
    } catch (error) {
      output = { success: false, error: error instanceof Error ? error.message : "Query failed" };
    }
    active.onQuery?.(rawSql.trim(), output);
    return output;
  },
});

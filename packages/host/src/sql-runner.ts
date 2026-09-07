import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { ApiError } from "@agentforge/core";
import { assertReadOnlySql } from "./sql-guard";
import { SQL_WORKER_SOURCE } from "./sql-worker-source";

export const SQL_ROW_CAP = 500;
export const SQL_TIME_CAP_MS = 2_000;
export const SQL_CELL_MAX_CHARS = 400;
const LOAD_TIMEOUT_MS = 30_000;

export type SqlCell = string | number | boolean | null;

export type SqlResult = {
  columns: string[];
  rows: SqlCell[][];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
};

export type QueryOptions = { timeoutMs?: number; rowCap?: number };

/** Runs read-only SQL for one dataset in a worker that can be killed mid-query. */
export type QueryRunner = {
  query(sql: string, options?: QueryOptions): Promise<SqlResult>;
  /** In-flight or reserved uses; delete refuses while > 0. */
  inUse(): number;
  acquire(): () => void;
  close(): Promise<void>;
};

export type RunnerLoad = {
  ddl: string;
  insertSql: string;
  rows: ReadonlyArray<ReadonlyArray<number | string | null>>;
  heapLimit: number;
};

type Pending = { resolve: (result: SqlResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

/**
 * Path the worker requires better-sqlite3 from. Under tsx (ESM) this file has
 * `import.meta.url`; inside the esbuild CommonJS `host.cjs` it has `require`.
 * In the packaged app the module lives under app.asar.unpacked (native binding),
 * and a worker thread must load it from the real filesystem, not the asar.
 */
export function sqliteModulePath(): string {
  const resolver = typeof require === "function" ? require : createRequire(import.meta.url);
  const resolved = resolver.resolve("better-sqlite3");
  const unpacked = resolved.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return unpacked !== resolved && existsSync(unpacked) ? unpacked : resolved;
}

function spawn(load: RunnerLoad): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(SQL_WORKER_SOURCE, { eval: true });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new ApiError("internal_error", "Dataset worker did not start in time", 500));
    }, LOAD_TIMEOUT_MS);
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("message", (message: { type?: string }) => {
      clearTimeout(timer);
      if (message?.type === "loaded") {
        resolve(worker);
      } else {
        void worker.terminate();
        reject(new ApiError("internal_error", "Dataset worker failed to load", 500));
      }
    });
    worker.postMessage({ type: "load", modulePath: sqliteModulePath(), ...load });
  });
}

/**
 * One worker per dataset, spawned lazily and respawned after a kill. Queries are
 * serialized; a query past its time cap terminates the worker so a runaway
 * aggregate or join can never block the host process.
 */
export function createQueryRunner(load: RunnerLoad): QueryRunner {
  let worker: Promise<Worker> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let uses = 0;
  let closed = false;

  const ensureWorker = (): Promise<Worker> => {
    if (!worker) {
      worker = spawn(load).catch((error: unknown) => {
        worker = null;
        throw error;
      });
    }
    return worker;
  };

  const kill = async (): Promise<void> => {
    const current = worker;
    worker = null;
    if (current) {
      await current.then((instance) => instance.terminate()).catch(() => undefined);
    }
  };

  const runOne = async (sql: string, options: QueryOptions): Promise<SqlResult> => {
    if (closed) {
      throw new ApiError("not_found", "Dataset was deleted during this run", 410);
    }
    const instance = await ensureWorker();
    const id = crypto.randomUUID();
    const timeoutMs = options.timeoutMs ?? SQL_TIME_CAP_MS;
    return new Promise<SqlResult>((resolve, reject) => {
      const pending: Pending = {
        resolve,
        reject,
        timer: setTimeout(() => {
          cleanup();
          void kill();
          reject(new ApiError("invalid_sql", `Query exceeded ${timeoutMs / 1000} s and was stopped`, 408));
        }, timeoutMs),
      };
      const onMessage = (message: { type?: string; id?: string; ok?: boolean; result?: SqlResult; error?: string }) => {
        if (message?.type !== "result" || message.id !== id) {
          return;
        }
        cleanup();
        if (message.ok && message.result) {
          pending.resolve(message.result);
        } else {
          pending.reject(new ApiError("invalid_sql", message.error ?? "Query failed", 400));
        }
      };
      const onExit = () => {
        cleanup();
        pending.reject(new ApiError("internal_error", "Dataset worker stopped", 500));
      };
      const cleanup = () => {
        clearTimeout(pending.timer);
        instance.off("message", onMessage);
        instance.off("exit", onExit);
      };
      instance.on("message", onMessage);
      instance.once("exit", onExit);
      instance.postMessage({
        type: "query",
        id,
        sql,
        rowCap: options.rowCap ?? SQL_ROW_CAP,
        cellMax: SQL_CELL_MAX_CHARS,
      });
    });
  };

  return {
    query(sql, options = {}) {
      const checked = assertReadOnlySql(sql);
      const next = chain.then(() => runOne(checked, options));
      chain = next.catch(() => undefined);
      return next;
    },
    inUse: () => uses,
    acquire() {
      uses += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          uses -= 1;
        }
      };
    },
    async close() {
      closed = true;
      await kill();
    },
  };
}

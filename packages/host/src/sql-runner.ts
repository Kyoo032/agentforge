import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { ApiError, type EnvLike, isServerMode } from "@agentforge/core";
import { maxFromEnv, sqlLimiter, TOO_MANY_JOBS, withLimit, type Limiter } from "./concurrency";
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

/**
 * The per-dataset cost budget (docs/internal/web-security-spec.md, row T9).
 *
 * The time cap bounds ONE query; it does nothing about a caller who sends the same expensive query
 * again and again. The shape that found this: `WITH t AS (SELECT 1 x UNION ALL SELECT x+1 FROM t
 * WHERE x < 9e9) SELECT count(*) FROM t` — a CTE with no `RECURSIVE` keyword, so nothing in the
 * guard objects, that runs until the 2 s cap kills it and costs a worker respawn every time. There
 * is no honest syntactic tell for that query, so this does not try to find one: it prices it.
 *
 * Each runner keeps what its last `SQL_BUDGET_SAMPLES` queries cost. When the ones inside the last
 * `SQL_BUDGET_WINDOW_MS` add up to more than the budget, the next query is refused with the same
 * `too_many_jobs` a full pool gives, until the window drains. `RECURSIVE` stays blocked either way.
 */
export const SQL_BUDGET_ENV = "AGENTFORGE_SQL_BUDGET_MS";
export const DEFAULT_SQL_BUDGET_MS = 10_000;
/** How far back the budget looks. Older queries are forgiven. */
export const SQL_BUDGET_WINDOW_MS = 60_000;
/** How many query costs a runner remembers at most. */
export const SQL_BUDGET_SAMPLES = 20;

export type SqlBudget = {
  /** Throws `too_many_jobs` when the recent queries have already spent the budget. */
  assertAffordable(): void;
  /** Files what a finished query cost, however it ended. A killed query is the expensive case. */
  record(elapsedMs: number): void;
  /** Milliseconds this dataset has spent inside the window right now. */
  spentMs(): number;
};

/**
 * The budget for this process, in milliseconds. Unbounded off server mode: a desk is one owner
 * querying their own data on their own machine, and pricing that would turn a morning of heavy
 * pivots into a 429 the desktop has never produced. Same rule as the limiters in concurrency.ts.
 */
export function sqlBudgetMsFromEnv(env: EnvLike = process.env): number {
  if (!isServerMode(env)) {
    return Number.POSITIVE_INFINITY;
  }
  return maxFromEnv(SQL_BUDGET_ENV, DEFAULT_SQL_BUDGET_MS, env);
}

type Spend = { readonly at: number; readonly ms: number };

/** A rolling window of what a dataset's recent queries cost. */
export function createSqlBudget(budgetMs: number = sqlBudgetMsFromEnv()): SqlBudget {
  let spends: readonly Spend[] = [];

  const inWindow = (now: number): readonly Spend[] => spends.filter((spend) => now - spend.at < SQL_BUDGET_WINDOW_MS);
  const total = (recent: readonly Spend[]): number => recent.reduce((sum, spend) => sum + spend.ms, 0);

  return {
    assertAffordable() {
      spends = inWindow(Date.now());
      if (total(spends) > budgetMs) {
        throw new ApiError(
          TOO_MANY_JOBS,
          "This dataset's recent queries used up its query-time budget. Try again in a minute.",
          429,
        );
      }
    },
    record(elapsedMs) {
      const now = Date.now();
      spends = [...inWindow(now), { at: now, ms: Math.max(0, elapsedMs) }].slice(-SQL_BUDGET_SAMPLES);
    },
    spentMs() {
      return total(inWindow(Date.now()));
    },
  };
}

/** Injectable collaborators; the cap is global and the budget per runner by default. */
export type QueryRunnerDeps = { limiter?: Limiter; budget?: SqlBudget };

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

/**
 * Environment variables a worker never needs and must not hold.
 *
 * `AGENTFORGE_*` carries the data directory — the path of the app database this worker is
 * explicitly not allowed to reach — plus the server-mode switches; the rest is every shape a
 * credential takes in this process. The worker builds its own in-memory SQLite from the rows the
 * parent posts, so dropping all of it costs nothing and keeps a future worker-side bug from
 * having anything to leak.
 */
const WORKER_ENV_DENY = /^AGENTFORGE_|(KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|SESSION|COOKIE)/i;

/** The parent's environment minus anything secret or install-specific. `PATH` and friends stay. */
export function workerEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && !WORKER_ENV_DENY.test(entry[0]),
    ),
  );
}

function spawn(load: RunnerLoad): Promise<Worker> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(SQL_WORKER_SOURCE, { eval: true, env: workerEnv() });
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
 *
 * Across datasets the global `sqlLimiter` caps how many of those workers run at once on the hosted
 * server (concurrency.ts): the per-query row, time and cell caps bound one query, not a hundred of
 * them on one box. On a desk that limiter is unbounded, so a query waits for its own dataset's chain
 * and nothing else, exactly as before. `deps.limiter` is the seam the tests use.
 */
export function createQueryRunner(load: RunnerLoad, deps: QueryRunnerDeps = {}): QueryRunner {
  const limiter = deps.limiter ?? sqlLimiter;
  const budget = deps.budget ?? createSqlBudget();
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

  /** Wall time, not the worker's own `elapsedMs`: a query killed at the cap reports nothing. */
  const runCharged = async (sql: string, options: QueryOptions): Promise<SqlResult> => {
    const started = Date.now();
    try {
      return await runOne(sql, options);
    } finally {
      budget.record(Date.now() - started);
    }
  };

  return {
    query(sql, options = {}) {
      // The guard runs first and throws synchronously: a rejected statement never takes a slot.
      const checked = assertReadOnlySql(sql);
      // The budget is checked when the query's turn comes, not when it was queued, so the cost of
      // the ones ahead of it in the chain is already counted. A refusal takes no limiter slot.
      const next = chain.then(() => {
        budget.assertAffordable();
        return withLimit(limiter, () => runCharged(checked, options));
      });
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

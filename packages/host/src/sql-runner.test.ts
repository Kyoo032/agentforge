import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@agentforge/core";
import { createLimiter, TOO_MANY_JOBS, type Limiter, type Release } from "./concurrency";
import {
  createQueryRunner,
  createSqlBudget,
  DEFAULT_SQL_BUDGET_MS,
  SQL_BUDGET_ENV,
  SQL_BUDGET_SAMPLES,
  SQL_BUDGET_WINDOW_MS,
  sqlBudgetMsFromEnv,
  workerEnv,
  type QueryRunner,
  type QueryRunnerDeps,
  type RunnerLoad,
} from "./sql-runner";

const WORKER_TIMEOUT_MS = 30_000;

const LOAD: RunnerLoad = {
  ddl: "CREATE TABLE data (a INTEGER, b TEXT)",
  insertSql: "INSERT INTO data (a, b) VALUES (?, ?)",
  rows: [
    [1, "one"],
    [2, "two"],
  ],
  heapLimit: 16 * 1024 * 1024,
};

/** Wraps a real limiter and counts what the runner asks of it. */
function recordingLimiter(max: number): { limiter: Limiter; calls: { taken: number; waited: number; freed: number } } {
  const inner = createLimiter("test-sql", max);
  const calls = { taken: 0, waited: 0, freed: 0 };
  const counted =
    (release: Release): Release =>
    () => {
      calls.freed += 1;
      release();
    };
  const limiter: Limiter = {
    name: inner.name,
    max: inner.max,
    queueLimit: inner.queueLimit,
    active: () => inner.active(),
    queued: () => inner.queued(),
    tryAcquire: () => {
      const release = inner.tryAcquire();
      if (!release) {
        return null;
      }
      calls.taken += 1;
      return counted(release);
    },
    acquire: async () => {
      calls.waited += 1;
      return counted(await inner.acquire());
    },
  };
  return { limiter, calls };
}

/** A pool that is full with a full queue: the shape a flood produces. */
function refusingLimiter(): Limiter {
  const inner = createLimiter("test-sql", 1);
  return {
    ...inner,
    tryAcquire: () => null,
    acquire: () => Promise.reject(new ApiError(TOO_MANY_JOBS, "Too many test-sql jobs", 429)),
  };
}

const open: QueryRunner[] = [];

function runner(load: RunnerLoad, deps: QueryRunnerDeps): QueryRunner {
  const created = createQueryRunner(load, deps);
  open.push(created);
  return created;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((instance) => instance.close()));
});

describe("createQueryRunner under the global SQL cap", () => {
  it(
    "takes a slot for the query and frees it on success",
    async () => {
      const { limiter, calls } = recordingLimiter(2);
      const result = await runner(LOAD, { limiter }).query("select a, b from data order by a");

      expect(result.columns).toEqual(["a", "b"]);
      expect(result.rows).toEqual([
        [1, "one"],
        [2, "two"],
      ]);
      expect(calls.taken).toBe(1);
      expect(calls.freed).toBe(1);
      expect(limiter.active()).toBe(0);
    },
    WORKER_TIMEOUT_MS,
  );

  it(
    "frees the slot when the query is rejected by SQLite",
    async () => {
      const { limiter, calls } = recordingLimiter(1);
      const instance = runner(LOAD, { limiter });
      await expect(instance.query("select nosuchcolumn from data")).rejects.toBeInstanceOf(ApiError);
      expect(calls.freed).toBe(1);
      expect(limiter.active()).toBe(0);

      // The cap survived the failure: the next query still gets a slot.
      await expect(instance.query("select a from data")).resolves.toMatchObject({ rowCount: 2 });
      expect(limiter.active()).toBe(0);
    },
    WORKER_TIMEOUT_MS,
  );

  it(
    "waits for a slot instead of starting a second worker query",
    async () => {
      const { limiter, calls } = recordingLimiter(1);
      const instance = runner(LOAD, { limiter });
      const held = await limiter.acquire();

      let settled = false;
      const pending = instance.query("select a from data").then((result) => {
        settled = true;
        return result;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(limiter.queued()).toBe(1);

      held();
      await expect(pending).resolves.toMatchObject({ rowCount: 2 });
      // One wait for the slot this test holds, one for the query that had to queue behind it.
      expect(calls.waited).toBe(2);
      expect(limiter.active()).toBe(0);
    },
    WORKER_TIMEOUT_MS,
  );

  it("refuses a flood with too_many_jobs before it reaches a worker", async () => {
    // The DDL is nonsense on purpose: a worker that actually started would fail on load, so a
    // `too_many_jobs` here is proof the cap refused the query before any worker was spawned.
    const instance = runner({ ...LOAD, ddl: "THIS IS NOT SQL" }, { limiter: refusingLimiter() });
    const error = await instance.query("select a from data").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(TOO_MANY_JOBS);
    expect((error as ApiError).status).toBe(429);
  });

  it("still rejects unsafe SQL before it ever reaches the cap", () => {
    const { limiter, calls } = recordingLimiter(1);
    const instance = runner(LOAD, { limiter });
    // Unchanged from before the cap: the guard throws synchronously, so a write never takes a slot.
    expect(() => instance.query("drop table data")).toThrow(ApiError);
    expect(calls.taken).toBe(0);
    expect(calls.waited).toBe(0);
    expect(limiter.active()).toBe(0);
  });

  it("defaults to the shared SQL limiter when no dependency is passed", () => {
    const instance = createQueryRunner(LOAD);
    open.push(instance);
    expect(instance.inUse()).toBe(0);
  });

  it(
    "stops a query that outruns the time cap and keeps serving after the kill",
    async () => {
      const { limiter } = recordingLimiter(1);
      const instance = runner(
        { ...LOAD, rows: Array.from({ length: 400 }, (_, index) => [index, "x"] as const) },
        { limiter },
      );
      const slow = "select count(*) as c from data a, data b, data c where a.a >= 0 and b.a >= 0 and c.a >= 0";

      const error = await instance.query(slow, { timeoutMs: 50 }).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(408);
      expect(limiter.active()).toBe(0);

      await expect(instance.query("select count(*) as c from data")).resolves.toMatchObject({ rows: [[400]] });
    },
    WORKER_TIMEOUT_MS,
  );
});

describe("sqlBudgetMsFromEnv", () => {
  it("leaves a desk unbudgeted so the desktop and webdev behave exactly as before", () => {
    expect(sqlBudgetMsFromEnv({})).toBe(Number.POSITIVE_INFINITY);
    expect(sqlBudgetMsFromEnv({ [SQL_BUDGET_ENV]: "5000" })).toBe(Number.POSITIVE_INFINITY);
  });

  it("reads the budget on the hosted server, with a default and a floor", () => {
    expect(SQL_BUDGET_ENV).toBe("AGENTFORGE_SQL_BUDGET_MS");
    expect(sqlBudgetMsFromEnv({ AGENTFORGE_SERVER: "1" })).toBe(DEFAULT_SQL_BUDGET_MS);
    expect(sqlBudgetMsFromEnv({ AGENTFORGE_SERVER: "1", [SQL_BUDGET_ENV]: "2500" })).toBe(2500);
    expect(sqlBudgetMsFromEnv({ AGENTFORGE_SERVER: "true", [SQL_BUDGET_ENV]: "nonsense" })).toBe(DEFAULT_SQL_BUDGET_MS);
    expect(sqlBudgetMsFromEnv({ AGENTFORGE_SERVER: "1", [SQL_BUDGET_ENV]: "0" })).toBe(DEFAULT_SQL_BUDGET_MS);
  });
});

describe("createSqlBudget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses with too_many_jobs once the recent queries have spent the budget", () => {
    vi.useFakeTimers();
    const budget = createSqlBudget(1_000);

    budget.assertAffordable();
    budget.record(600);
    expect(budget.spentMs()).toBe(600);
    // Still inside the budget: one more query is allowed, and it is the one that overspends.
    budget.assertAffordable();
    budget.record(600);

    const error = (() => {
      try {
        budget.assertAffordable();
        return null;
      } catch (reason) {
        return reason;
      }
    })();
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(TOO_MANY_JOBS);
    expect((error as ApiError).status).toBe(429);
  });

  it("lets the window drain: what the dataset spent a minute ago no longer counts", () => {
    vi.useFakeTimers();
    const budget = createSqlBudget(1_000);
    budget.record(900);
    vi.advanceTimersByTime(30_000);
    budget.record(900);
    expect(budget.spentMs()).toBe(1_800);
    expect(() => budget.assertAffordable()).toThrow(ApiError);

    // The first query falls out of the window; the second is still inside it and still counts.
    vi.advanceTimersByTime(SQL_BUDGET_WINDOW_MS - 30_000);
    expect(budget.spentMs()).toBe(900);
    expect(() => budget.assertAffordable()).not.toThrow();

    vi.advanceTimersByTime(SQL_BUDGET_WINDOW_MS);
    expect(budget.spentMs()).toBe(0);
  });

  it("remembers only the last N queries, so a flood of cheap ones cannot hide an expensive one", () => {
    vi.useFakeTimers();
    const budget = createSqlBudget(1_000);
    budget.record(5_000);
    for (let index = 0; index < SQL_BUDGET_SAMPLES; index += 1) {
      budget.record(1);
    }
    expect(budget.spentMs()).toBe(SQL_BUDGET_SAMPLES);
  });

  it("never refuses when the budget is unbounded, however much a desk spends", () => {
    vi.useFakeTimers();
    const budget = createSqlBudget(Number.POSITIVE_INFINITY);
    budget.record(10 * SQL_BUDGET_WINDOW_MS);
    expect(() => budget.assertAffordable()).not.toThrow();
  });
});

describe("createQueryRunner under the per-dataset cost budget", () => {
  it(
    "charges a query that burns the whole time cap and refuses the next one",
    async () => {
      // The shape this exists for: a non-recursive CTE that never ends. Nothing about it looks
      // wrong to the guard, it spends the full time cap, and it costs a worker respawn each time.
      // One such query is served; the budget is what stops the tenth.
      const { limiter, calls } = recordingLimiter(1);
      const budget = createSqlBudget(40);
      const instance = runner(
        { ...LOAD, rows: Array.from({ length: 400 }, (_, index) => [index, "x"] as const) },
        { limiter, budget },
      );
      const slow = "select count(*) as c from data a, data b, data c where a.a >= 0 and b.a >= 0 and c.a >= 0";

      const stopped = await instance.query(slow, { timeoutMs: 80 }).catch((reason: unknown) => reason);
      expect((stopped as ApiError).status).toBe(408);
      expect(budget.spentMs()).toBeGreaterThanOrEqual(80);

      const refused = await instance.query("select a from data").catch((reason: unknown) => reason);
      expect(refused).toBeInstanceOf(ApiError);
      expect((refused as ApiError).code).toBe(TOO_MANY_JOBS);
      expect((refused as ApiError).status).toBe(429);
      // The refusal happened before the limiter: only the first query ever took a slot.
      expect(calls.taken).toBe(1);
      expect(limiter.active()).toBe(0);
    },
    WORKER_TIMEOUT_MS,
  );

  it(
    "charges a successful query and serves the next one while the budget holds",
    async () => {
      const { limiter } = recordingLimiter(1);
      const budget = createSqlBudget(60_000);
      const instance = runner(LOAD, { limiter, budget });

      await expect(instance.query("select a from data")).resolves.toMatchObject({ rowCount: 2 });
      expect(budget.spentMs()).toBeGreaterThanOrEqual(0);
      await expect(instance.query("select b from data")).resolves.toMatchObject({ rowCount: 2 });
    },
    WORKER_TIMEOUT_MS,
  );

  it("never refuses on a desk, where the budget is unbounded by default", async () => {
    const { limiter } = recordingLimiter(1);
    const instance = runner({ ...LOAD, ddl: "THIS IS NOT SQL" }, { limiter });
    // Off server mode the default budget is Infinity, so the only failure left is the bad load.
    const error = await instance.query("select a from data").catch((reason: unknown) => reason);
    expect((error as ApiError).code).not.toBe(TOO_MANY_JOBS);
  });
});

describe("workerEnv", () => {
  it("keeps what the native module needs and drops everything else", () => {
    const filtered = workerEnv({
      PATH: "/usr/bin",
      SystemRoot: "C:/Windows",
      TEMP: "C:/Temp",
      LANG: "en_US.UTF-8",
      NODE_ENV: "test",
    });
    expect(filtered).toEqual({
      PATH: "/usr/bin",
      SystemRoot: "C:/Windows",
      TEMP: "C:/Temp",
      LANG: "en_US.UTF-8",
      NODE_ENV: "test",
    });
  });

  it("never hands the worker the data dir, a vault value, or a provider credential", () => {
    // The worker runs SQL the user wrote. It builds its own in-memory database and needs nothing
    // about this install, so the app database's location and every secret stay outside it.
    const filtered = workerEnv({
      PATH: "/usr/bin",
      AGENTFORGE_DATA_DIR: "C:/Users/x/AppData/Roaming/DPSBuddy",
      AGENTFORGE_SERVER: "1",
      OPENAI_API_KEY: "sk-live-1",
      ANTHROPIC_API_KEY: "sk-ant-1",
      GATEWAY_TOKEN: "t",
      SESSION_SECRET: "s",
      DB_PASSWORD: "p",
      PORTAL_CLIENT_CREDENTIAL: "c",
    });
    expect(filtered).toEqual({ PATH: "/usr/bin" });
  });

  it("drops an undefined value rather than passing it on", () => {
    expect(workerEnv({ PATH: "/usr/bin", EMPTY: undefined })).toEqual({ PATH: "/usr/bin" });
  });
});

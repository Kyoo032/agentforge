import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import {
  createJobLimiter,
  createLimiter,
  createUnboundedLimiter,
  DEFAULT_JOB_QUEUE_TIMEOUT_MS,
  DEFAULT_MAX_FFMPEG,
  DEFAULT_MAX_SQL_WORKERS,
  ffmpegLimiter,
  JOB_QUEUE_TIMEOUT_ENV,
  MAX_FFMPEG_ENV,
  MAX_SQL_WORKERS_ENV,
  maxFromEnv,
  QUEUE_FACTOR,
  queueTimeoutFromEnv,
  sqlLimiter,
  TOO_MANY_JOBS,
  withLimit,
  type Release,
} from "./concurrency";

function apiErrorOf(error: unknown): ApiError {
  if (!(error instanceof ApiError)) {
    throw new Error(`expected ApiError, got ${String(error)}`);
  }
  return error;
}

describe("createLimiter", () => {
  it("starts idle and reports its name, cap and queue bound", () => {
    const limiter = createLimiter("test", 3);
    expect(limiter.name).toBe("test");
    expect(limiter.max).toBe(3);
    expect(limiter.queueLimit).toBe(3 * QUEUE_FACTOR);
    expect(limiter.active()).toBe(0);
    expect(limiter.queued()).toBe(0);
  });

  it("clamps a nonsense cap to one slot", () => {
    for (const bad of [0, -4, 1.7, Number.NaN]) {
      expect(createLimiter("test", bad).max).toBeGreaterThanOrEqual(1);
    }
    expect(createLimiter("test", 1.7).max).toBe(1);
  });

  it("hands out slots up to the cap without waiting", async () => {
    const limiter = createLimiter("test", 2);
    const first = await limiter.acquire();
    const second = await limiter.acquire();
    expect(limiter.active()).toBe(2);
    expect(limiter.queued()).toBe(0);
    first();
    second();
    expect(limiter.active()).toBe(0);
  });

  it("queues past the cap and releases waiters in order", async () => {
    const limiter = createLimiter("test", 1);
    const order: number[] = [];
    const first = await limiter.acquire();
    const second = limiter.acquire().then((release) => {
      order.push(2);
      return release;
    });
    const third = limiter.acquire().then((release) => {
      order.push(3);
      return release;
    });

    expect(limiter.active()).toBe(1);
    expect(limiter.queued()).toBe(2);
    expect(order).toEqual([]);

    first();
    (await second)();
    expect(order).toEqual([2]);
    (await third)();
    expect(order).toEqual([2, 3]);
    expect(limiter.active()).toBe(0);
    expect(limiter.queued()).toBe(0);
  });

  it("counts a double release once, so a slot can never be freed twice", async () => {
    const limiter = createLimiter("test", 2);
    const release = await limiter.acquire();
    await limiter.acquire();
    release();
    release();
    expect(limiter.active()).toBe(1);
  });

  it("refuses with a 429 too_many_jobs once the queue is full", async () => {
    const limiter = createLimiter("test", 1);
    const held = await limiter.acquire();
    const waiting = Array.from({ length: limiter.queueLimit }, () => limiter.acquire());
    expect(limiter.queued()).toBe(limiter.queueLimit);

    const error = apiErrorOf(await limiter.acquire().catch((reason: unknown) => reason));
    expect(error.code).toBe(TOO_MANY_JOBS);
    expect(error.status).toBe(429);
    expect(error.message).toContain("test");

    held();
    for (const pending of waiting) {
      (await pending)();
    }
    expect(limiter.active()).toBe(0);
  });

  it("accepts a fresh job again once the queue drains", async () => {
    const limiter = createLimiter("test", 1);
    const held = await limiter.acquire();
    const waiting = Array.from({ length: limiter.queueLimit }, () => limiter.acquire());
    await expect(limiter.acquire()).rejects.toBeInstanceOf(ApiError);

    held();
    for (const pending of waiting) {
      const release: Release = await pending;
      release();
    }
    expect(limiter.queued()).toBe(0);
    const fresh = await limiter.acquire();
    expect(fresh).toBeTypeOf("function");
    fresh();
  });

  it("tryAcquire takes a free slot and returns null at the cap", async () => {
    const limiter = createLimiter("test", 1);
    const first = limiter.tryAcquire();
    expect(first).not.toBeNull();
    expect(limiter.tryAcquire()).toBeNull();
    first?.();
    expect(limiter.active()).toBe(0);
  });
});

describe("withLimit", () => {
  it("starts the work synchronously when a slot is free", async () => {
    // Load-bearing for ffmpeg: `runFfmpeg` spawns and registers its child before its first await,
    // and the quit handler counts on the child being tracked by the time the call returns.
    const limiter = createLimiter("test", 1);
    let started = false;
    const pending = withLimit(limiter, () => {
      started = true;
      return Promise.resolve("done");
    });
    expect(started).toBe(true);
    expect(limiter.active()).toBe(1);
    await expect(pending).resolves.toBe("done");
    expect(limiter.active()).toBe(0);
  });

  it("holds a queued job until a slot frees up, then runs it", async () => {
    const limiter = createLimiter("test", 1);
    const started: number[] = [];
    let releaseFirst: Release | undefined;
    const first = withLimit(limiter, async () => {
      started.push(1);
      await new Promise<void>((resolve) => {
        releaseFirst = resolve as unknown as Release;
      });
    });
    const second = withLimit(limiter, async () => {
      started.push(2);
    });

    expect(started).toEqual([1]);
    expect(limiter.queued()).toBe(1);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(started).toEqual([1, 2]);
    expect(limiter.active()).toBe(0);
  });

  it("frees the slot when the job rejects", async () => {
    const limiter = createLimiter("test", 1);
    await expect(withLimit(limiter, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(limiter.active()).toBe(0);
    await expect(withLimit(limiter, async () => "next")).resolves.toBe("next");
    expect(limiter.active()).toBe(0);
  });

  it("frees the slot when the job throws synchronously", async () => {
    const limiter = createLimiter("test", 1);
    await expect(
      withLimit(limiter, () => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");
    expect(limiter.active()).toBe(0);
  });

  it("passes the 429 through without running the job", async () => {
    const limiter = createLimiter("test", 1);
    const held = await limiter.acquire();
    const waiting = Array.from({ length: limiter.queueLimit }, () => limiter.acquire());
    let ran = false;
    const error = apiErrorOf(
      await withLimit(limiter, () => {
        ran = true;
        return "never";
      }).catch((reason: unknown) => reason),
    );
    expect(error.code).toBe(TOO_MANY_JOBS);
    expect(ran).toBe(false);

    held();
    for (const pending of waiting) {
      (await pending)();
    }
  });

  it("never lets more than `max` jobs run at once under a burst", async () => {
    const limiter = createLimiter("test", 2);
    let peak = 0;
    const jobs = Array.from({ length: 8 }, () =>
      withLimit(limiter, async () => {
        peak = Math.max(peak, limiter.active());
        await Promise.resolve();
      }),
    );
    await Promise.all(jobs);
    expect(peak).toBe(2);
    expect(limiter.active()).toBe(0);
  });
});

describe("maxFromEnv", () => {
  it("falls back when the variable is absent, blank or not a number", () => {
    for (const value of [undefined, "", "   ", "lots", "-2", "0", "1.5e"]) {
      expect(maxFromEnv("X", 3, { X: value })).toBe(3);
    }
  });

  it("reads a positive integer and floors a fraction", () => {
    expect(maxFromEnv("X", 3, { X: "8" })).toBe(8);
    expect(maxFromEnv("X", 3, { X: " 5 " })).toBe(5);
    expect(maxFromEnv("X", 3, { X: "2.9" })).toBe(2);
    expect(maxFromEnv("X", 3, { X: "1" })).toBe(1);
  });
});

describe("queueTimeoutFromEnv", () => {
  it("defaults to a minute", () => {
    expect(DEFAULT_JOB_QUEUE_TIMEOUT_MS).toBe(60_000);
    expect(JOB_QUEUE_TIMEOUT_ENV).toBe("AGENTFORGE_JOB_QUEUE_TIMEOUT_MS");
    expect(queueTimeoutFromEnv({})).toBe(DEFAULT_JOB_QUEUE_TIMEOUT_MS);
  });

  it("reads a positive integer and ignores anything else", () => {
    expect(queueTimeoutFromEnv({ [JOB_QUEUE_TIMEOUT_ENV]: "1500" })).toBe(1500);
    for (const value of [undefined, "", "  ", "soon", "-1", "0"]) {
      expect(queueTimeoutFromEnv({ [JOB_QUEUE_TIMEOUT_ENV]: value })).toBe(DEFAULT_JOB_QUEUE_TIMEOUT_MS);
    }
  });
});

describe("a queued waiter that never gets its turn", () => {
  it("times out with the same 429 too_many_jobs rather than hanging", async () => {
    const limiter = createLimiter("test", 1, { queueTimeoutMs: 15 });
    const held = await limiter.acquire();
    const queued = limiter.acquire();
    expect(limiter.queued()).toBe(1);

    const error = apiErrorOf(await queued.catch((reason: unknown) => reason));
    expect(error.code).toBe(TOO_MANY_JOBS);
    expect(error.status).toBe(429);
    // The waiting room is clear again, so the timed-out job is not still holding a place.
    expect(limiter.queued()).toBe(0);

    held();
    expect(limiter.active()).toBe(0);
    const fresh = await limiter.acquire();
    fresh();
  });

  it("never times out a waiter that got its slot in time", async () => {
    const limiter = createLimiter("test", 1, { queueTimeoutMs: 15 });
    const held = await limiter.acquire();
    const queued = limiter.acquire();
    held();
    (await queued)();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(limiter.active()).toBe(0);
    expect(limiter.queued()).toBe(0);
  });

  it("times out one waiter without disturbing the others", async () => {
    const limiter = createLimiter("test", 1, { queueTimeoutMs: 10_000 });
    const short = createLimiter("test", 1, { queueTimeoutMs: 15 });
    expect(limiter.queueLimit).toBe(short.queueLimit);

    const held = await short.acquire();
    const first = short.acquire();
    const second = short.acquire();
    expect(short.queued()).toBe(2);
    await expect(first).rejects.toBeInstanceOf(ApiError);
    await expect(second).rejects.toBeInstanceOf(ApiError);
    held();
    expect(short.active()).toBe(0);
  });
});

describe("a queued waiter whose caller gives up", () => {
  it("drops out of the queue when its signal fires", async () => {
    const limiter = createLimiter("test", 1);
    const held = await limiter.acquire();
    const controller = new AbortController();
    const queued = limiter.acquire(controller.signal);
    expect(limiter.queued()).toBe(1);

    controller.abort();
    await expect(queued).rejects.toThrow();
    expect(limiter.queued()).toBe(0);

    // The freed slot goes to real work, not to the waiter that walked away.
    held();
    expect(limiter.active()).toBe(0);
    const next = await limiter.acquire();
    expect(limiter.active()).toBe(1);
    next();
  });

  it("carries the caller's own abort reason", async () => {
    const limiter = createLimiter("test", 1);
    const held = await limiter.acquire();
    const controller = new AbortController();
    const queued = limiter.acquire(controller.signal);
    controller.abort(new Error("the request went away"));
    await expect(queued).rejects.toThrow("the request went away");
    held();
  });

  it("refuses an already-aborted signal without taking a slot", async () => {
    const limiter = createLimiter("test", 2);
    await expect(limiter.acquire(AbortSignal.abort())).rejects.toThrow();
    expect(limiter.active()).toBe(0);
    expect(limiter.queued()).toBe(0);
  });

  it("makes room again: an aborted waiter no longer counts against the queue limit", async () => {
    const limiter = createLimiter("test", 1);
    const held = await limiter.acquire();
    const controller = new AbortController();
    const waiting = Array.from({ length: limiter.queueLimit }, () => limiter.acquire(controller.signal));
    await expect(limiter.acquire()).rejects.toBeInstanceOf(ApiError);

    controller.abort();
    await Promise.allSettled(waiting);
    expect(limiter.queued()).toBe(0);
    const accepted = limiter.acquire();
    expect(limiter.queued()).toBe(1);
    held();
    (await accepted)();
  });

  it("leaves a job that gets a slot straight away to handle its own abort, as it always has", async () => {
    // Desk parity: with a free slot nothing is queued, so the limiter never looks at the signal and
    // the job runs and fails the way it did before there was a limiter in the path.
    const limiter = createLimiter("test", 1);
    let ran = false;
    await expect(
      withLimit(
        limiter,
        () => {
          ran = true;
          return "done";
        },
        AbortSignal.abort(),
      ),
    ).resolves.toBe("done");
    expect(ran).toBe(true);
    expect(limiter.active()).toBe(0);
  });

  it("withLimit refuses a queued job whose caller aborted, without running it", async () => {
    const limiter = createLimiter("test", 1);
    const held = await limiter.acquire();
    let ran = false;
    const controller = new AbortController();
    const pending = withLimit(
      limiter,
      () => {
        ran = true;
        return "never";
      },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(ran).toBe(false);
    held();
    expect(limiter.active()).toBe(0);
  });
});

describe("createUnboundedLimiter", () => {
  it("has no cap and no waiting room", () => {
    const limiter = createUnboundedLimiter("desk");
    expect(limiter.name).toBe("desk");
    expect(limiter.max).toBe(Number.POSITIVE_INFINITY);
    expect(limiter.queueLimit).toBe(0);
  });

  it("never queues and never refuses, however many jobs arrive at once", async () => {
    const limiter = createUnboundedLimiter("desk");
    let peak = 0;
    const jobs = Array.from({ length: 64 }, () =>
      withLimit(limiter, async () => {
        peak = Math.max(peak, limiter.active());
        expect(limiter.queued()).toBe(0);
        await Promise.resolve();
      }),
    );
    await Promise.all(jobs);
    expect(peak).toBe(64);
    expect(limiter.active()).toBe(0);
  });

  it("hands out a slot synchronously and counts a double release once", async () => {
    const limiter = createUnboundedLimiter("desk");
    const release = limiter.tryAcquire();
    expect(release).not.toBeNull();
    expect(limiter.active()).toBe(1);
    release?.();
    release?.();
    expect(limiter.active()).toBe(0);
    (await limiter.acquire())();
    expect(limiter.active()).toBe(0);
  });
});

describe("createJobLimiter", () => {
  it("is unbounded off server mode, whatever the cap variables say", () => {
    for (const env of [{}, { AGENTFORGE_SERVER: "0" }, { [MAX_FFMPEG_ENV]: "2" }]) {
      const limiter = createJobLimiter("ffmpeg", MAX_FFMPEG_ENV, DEFAULT_MAX_FFMPEG, env);
      expect(limiter.max).toBe(Number.POSITIVE_INFINITY);
      expect(limiter.queueLimit).toBe(0);
    }
  });

  it("caps from its own variable in server mode", () => {
    const capped = createJobLimiter("ffmpeg", MAX_FFMPEG_ENV, DEFAULT_MAX_FFMPEG, { AGENTFORGE_SERVER: "1" });
    expect(capped.max).toBe(DEFAULT_MAX_FFMPEG);
    expect(capped.queueLimit).toBe(DEFAULT_MAX_FFMPEG * QUEUE_FACTOR);

    const override = createJobLimiter("sql", MAX_SQL_WORKERS_ENV, DEFAULT_MAX_SQL_WORKERS, {
      AGENTFORGE_SERVER: "true",
      [MAX_SQL_WORKERS_ENV]: "6",
    });
    expect(override.max).toBe(6);
  });

  it("takes the queue timeout from the environment in server mode", async () => {
    const limiter = createJobLimiter("ffmpeg", MAX_FFMPEG_ENV, 1, {
      AGENTFORGE_SERVER: "1",
      [MAX_FFMPEG_ENV]: "1",
      [JOB_QUEUE_TIMEOUT_ENV]: "15",
    });
    const held = await limiter.acquire();
    const error = apiErrorOf(await limiter.acquire().catch((reason: unknown) => reason));
    expect(error.code).toBe(TOO_MANY_JOBS);
    held();
  });
});

describe("the global limiters", () => {
  it("names the ffmpeg and SQL caps and their environment overrides", () => {
    expect(MAX_FFMPEG_ENV).toBe("AGENTFORGE_MAX_FFMPEG");
    expect(MAX_SQL_WORKERS_ENV).toBe("AGENTFORGE_MAX_SQL_WORKERS");
    expect(DEFAULT_MAX_FFMPEG).toBe(2);
    expect(DEFAULT_MAX_SQL_WORKERS).toBe(4);
    expect(ffmpegLimiter.name).toBe("ffmpeg");
    expect(sqlLimiter.name).toBe("sql");
  });

  it("leaves the desk uncapped: this suite is not server mode", () => {
    // The regression this pins: a desktop that used to spawn as many encodes as the owner asked for
    // must not start queueing them, and a ninth job must never come back as a 429.
    expect(ffmpegLimiter.max).toBe(Number.POSITIVE_INFINITY);
    expect(sqlLimiter.max).toBe(Number.POSITIVE_INFINITY);
    expect(ffmpegLimiter.queueLimit).toBe(0);
    expect(sqlLimiter.queueLimit).toBe(0);
  });

  it("would cap each pool from its own variable on the server", () => {
    const server = { AGENTFORGE_SERVER: "1" };
    expect(createJobLimiter("ffmpeg", MAX_FFMPEG_ENV, DEFAULT_MAX_FFMPEG, server).max).toBe(
      maxFromEnv(MAX_FFMPEG_ENV, DEFAULT_MAX_FFMPEG, server),
    );
    expect(createJobLimiter("sql", MAX_SQL_WORKERS_ENV, DEFAULT_MAX_SQL_WORKERS, server).max).toBe(
      maxFromEnv(MAX_SQL_WORKERS_ENV, DEFAULT_MAX_SQL_WORKERS, server),
    );
  });
});

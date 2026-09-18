/**
 * Global concurrency caps (docs/internal/web-security-spec.md, row T9).
 *
 * The desk was single-tenant: one owner, one machine, and the only caps were per query
 * (`sql-runner.ts`) or per child (`child-processes.ts`). Hosted, a handful of tenants can ask for a
 * hundred encodes at once and the box falls over. A limiter is a counting semaphore with a bounded
 * waiting room: up to `max` jobs run, up to `max * QUEUE_FACTOR` wait their turn, and anything past
 * that is refused now with `too_many_jobs` rather than queued into a timeout.
 *
 * WHERE THE CAPS APPLY (this is the part that bit us): only in server mode. A desk is one owner
 * asking for their own work on their own machine; capping it to two ffmpegs turned a batch of eight
 * exports into a queue, and the ninth into a 429 the desktop had never produced before. Off server
 * mode `createJobLimiter` hands back an unbounded limiter: no cap, no waiting room, and `withLimit`
 * runs the job straight through, exactly as the code did before any of this existed.
 *
 * Caps are global, not per tenant — per-tenant caps are Phase 5.
 */
import { ApiError, type EnvLike, isServerMode } from "@agentforge/core";

/** Reason code for a job refused because the pool and its waiting room are both full. */
export const TOO_MANY_JOBS = "too_many_jobs";
const TOO_MANY_JOBS_STATUS = 429;

/** Waiting room size, as a multiple of the cap. Four turns of work is a wait, not a hang. */
export const QUEUE_FACTOR = 4;

export const MAX_FFMPEG_ENV = "AGENTFORGE_MAX_FFMPEG";
export const MAX_SQL_WORKERS_ENV = "AGENTFORGE_MAX_SQL_WORKERS";
export const DEFAULT_MAX_FFMPEG = 2;
export const DEFAULT_MAX_SQL_WORKERS = 4;

/** How long a job may sit in the waiting room before it is refused instead. */
export const JOB_QUEUE_TIMEOUT_ENV = "AGENTFORGE_JOB_QUEUE_TIMEOUT_MS";
export const DEFAULT_JOB_QUEUE_TIMEOUT_MS = 60_000;

/** Frees the slot. Idempotent: calling it twice must not hand out a slot that was never taken. */
export type Release = () => void;

export type Limiter = {
  readonly name: string;
  /** `Infinity` on a desk, where nothing is capped. */
  readonly max: number;
  /** 0 on a desk: there is nothing to wait for. */
  readonly queueLimit: number;
  /** Jobs holding a slot right now. */
  active(): number;
  /** Jobs waiting for one. Always 0 on a desk. */
  queued(): number;
  /** A free slot, or null at the cap. Never queues, never throws. */
  tryAcquire(): Release | null;
  /**
   * A slot now, or when one frees up. Rejects with `too_many_jobs` when the waiting room is full or
   * when the wait runs past the queue timeout, and with the caller's own reason when `signal` fires.
   */
  acquire(signal?: AbortSignal): Promise<Release>;
};

export type LimiterOptions = {
  /** Injected by the tests so a timeout can be proven in milliseconds rather than a minute. */
  readonly queueTimeoutMs?: number;
};

type Waiter = {
  resolve: (release: Release) => void;
  reject: (error: Error) => void;
  /** Clears the timer and the abort listener. Called exactly once, however the wait ends. */
  done: () => void;
};

function normaliseMax(value: number): number {
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/** Reads a positive-integer cap from the environment; anything else falls back to `fallback`. */
export function maxFromEnv(name: string, fallback: number, env: EnvLike = process.env): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return Math.floor(parsed);
}

/** The queue timeout for this process, in milliseconds. Same parsing as every other cap. */
export function queueTimeoutFromEnv(env: EnvLike = process.env): number {
  return maxFromEnv(JOB_QUEUE_TIMEOUT_ENV, DEFAULT_JOB_QUEUE_TIMEOUT_MS, env);
}

function tooManyJobs(name: string): ApiError {
  return new ApiError(
    TOO_MANY_JOBS,
    `Too many ${name} jobs are already queued. Try again in a moment.`,
    TOO_MANY_JOBS_STATUS,
  );
}

/** The caller's own reason if they gave one, so a cancelled request does not look like a 429. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("The job was cancelled before it started.");
}

/** One slot, one release: a second call is ignored so a slot cannot be freed twice. */
function onceOnly(fn: () => void): Release {
  let done = false;
  return () => {
    if (done) {
      return;
    }
    done = true;
    fn();
  };
}

/**
 * The hosted limiter: a counting semaphore with a bounded, timed waiting room.
 * `max` is at least 1 — a cap of zero would be a pool that can never run anything.
 */
export function createLimiter(name: string, max: number, options: LimiterOptions = {}): Limiter {
  const cap = normaliseMax(max);
  const queueLimit = cap * QUEUE_FACTOR;
  const queueTimeoutMs = options.queueTimeoutMs ?? queueTimeoutFromEnv();
  const waiting: Waiter[] = [];
  let active = 0;

  /** Takes a waiter out of the queue. False when it already had its turn. */
  const drop = (waiter: Waiter): boolean => {
    const at = waiting.indexOf(waiter);
    if (at < 0) {
      return false;
    }
    waiting.splice(at, 1);
    return true;
  };

  const release = (): void => {
    active -= 1;
    const next = waiting.shift();
    if (next) {
      active += 1;
      next.done();
      next.resolve(onceOnly(release));
    }
  };

  const tryAcquire = (): Release | null => {
    if (active >= cap) {
      return null;
    }
    active += 1;
    return onceOnly(release);
  };

  const enqueue = (signal: AbortSignal | undefined): Promise<Release> =>
    new Promise<Release>((resolve, reject) => {
      // A job may wait, but not forever: past the timeout the client is long gone and the slot is
      // better spent on work someone is still watching. Same reason code as a full waiting room —
      // it is the same answer, reached a minute later.
      const timer = setTimeout(() => {
        if (drop(waiter)) {
          waiter.done();
          reject(tooManyJobs(name));
        }
      }, queueTimeoutMs);
      // Never let a waiting room keep the process alive on its own.
      timer.unref?.();
      const onAbort = (): void => {
        if (signal && drop(waiter)) {
          waiter.done();
          reject(abortError(signal));
        }
      };
      const waiter: Waiter = {
        resolve,
        reject,
        done: () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      waiting.push(waiter);
    });

  return {
    name,
    max: cap,
    queueLimit,
    active: () => active,
    queued: () => waiting.length,
    tryAcquire,
    acquire(signal?: AbortSignal) {
      if (signal?.aborted) {
        return Promise.reject(abortError(signal));
      }
      const immediate = tryAcquire();
      if (immediate) {
        return Promise.resolve(immediate);
      }
      if (waiting.length >= queueLimit) {
        return Promise.reject(tooManyJobs(name));
      }
      return enqueue(signal);
    },
  };
}

/**
 * The desk limiter: counts what is running for diagnostics and caps nothing.
 * Every slot is free, so `tryAcquire` always succeeds and nothing ever waits or is refused.
 */
export function createUnboundedLimiter(name: string): Limiter {
  let active = 0;
  const tryAcquire = (): Release => {
    active += 1;
    return onceOnly(() => {
      active -= 1;
    });
  };
  return {
    name,
    max: Number.POSITIVE_INFINITY,
    queueLimit: 0,
    active: () => active,
    queued: () => 0,
    tryAcquire,
    acquire(signal?: AbortSignal) {
      // Nothing waits here, so an abort can only be honoured before the slot is handed out.
      return signal?.aborted ? Promise.reject(abortError(signal)) : Promise.resolve(tryAcquire());
    },
  };
}

/**
 * The limiter a pool actually gets: capped on the hosted server, unbounded everywhere else.
 * `env` is read once, at module load, exactly like the cap variables it reads.
 */
export function createJobLimiter(name: string, envName: string, fallback: number, env: EnvLike = process.env): Limiter {
  if (!isServerMode(env)) {
    return createUnboundedLimiter(name);
  }
  return createLimiter(name, maxFromEnv(envName, fallback, env), { queueTimeoutMs: queueTimeoutFromEnv(env) });
}

function settle<T>(fn: () => Promise<T> | T, release: Release): Promise<T> {
  let result: Promise<T> | T;
  try {
    result = fn();
  } catch (error) {
    release();
    return Promise.reject(error);
  }
  return Promise.resolve(result).then(
    (value) => {
      release();
      return value;
    },
    (error: unknown) => {
      release();
      throw error;
    },
  );
}

/**
 * Runs `fn` under the cap and frees the slot however it ends.
 *
 * A free slot is taken synchronously and `fn` is called before this returns, so a caller that does
 * synchronous work up front — `runFfmpeg` spawns and registers its child that way — behaves exactly
 * as it did without a limiter. On a desk that is every call: an unbounded limiter always has a free
 * slot, so this is a straight call through with a counter around it.
 *
 * `signal` is consulted only by a job that has to wait — a caller that gets a slot immediately runs
 * and handles its own abort exactly as it did before there were limiters at all.
 */
export function withLimit<T>(limiter: Limiter, fn: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
  const immediate = limiter.tryAcquire();
  if (immediate) {
    return settle(fn, immediate);
  }
  return limiter.acquire(signal).then((release) => settle(fn, release));
}

/** Concurrent ffmpeg / ffprobe children. Uncapped on a desk. */
export const ffmpegLimiter = createJobLimiter("ffmpeg", MAX_FFMPEG_ENV, DEFAULT_MAX_FFMPEG);
/** Concurrent dataset SQL worker queries. Uncapped on a desk. */
export const sqlLimiter = createJobLimiter("sql", MAX_SQL_WORKERS_ENV, DEFAULT_MAX_SQL_WORKERS);

/**
 * The rate limits `device-code-login.md` names, as fixed windows.
 *
 * Fixed windows rather than token buckets, because every limit in that document is written as
 * "N per M minutes" and a bucket would answer a different question at the boundary. The OTP send
 * limit is **not** here: it is counted from the `login_otps` rows themselves (`schema.md`), so
 * there is one definition of it and nothing to reconcile. What is here is everything that has no
 * row to count.
 *
 * In-process and therefore per-process: one portal behind one proxy is the deployment
 * (`apps/portal/README.md`), and a shared counter would need Redis. A second instance halves
 * every limit's effectiveness, which is recorded as a known limit rather than pretended away.
 */
import type { Clock } from "../store/types";

export interface RateLimitVerdict {
  readonly ok: boolean;
  /** Seconds until the window rolls. Always at least 1 when `ok` is false. */
  readonly retryAfter: number;
}

export interface RateLimiter {
  /** Counts one hit against `key` and reports whether it was allowed. */
  check(key: string): RateLimitVerdict;
  /** Would the next hit be allowed? Counts nothing -- for a second limiter on the same request. */
  peek(key: string): RateLimitVerdict;
  readonly size: number;
}

export interface RateLimiterOptions {
  readonly windowMs: number;
  readonly max: number;
  readonly clock: Clock;
  /**
   * A cap, so the limiter cannot itself become the memory exhaustion it is defending against.
   * When it is full of live windows, the OLDEST windows are evicted to make room (1% of the cap at
   * a time). It used to refuse the new key instead, which meant a flood of distinct keys (one IPv6
   * /64 is plenty) locked every new caller out for a whole window. Below 1 it is treated as 1.
   */
  readonly maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 20_000;
/** When a full map has to drop live windows, it drops this share of the cap at once (1%). */
const EVICTION_BATCH_SHARE = 0.01;

interface Window {
  startedAt: number;
  count: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  /**
   * Kept in the order the windows STARTED: a fresh window is deleted before it is set, because
   * `Map#set` on a key that is already there keeps the key's old position. With that order, the
   * expired windows are all at the front and the first live entry is the oldest live window.
   */
  const windows = new Map<string, Window>();
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? DEFAULT_MAX_KEYS));
  /**
   * Room is made a batch at a time, down to this size. V8 leaves a deleted Map entry as a hole
   * until the table is rehashed, and every walk from the front skips those holes again. Dropping
   * one window per new key during a flood therefore cost thousands of skipped holes per request
   * (about 57 µs a key at the 20,000 cap). Dropping 1% at once pays that walk once per 200 keys.
   */
  const roomTarget = maxKeys - Math.max(1, Math.ceil(maxKeys * EVICTION_BATCH_SHARE));

  /**
   * Drops every expired window at the front, then, only if the map is still above `roomTarget`,
   * the oldest live ones. It never refuses the caller: refusing meant a flood of fresh keys locked
   * out everybody who was not already counted.
   */
  const makeRoom = (now: number): void => {
    for (const [key, window] of windows) {
      if (windows.size <= roomTarget && now - window.startedAt < options.windowMs) {
        return;
      }
      windows.delete(key);
    }
  };

  const verdict = (window: Window, now: number): RateLimitVerdict => {
    if (window.count <= options.max) {
      return { ok: true, retryAfter: 0 };
    }
    const remainingMs = window.startedAt + options.windowMs - now;
    return { ok: false, retryAfter: Math.max(1, Math.ceil(remainingMs / 1000)) };
  };

  return {
    check(key: string): RateLimitVerdict {
      const now = options.clock.now().getTime();
      const existing = windows.get(key);
      if (existing && now - existing.startedAt < options.windowMs) {
        existing.count += 1;
        return verdict(existing, now);
      }
      // A new window goes to the end of the order (see `windows`).
      windows.delete(key);
      if (windows.size >= maxKeys) {
        makeRoom(now);
      }
      const fresh: Window = { startedAt: now, count: 1 };
      windows.set(key, fresh);
      return verdict(fresh, now);
    },

    peek(key: string): RateLimitVerdict {
      const now = options.clock.now().getTime();
      const existing = windows.get(key);
      if (!existing || now - existing.startedAt >= options.windowMs) {
        return { ok: true, retryAfter: 0 };
      }
      // `count + 1`: the question is whether the *next* hit fits, not whether the last one did.
      return verdict({ startedAt: existing.startedAt, count: existing.count + 1 }, now);
    },

    get size() {
      return windows.size;
    },
  };
}

/**
 * The limits, in one place, each with the line of `device-code-login.md` it comes from.
 *
 * `authorizeIp` and `tokenIp` are not in that document: they are the general per-IP limiter the
 * browser flow needs, sized so an honest sign-in never meets one. Nor are `tokenClient` and
 * `tokenClientAuthFailIp`, which exist because the hosted app refreshes every session from one
 * address (the doc's own refresh limit, 20 / h per session, is not implemented here).
 */
export interface PortalLimiters {
  /** 5 / 10 min per install_id (POST /auth/device/code). */
  readonly deviceCodeInstall: RateLimiter;
  /** 30 / 10 min per IP (POST /auth/device/code). */
  readonly deviceCodeIp: RateLimiter;
  /** 10 / 10 min per portal user (POST /auth/device/approve). */
  readonly approveUser: RateLimiter;
  /**
   * 30 / 15 min per IP. The real protection is the per-address limit counted from the
   * `login_otps` rows (3 / 15 min); this one exists to bound a spray across many addresses. It is
   * deliberately loose because a whole office behind one NAT address is the normal case in the
   * market this ships to, and a tight per-IP OTP limit would lock out a floor of real users.
   */
  readonly otpSendIp: RateLimiter;
  /** 300 / 10 min per IP across the browser flow -- a page-view bound, not an abuse bound. */
  readonly authorizeIp: RateLimiter;
  /**
   * 300 / 10 min per IP on POST /auth/token for every PUBLIC grant: `authorization_code`, and a
   * refresh that does not authenticate as a confidential client. A refresh that does goes to
   * `tokenClient` instead, because the host sends every hosted session's refresh from one address,
   * and on this bucket that capped the hosted app at ~300 active sessions.
   */
  readonly tokenIp: RateLimiter;
  /**
   * 20,000 / 10 min per `client_id`, for refreshes from a confidential client whose secret was
   * verified. The host refreshes each session about every 10 minutes, so this is roughly the
   * number of hosted sessions one client can keep alive. It is keyed on the client, not the
   * address, because the client is what authenticated.
   */
  readonly tokenClient: RateLimiter;
  /**
   * 20 / 10 min per IP: failed client authentications on a refresh. It is PEEKED before the
   * client is looked up and counted only on a failure, so an address spraying secrets is refused
   * before it costs a query. An honest host never fails and is never slowed by it. It is a bucket
   * of its own, not `tokenIp`, because the host's sign-ins land in `tokenIp`, and that must not
   * decide whether the same host may refresh.
   */
  readonly tokenClientAuthFailIp: RateLimiter;
  /**
   * 600 / 10 min per IP on POST /auth/device/token, the poll. The doc's threat table ("Polling
   * abuse") names a per-IP limit here, and none was implemented, on an unauthenticated endpoint
   * that costs two database round trips a call. One honest device polls every 5 s for the code's
   * 10 minutes, 120 polls, so this must never be set below that. 600 leaves room for five devices
   * signing in at once behind one office address. The per-code `slow_down` and 200-poll ceiling
   * (`store/postgres/device-codes.ts`) still apply underneath.
   */
  readonly deviceTokenIp: RateLimiter;
  /**
   * 300 / 10 min per IP on GET /tenant/config.
   *
   * Its own bucket rather than a share of `tokenIp`: the unauthenticated `?tenant=<slug>` branch is
   * a tenant-name oracle and three database round trips, and it had no limiter at all (SR-42).
   * Putting it on the token bucket would let branding lookups spend the budget a sign-in needs.
   */
  readonly tenantConfigIp: RateLimiter;
}

const TEN_MINUTES = 10 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;

export function createPortalLimiters(clock: Clock): PortalLimiters {
  return Object.freeze({
    deviceCodeInstall: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 5 }),
    deviceCodeIp: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 30 }),
    approveUser: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 10 }),
    otpSendIp: createRateLimiter({ clock, windowMs: FIFTEEN_MINUTES, max: 30 }),
    authorizeIp: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 300 }),
    tokenIp: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 300 }),
    tokenClient: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 20_000 }),
    tokenClientAuthFailIp: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 20 }),
    deviceTokenIp: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 600 }),
    tenantConfigIp: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 300 }),
  });
}

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
  /** A cap, so the limiter cannot itself become the memory exhaustion it is defending against. */
  readonly maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 20_000;

interface Window {
  startedAt: number;
  count: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const windows = new Map<string, Window>();
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;

  const sweep = (now: number): void => {
    for (const [key, window] of windows) {
      if (now - window.startedAt >= options.windowMs) {
        windows.delete(key);
      }
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
      if (windows.size >= maxKeys) {
        sweep(now);
        if (windows.size >= maxKeys) {
          // Full of live windows: refuse rather than grow. A caller that sees this has either
          // been flooded or sized the cap wrong, and both are better than an OOM.
          return { ok: false, retryAfter: Math.ceil(options.windowMs / 1000) };
        }
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
 * browser flow needs, sized so an honest sign-in never meets one.
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
  /** 300 / 10 min per IP on POST /auth/token, which one host process calls for all its users. */
  readonly tokenIp: RateLimiter;
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
    tenantConfigIp: createRateLimiter({ clock, windowMs: TEN_MINUTES, max: 300 }),
  });
}

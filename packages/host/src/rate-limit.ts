/**
 * Request rate limiting for the hosted deployment (docs/internal/web-security-spec.md, row A4).
 *
 * Token buckets, in memory, per client key. Three of them, all server-mode only:
 *   - per client IP, so one machine cannot flood the box;
 *   - per session cookie (hashed), so one signed-in account cannot spread that flood over many IPs;
 *   - a tighter per-IP bucket on `/api/v1/auth/*`, where every request costs a portal round trip.
 *
 * The maps are bounded and evict least-recently-used, so an attacker who rotates the key (a fresh
 * source IP per request, a fresh cookie per request) cannot turn the limiter itself into the leak:
 * the memory cost is fixed at `MAX_RATE_KEYS` buckets whatever arrives.
 *
 * Nothing here runs off server mode. The desktop and webdev are single-user on loopback; a limiter
 * there would only ever refuse the one person using the machine.
 */
import { createHash } from "node:crypto";
import type { EnvLike } from "@agentforge/core";

/** The reason code every refusal answers with; the status is 429 and `Retry-After` is in seconds. */
export const RATE_LIMITED_CODE = "rate_limited";
export const RATE_LIMITED_MESSAGE = "Too many requests. Please slow down and try again.";

export const DEFAULT_IP_RPM = 600;
export const DEFAULT_IP_BURST = 100;
export const DEFAULT_SESSION_RPM = 300;
export const DEFAULT_SESSION_BURST = 50;
export const DEFAULT_AUTH_RPM = 30;
export const DEFAULT_AUTH_BURST = 10;

export const RATE_IP_RPM_ENV = "AGENTFORGE_RATE_IP_RPM";
export const RATE_SESSION_RPM_ENV = "AGENTFORGE_RATE_SESSION_RPM";
export const RATE_AUTH_RPM_ENV = "AGENTFORGE_RATE_AUTH_RPM";

/** Upper bound on live buckets per limiter. 50k x ~40 bytes is a few megabytes, and it cannot grow. */
export const MAX_RATE_KEYS = 50_000;

/** Every route under here is a portal round trip, so it gets the tight bucket. */
export const AUTH_PATH_PREFIX = "/api/v1/auth/";

/** Length of the hex session key; half a SHA-256 is far past collision-relevant for a bucket map. */
const SESSION_KEY_HEX_LENGTH = 32;

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;

export type RateScope = "ip" | "session" | "auth";

/** `retryAfterSeconds` is 0 when allowed, so callers never narrow on `allowed` to read it. */
export type BucketDecision = { readonly allowed: boolean; readonly retryAfterSeconds: number };

export type RateDecision = BucketDecision & { readonly scope: RateScope | null };

export interface RateLimiterOptions {
  /** Sustained requests per minute. Zero or negative switches the limiter off entirely. */
  readonly rpm: number;
  /** How many requests may arrive at once before the sustained rate starts to bite. */
  readonly burst: number;
  readonly maxKeys?: number;
}

export interface RateLimiter {
  /** Spends one token for `key` at `now` (epoch ms). */
  take(key: string, now: number): BucketDecision;
  /** Live bucket count; bounded by `maxKeys`. */
  size(): number;
}

/** One bucket, replaced rather than mutated on every take. */
type Bucket = { readonly tokens: number; readonly at: number };

const ALLOWED: BucketDecision = { allowed: true, retryAfterSeconds: 0 };
const RATE_ALLOWED: RateDecision = { ...ALLOWED, scope: null };

export function createRateLimiter({ rpm, burst, maxKeys = MAX_RATE_KEYS }: RateLimiterOptions): RateLimiter {
  const perMs = rpm / MS_PER_MINUTE;
  const capacity = Math.max(1, burst);
  // Insertion order IS the LRU order: a hit deletes and re-sets the key, so the first entry the
  // iterator yields is always the least recently used one.
  const buckets = new Map<string, Bucket>();

  const take = (key: string, now: number): BucketDecision => {
    if (perMs <= 0) {
      return ALLOWED;
    }
    const current = buckets.get(key);
    const tokens = current ? Math.min(capacity, current.tokens + Math.max(0, now - current.at) * perMs) : capacity;
    if (current) {
      buckets.delete(key);
    }
    if (tokens < 1) {
      buckets.set(key, { tokens, at: now });
      return { allowed: false, retryAfterSeconds: retryAfter(1 - tokens, perMs) };
    }
    buckets.set(key, { tokens: tokens - 1, at: now });
    evictOldest(buckets, maxKeys);
    return ALLOWED;
  };

  return { take, size: () => buckets.size };
}

/** Whole seconds, rounded up, never below one: `Retry-After: 0` invites an instant retry. */
function retryAfter(missingTokens: number, perMs: number): number {
  return Math.max(1, Math.ceil(missingTokens / perMs / MS_PER_SECOND));
}

function evictOldest(buckets: Map<string, Bucket>, maxKeys: number): void {
  while (buckets.size > maxKeys) {
    const oldest = buckets.keys().next();
    if (oldest.done) {
      return;
    }
    buckets.delete(oldest.value);
  }
}

/**
 * The address a bucket is keyed on: the LAST `X-Forwarded-For` hop.
 *
 * `X-Forwarded-For` is only read in server mode, where the reverse proxy in front is the one that
 * writes it and the app is not reachable any other way. Off server mode the header is attacker
 * controlled and worth nothing, so the socket address is the only answer.
 *
 * Why the last hop and not the first: the header is a client-to-proxy chain, and a caller may send
 * one of its own. A proxy that APPENDS then leaves the forged value first and the address it saw
 * last, so reading the first hop would let one machine mint a fresh bucket per request by rotating
 * a header - the limiter would stop limiting anything. The last hop is the only entry this
 * deployment's own proxy wrote, so that is the one that is keyed on.
 *
 * This holds exactly as long as the proxy in front is the only thing that can reach the app port
 * and it is the one that sets the header (webapp-deploy/Caddyfile: Caddy runs in the app's network
 * namespace, the app binds loopback, and the plaintext refusal in http-adapter.ts refuses anything
 * that did not come through it). One more untrusted hop appended behind Caddy would move the client
 * address again, so any extra proxy has to be reflected here.
 */
export function clientIp(input: {
  readonly forwardedFor?: string | null;
  readonly remoteAddress?: string | null;
  readonly serverMode: boolean;
}): string | null {
  const hops = input.serverMode ? (input.forwardedFor ?? "").split(",") : [];
  const lastHop = hops.at(-1)?.trim();
  return lastHop || input.remoteAddress?.trim() || null;
}

/** A session cookie never becomes a map key or a log field in the clear; its hash does. */
export function sessionRateKey(cookieValue: string | null | undefined): string | null {
  const value = cookieValue?.trim();
  if (!value) {
    return null;
  }
  return createHash("sha256").update(value).digest("hex").slice(0, SESSION_KEY_HEX_LENGTH);
}

export function isAuthPath(path: string): boolean {
  return path.startsWith(AUTH_PATH_PREFIX);
}

export interface RateLimitConfig {
  readonly ip: { readonly rpm: number; readonly burst: number };
  readonly session: { readonly rpm: number; readonly burst: number };
  readonly auth: { readonly rpm: number; readonly burst: number };
}

export function rateLimitConfig(env: EnvLike): RateLimitConfig {
  return {
    ip: bucketConfig(env[RATE_IP_RPM_ENV], DEFAULT_IP_RPM, DEFAULT_IP_BURST),
    session: bucketConfig(env[RATE_SESSION_RPM_ENV], DEFAULT_SESSION_RPM, DEFAULT_SESSION_BURST),
    auth: bucketConfig(env[RATE_AUTH_RPM_ENV], DEFAULT_AUTH_RPM, DEFAULT_AUTH_BURST),
  };
}

/**
 * Junk falls back to the default rather than switching the limiter off: a typo in `.env` must not
 * quietly remove the limit. An explicit non-positive number does switch it off, which is the
 * documented escape hatch.
 */
function bucketConfig(raw: string | undefined, defaultRpm: number, defaultBurst: number) {
  const parsed = Number(raw?.trim());
  const rpm = raw?.trim() && Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : defaultRpm;
  return { rpm, burst: Math.max(1, Math.min(defaultBurst, rpm || defaultBurst)) };
}

type Limiters = {
  readonly config: RateLimitConfig;
  readonly ip: RateLimiter;
  readonly session: RateLimiter;
  readonly auth: RateLimiter;
};

let limiters: Limiters | null = null;

function limitersFor(env: EnvLike): Limiters {
  const config = rateLimitConfig(env);
  if (limiters && sameConfig(limiters.config, config)) {
    return limiters;
  }
  limiters = {
    config,
    ip: createRateLimiter(config.ip),
    session: createRateLimiter(config.session),
    auth: createRateLimiter(config.auth),
  };
  return limiters;
}

function sameConfig(a: RateLimitConfig, b: RateLimitConfig): boolean {
  return (["ip", "session", "auth"] as const).every(
    (scope) => a[scope].rpm === b[scope].rpm && a[scope].burst === b[scope].burst,
  );
}

/** Drops every bucket. Tests call it between cases; nothing in the server does. */
export function resetRateLimiters(): void {
  limiters = null;
}

export interface RateCheckInput {
  readonly serverMode: boolean;
  readonly path: string;
  readonly ip: string | null;
  readonly sessionKey: string | null;
  readonly now?: number;
  readonly env?: EnvLike;
}

/**
 * The one call the adapter makes. Order matters only for which scope the refusal names: the tight
 * auth bucket is checked after the general IP one so an auth flood is reported as `auth`.
 */
export function checkRequestRate(input: RateCheckInput): RateDecision {
  if (!input.serverMode) {
    return RATE_ALLOWED;
  }
  const now = input.now ?? Date.now();
  const { ip, session, auth } = limitersFor(input.env ?? process.env);
  const checks: readonly (readonly [RateScope, RateLimiter, string | null])[] = [
    ["ip", ip, input.ip],
    ["auth", auth, isAuthPath(input.path) ? input.ip : null],
    ["session", session, input.sessionKey],
  ];
  for (const [scope, limiter, key] of checks) {
    if (key === null) {
      continue;
    }
    const decision = limiter.take(key, now);
    if (!decision.allowed) {
      return { allowed: false, retryAfterSeconds: decision.retryAfterSeconds, scope };
    }
  }
  return RATE_ALLOWED;
}

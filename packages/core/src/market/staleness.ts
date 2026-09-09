/**
 * Staleness: data is stale once strictly older than its TTL, and may no longer
 * support a two-sided view (C3) once older than twice the TTL.
 *
 * Port of dps-market-mcp `schemas/common.py`. Dates are ISO 8601 strings;
 * anything Date.parse cannot read throws (fail loud, C8).
 */
export type Staleness = { asOf: string; maxAgeSeconds: number; isStale: boolean };

/** v1 keys are kept for the cache table; the v2 watch kinds are quote / technical / history / macro. */
export const TTL_SECONDS = {
  prices: 36 * 3600,
  technicals: 6 * 3600,
  fundamentals: 30 * 86400,
  analysts: 30 * 86400,
  news: 90 * 86400,
  quote: 300,
  technical: 900,
  history: 6 * 3600,
  macro: 300,
} as const;
export type TtlKind = keyof typeof TTL_SECONDS;

export const INSUFFICIENT_AGE_MULTIPLIER = 2;

function parseIso(label: string, iso: string): number {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (Number.isNaN(ms)) {
    throw new RangeError(`staleness: ${label} is not an ISO 8601 date: ${JSON.stringify(iso)}`);
  }
  return ms;
}

function requirePositiveAge(maxAgeSeconds: number): void {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new RangeError(`staleness: maxAgeSeconds must be a positive integer, got ${maxAgeSeconds}`);
  }
}

/** Seconds elapsed between asOf and now (negative when asOf is in the future). */
export function ageSeconds(asOfIso: string, nowIso: string): number {
  return (parseIso("now", nowIso) - parseIso("asOf", asOfIso)) / 1000;
}

/** Stale once strictly older than maxAgeSeconds; exactly at the limit is still fresh. */
export function computeStaleness(asOfIso: string, nowIso: string, maxAgeSeconds: number): Staleness {
  requirePositiveAge(maxAgeSeconds);
  return { asOf: asOfIso, maxAgeSeconds, isStale: ageSeconds(asOfIso, nowIso) > maxAgeSeconds };
}

/** Beyond 2x max age the data may no longer support a two-sided view (C3). */
export function isInsufficient(asOfIso: string, nowIso: string, maxAgeSeconds: number): boolean {
  requirePositiveAge(maxAgeSeconds);
  return ageSeconds(asOfIso, nowIso) > INSUFFICIENT_AGE_MULTIPLIER * maxAgeSeconds;
}

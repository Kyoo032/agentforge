/**
 * The rule-of-thumb bands a ratio is read against, and the arrow that says which way it moved.
 *
 * These thresholds are **general-purpose conventions**, not advice and not an industry benchmark:
 * nothing in an uploaded balance sheet carries either. They live in one typed, documented table so
 * that a reader can see every line they are being judged against, change it in the studio, and see
 * the changed figure in the report — rather than a number quietly deciding "healthy" on their behalf.
 *
 * A band is only ever attached to a ratio that has one here. A ratio with no rule is reported with
 * its value and no colour, which is the honest answer when there is no convention worth the name.
 */
import { z } from "zod";
import type { ReportFlagLevel } from "../report";

export const RATIO_BAND_LEVELS = ["healthy", "watch", "risk"] as const;
export type RatioBandLevel = (typeof RATIO_BAND_LEVELS)[number];

/** Which way is good. A current ratio wants to be high; a debt-to-equity wants to be low. */
export const RATIO_BAND_DIRECTIONS = ["higher-better", "lower-better"] as const;
export type RatioBandDirection = (typeof RATIO_BAND_DIRECTIONS)[number];

export type RatioBandRule = {
  readonly metric: string;
  readonly direction: RatioBandDirection;
  /** At or beyond this, the band is `healthy`. */
  readonly healthy: number;
  /** At or beyond this but short of `healthy`, the band is `watch`. Anything past it is `risk`. */
  readonly watch: number;
};

function rule(metric: string, direction: RatioBandDirection, healthy: number, watch: number): RatioBandRule {
  return { metric, direction, healthy, watch };
}

/**
 * The defaults, as they would be written on a credit analyst's whiteboard. Deliberately blunt:
 * a band that pretends to sector precision it does not have is worse than one a reader can argue with.
 */
export const DEFAULT_RATIO_BANDS: readonly RatioBandRule[] = Object.freeze([
  rule("currentRatio", "higher-better", 1.5, 1),
  rule("quickRatio", "higher-better", 1, 0.8),
  rule("cashRatio", "higher-better", 0.5, 0.2),
  rule("debtToEquityTotal", "lower-better", 1, 2),
  rule("debtToEquityInterestBearing", "lower-better", 1, 2),
  rule("nonCurrentDebtToEquity", "lower-better", 0.75, 1.5),
  rule("debtToAssets", "lower-better", 0.5, 0.7),
  rule("equityRatio", "higher-better", 0.4, 0.2),
  rule("interestCoverage", "higher-better", 3, 1.5),
  rule("dscrEbitda", "higher-better", 1.25, 1),
  rule("dscrEbit", "higher-better", 1.25, 1),
  rule("grossMarginPct", "higher-better", 20, 10),
  rule("operatingMarginPct", "higher-better", 10, 3),
  rule("netMarginPct", "higher-better", 5, 0),
  rule("returnOnAssetsPct", "higher-better", 5, 2),
  rule("returnOnEquityPct", "higher-better", 12, 5),
]);

/** One threshold pair the reader edited in the studio. Both ends are required: half a band is a trap. */
export const ratioBandOverrideSchema = z.object({
  metric: z.string().min(1),
  healthy: z.number().finite(),
  watch: z.number().finite(),
});

export type RatioBandOverride = z.infer<typeof ratioBandOverrideSchema>;

/** The table in force: the documented defaults, with the reader's own thresholds laid over the top. */
export function ratioBandTable(overrides: readonly RatioBandOverride[] = []): readonly RatioBandRule[] {
  const chosen = new Map(overrides.map((entry) => [entry.metric, entry]));
  return DEFAULT_RATIO_BANDS.map((entry) => {
    const override = chosen.get(entry.metric);
    return override ? { ...entry, healthy: override.healthy, watch: override.watch } : entry;
  });
}

export function ratioBandRule(
  metric: string,
  table: readonly RatioBandRule[] = DEFAULT_RATIO_BANDS,
): RatioBandRule | null {
  return table.find((entry) => entry.metric === metric) ?? null;
}

/** Which band a value falls in. Null in, null out — an uncomputable ratio has no colour. */
export function bandFor(rule: RatioBandRule, value: number | null): RatioBandLevel | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (rule.direction === "higher-better") {
    return value >= rule.healthy ? "healthy" : value >= rule.watch ? "watch" : "risk";
  }
  return value <= rule.healthy ? "healthy" : value <= rule.watch ? "watch" : "risk";
}

/** The band this metric's value lands in under the table in force, or null when it has no rule. */
export function bandForMetric(
  metric: string,
  value: number | null,
  table: readonly RatioBandRule[] = DEFAULT_RATIO_BANDS,
): RatioBandLevel | null {
  const found = ratioBandRule(metric, table);
  return found ? bandFor(found, value) : null;
}

/** The report's own three levels. `healthy` is the report's `good`; the other two keep their names. */
export function reportFlagLevel(level: RatioBandLevel): ReportFlagLevel {
  return level === "healthy" ? "good" : level;
}

export const RATIO_TREND_DIRECTIONS = ["up", "down", "flat"] as const;
export type RatioTrendDirection = (typeof RATIO_TREND_DIRECTIONS)[number];

export type RatioTrend = {
  readonly direction: RatioTrendDirection;
  readonly delta: number | null;
  /** Whether the move is in the good direction for this metric, once the band's direction is known. */
  readonly verdict: "better" | "worse" | "same" | null;
};

/** Below this share of the prior value a move is noise, not a trend. */
export const RATIO_TREND_FLAT_SHARE = 0.005;

/** This period against the one before it. No prior period means no arrow, not a flat one. */
export function trendOf(current: number | null, prior: number | null, direction?: RatioBandDirection): RatioTrend {
  if (current === null || prior === null || !Number.isFinite(current) || !Number.isFinite(prior)) {
    return { direction: "flat", delta: null, verdict: null };
  }
  const delta = current - prior;
  const flat = Math.abs(delta) <= Math.abs(prior) * RATIO_TREND_FLAT_SHARE;
  if (flat) {
    return { direction: "flat", delta, verdict: direction ? "same" : null };
  }
  const up = delta > 0;
  const verdict = direction === undefined ? null : up === (direction === "higher-better") ? "better" : "worse";
  return { direction: up ? "up" : "down", delta, verdict };
}

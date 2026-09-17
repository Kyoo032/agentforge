/**
 * One line per ratio: what it is, what it came to, which band it fell in, and which way it moved.
 *
 * This is the object the screen, the workbook, the deck and the model's fact sheet all read, so the
 * band a reader sees on a gauge is the same band the narrative was given and the same band the
 * exported cell is coloured with. Nothing downstream re-decides a band.
 */
import { bandFor, ratioBandRule, trendOf, type RatioBandLevel, type RatioBandRule, type RatioTrend } from "./bands";
import type { ComputedRatios } from "./compute";
import { ratioFigures } from "./compute";
import { RATIO_RATIO_METRICS, RATIO_RESULT_METRICS, RATIO_TOTAL_METRICS, type RatioMetricMeta } from "./keys";

export type RatioScorecardEntry = {
  readonly meta: RatioMetricMeta;
  readonly period: string;
  readonly value: number | null;
  readonly priorPeriod: string | null;
  readonly prior: number | null;
  readonly band: RatioBandLevel | null;
  /** The threshold pair the band came from, so the report can print what it was judged against. */
  readonly rule: RatioBandRule | null;
  readonly trend: RatioTrend;
};

function entryFor(
  computed: ComputedRatios,
  meta: RatioMetricMeta,
  period: string,
  priorPeriod: string | null,
): RatioScorecardEntry {
  const value = ratioFigures(computed, period)?.values[meta.key] ?? null;
  const prior = priorPeriod === null ? null : (ratioFigures(computed, priorPeriod)?.values[meta.key] ?? null);
  const rule = ratioBandRule(meta.key, computed.bands);
  return {
    meta,
    period,
    value,
    priorPeriod,
    prior,
    band: rule ? bandFor(rule, value) : null,
    rule,
    trend: trendOf(value, prior, rule?.direction),
  };
}

function scorecardOf(
  computed: ComputedRatios,
  metrics: readonly RatioMetricMeta[],
  period?: string,
): readonly RatioScorecardEntry[] {
  const chosen = period ?? computed.latest;
  const at = computed.periods.indexOf(chosen);
  const priorPeriod = at > 0 ? (computed.periods[at - 1] as string) : null;
  return metrics.map((meta) => entryFor(computed, meta, chosen, priorPeriod));
}

/** The ratios, banded and trended, for one period — the newest one unless another is asked for. */
export function ratioScorecard(computed: ComputedRatios, period?: string): readonly RatioScorecardEntry[] {
  return scorecardOf(computed, RATIO_RATIO_METRICS, period);
}

/** The piles the ratios were divided from, same shape. Never banded: a total is not healthy or unhealthy. */
export function ratioTotalsCard(computed: ComputedRatios, period?: string): readonly RatioScorecardEntry[] {
  return scorecardOf(computed, RATIO_TOTAL_METRICS, period);
}

/** The profit line rebuilt from the buckets, same shape. */
export function ratioResultCard(computed: ComputedRatios, period?: string): readonly RatioScorecardEntry[] {
  return scorecardOf(computed, RATIO_RESULT_METRICS, period);
}

/** Every line the report shows for one period, totals then profit line then ratios. */
export function ratioFullCard(computed: ComputedRatios, period?: string): readonly RatioScorecardEntry[] {
  return [...ratioTotalsCard(computed, period), ...ratioResultCard(computed, period), ...ratioScorecard(computed, period)];
}

/** The ratios worth a headline tile, in the order a credit reader wants them. */
export const RATIO_HEADLINE_KEYS = [
  "currentRatio",
  "quickRatio",
  "debtToEquityTotal",
  "debtToEquityInterestBearing",
  "nonCurrentDebtToEquity",
  "interestCoverage",
  "dscrEbitda",
  "dscrEbit",
] as const;

/** The ratios a gauge is drawn for: one per family, so the reader sees five dials and not twenty. */
export const RATIO_GAUGE_KEYS = ["currentRatio", "quickRatio", "debtToEquityTotal", "dscrEbitda", "interestCoverage"] as const;

export function headlineScorecard(computed: ComputedRatios, period?: string): readonly RatioScorecardEntry[] {
  const card = ratioScorecard(computed, period);
  return RATIO_HEADLINE_KEYS.flatMap((key) => card.filter((entry) => entry.meta.key === key));
}

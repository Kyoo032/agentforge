/**
 * One period's rows summed into its buckets, and the buckets summed into the piles a ratio divides.
 *
 * Two rules decide everything downstream and both live here:
 *
 * - **A period is never crossed.** Every total is built from the rows of one period. A two-year
 *   sheet summed across its columns would put this company's current assets at twice what they are
 *   and make every ratio meaningless, so the period is the outer loop and never an afterthought.
 * - **A bucket is added once per aggregate it belongs to, never once per row.** `bagian lancar utang
 *   jangka panjang` lands in current liabilities *and* in interest-bearing debt because its bucket
 *   says so — not because anything here special-cases it.
 *
 * `count` rides beside every total so the caller can tell "this pile is zero" from "there is no such
 * pile", which is the difference between a ratio of 0 and a ratio that cannot be computed.
 */
import {
  RATIO_AGGREGATES,
  RATIO_BUCKETS,
  bucketAggregates,
  bucketAmount,
  type RatioAggregate,
  type RatioBucket,
} from "./buckets";
import type { ClassifiedRatioRow } from "./classify";

export type RatioTally = { readonly value: number; readonly count: number };

export type RatioBucketTotals = Readonly<Record<RatioBucket, RatioTally>>;
export type RatioAggregateTotals = Readonly<Record<RatioAggregate, RatioTally>>;

const EMPTY: RatioTally = Object.freeze({ value: 0, count: 0 });

function emptyBuckets(): Record<RatioBucket, RatioTally> {
  return Object.fromEntries(RATIO_BUCKETS.map((bucket) => [bucket, EMPTY])) as Record<RatioBucket, RatioTally>;
}

function emptyAggregates(): Record<RatioAggregate, RatioTally> {
  return Object.fromEntries(RATIO_AGGREGATES.map((name) => [name, EMPTY])) as Record<RatioAggregate, RatioTally>;
}

function add(tally: RatioTally, amount: number): RatioTally {
  return { value: tally.value + amount, count: tally.count + 1 };
}

/**
 * The rows of one period, summed per bucket with this bucket's own sign policy applied.
 *
 * The accumulator is a local object built and returned in one go: the caller's rows are never
 * touched, and a statement with a few hundred lines does not pay for a copy per row.
 */
export function bucketTotalsFor(rows: readonly ClassifiedRatioRow[], period: string): RatioBucketTotals {
  const totals = emptyBuckets();
  for (const row of rows) {
    if ((row.period ?? "") !== period || row.bucket === "excluded") {
      continue;
    }
    totals[row.bucket] = add(totals[row.bucket], bucketAmount(row.bucket, row.amount));
  }
  return totals;
}

/** The bucket totals rolled into the piles, following each bucket's membership list. */
export function aggregateTotalsFrom(buckets: RatioBucketTotals): RatioAggregateTotals {
  const totals = emptyAggregates();
  for (const bucket of RATIO_BUCKETS) {
    const tally = buckets[bucket];
    if (tally.count === 0) {
      continue;
    }
    for (const name of bucketAggregates(bucket)) {
      totals[name] = { value: totals[name].value + tally.value, count: totals[name].count + tally.count };
    }
  }
  return totals;
}

/** The periods in the order a reader reads them: oldest first, by year when every label is one. */
export function orderRatioPeriods(rows: readonly { readonly period?: string }[]): readonly string[] {
  const seen: string[] = [];
  for (const row of rows) {
    const period = row.period ?? "";
    if (!seen.includes(period)) {
      seen.push(period);
    }
  }
  // Sorted only when every label is comparable — which is what rescues the Indonesian statement that
  // prints 2024 to the left of 2023. Anything else ("Q1", "FY", "") keeps the sheet's own order,
  // because a blind sort of labels it cannot compare would invent an order the reader never wrote.
  const sortable = seen.every((period) => /^\d{4}(-\d{2})?$/.test(period));
  return sortable ? [...seen].sort() : seen;
}

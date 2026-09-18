/**
 * The rows against the totals the statement printed beside them.
 *
 * A scorecard built only from leaves is one unreadable cell away from nonsense: drop `Harga Pokok
 * Penjualan` and gross profit silently becomes revenue, EBIT becomes revenue minus opex, and every
 * coverage ratio downstream is out by the whole of the cost of sales while the report says nothing.
 * The statement itself already carries the answer — it prints `LABA KOTOR` and `LABA USAHA (EBIT)` —
 * so this file uses those printed rows twice:
 *
 * - **Repair.** When a whole bucket is missing for a period and a printed subtotal plus the rows
 *   that ARE there determine it, one synthetic row is added, labelled with where it came from. The
 *   maths downstream stays exactly what it was — leaves in, ratios out — and the workbook's own
 *   SUMIFS formulas recompute the same figure, because the repair is a row and not an override.
 * - **Cross-check.** Every printed subtotal is then compared against the figure rebuilt from the
 *   rows. A disagreement is never resolved quietly: it comes back as a mismatch the report flags.
 *
 * A repair only ever adds a cost that is really implied (a positive residual). Anything else is a
 * disagreement a synthetic row cannot express honestly, and it stays a mismatch instead.
 */
import type { ReportLocale } from "../report";
import type { RatioBucket } from "./buckets";
import type { ClassifiedRatioRow } from "./classify";
import { ratioMetricMeta } from "./keys";
import { statedTotalsFor, type RatioStatedKey, type RatioStatedRow, type RatioStatedTotals } from "./stated";
import { aggregateTotalsFrom, bucketTotalsFor, type RatioAggregateTotals } from "./totals";
import { RATIO_TEXT, say } from "./text";

/** How far a rebuilt figure may sit from the printed one before the difference is reported. */
export const RATIO_STATED_TOLERANCE = 0.005;
/** Rounding noise floor, in currency units, so a one-rupiah difference is not an alarm. */
const ABSOLUTE_FLOOR = 1;

/** Confidence a repaired row carries: strong evidence, but not a row the sheet actually printed. */
export const RATIO_REPAIR_CONFIDENCE = 0.8;

/** A bucket rebuilt from a printed subtotal because the sheet's own row never arrived. */
export type RatioRepair = {
  /** The bucket the synthetic row was put in — always a metric key too. */
  readonly key: "revenue" | "cogs" | "opex";
  readonly period: string;
  /** The size of the bucket that was rebuilt. The synthetic row carries the sheet's own sign. */
  readonly amount: number;
  /** The printed subtotal it was backed out of. */
  readonly from: RatioStatedKey;
};

/** A printed subtotal the rows do not add up to. Reported, never silently adopted. */
export type RatioMismatch = {
  readonly key: RatioStatedKey;
  readonly period: string;
  readonly derived: number;
  readonly stated: number;
};

function agrees(derived: number, stated: number): boolean {
  return Math.abs(derived - stated) <= Math.max(ABSOLUTE_FLOOR, Math.abs(stated) * RATIO_STATED_TOLERANCE);
}

function present(totals: RatioAggregateTotals, name: keyof RatioAggregateTotals): number | undefined {
  return totals[name].count === 0 ? undefined : totals[name].value;
}

function sum(...parts: readonly (number | undefined)[]): number | undefined {
  const known = parts.filter((part): part is number => part !== undefined);
  return known.length === 0 ? undefined : known.reduce((total, part) => total + part, 0);
}

/** The figures a period's rows rebuild, named the way the printed subtotals are. */
function derivedTotals(totals: RatioAggregateTotals): Readonly<Partial<Record<RatioStatedKey, number>>> {
  const currentAssets = present(totals, "currentAssets");
  const nonCurrentAssets = present(totals, "nonCurrentAssets");
  const currentLiabilities = present(totals, "currentLiabilities");
  const nonCurrentLiabilities = present(totals, "nonCurrentLiabilities");
  const revenue = present(totals, "revenue");
  const cogs = present(totals, "cogs");
  const opex = present(totals, "opex");
  const grossProfit = revenue === undefined ? undefined : revenue - (cogs ?? 0);
  const ebit = grossProfit === undefined ? undefined : grossProfit - (opex ?? 0);
  const profitBeforeTax =
    ebit === undefined ? undefined : ebit - (present(totals, "interest") ?? 0) + (present(totals, "otherIncome") ?? 0);
  return {
    currentAssets,
    nonCurrentAssets,
    totalAssets: sum(currentAssets, nonCurrentAssets),
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities: sum(currentLiabilities, nonCurrentLiabilities),
    totalEquity: present(totals, "equity"),
    revenue,
    grossProfit,
    opex,
    ebit,
    profitBeforeTax,
    netProfit: profitBeforeTax === undefined ? undefined : profitBeforeTax - (present(totals, "tax") ?? 0),
  };
}

/** The bucket a repaired figure is written into. */
const REPAIR_BUCKET: Readonly<Record<RatioRepair["key"], RatioBucket>> = Object.freeze({
  revenue: "revenue",
  cogs: "cogs",
  opex: "opex",
});

type RepairPlan = { readonly key: RatioRepair["key"]; readonly amount: number; readonly from: RatioStatedKey };

/**
 * What one period's rows are missing that its printed subtotals determine.
 *
 * Read top to bottom: cost of sales falls out of revenue and the printed gross profit, revenue out
 * of the printed gross profit and the cost of sales, and operating expenses out of the gross profit
 * now known and the printed EBIT. Each step only fires when the bucket is entirely absent — a bucket
 * with rows in it is the sheet speaking, and nothing here overrules that.
 */
function planFor(totals: RatioAggregateTotals, stated: RatioStatedTotals): readonly RepairPlan[] {
  const plans: RepairPlan[] = [];
  const revenue = present(totals, "revenue");
  const cogs = present(totals, "cogs");
  if (cogs === undefined && revenue !== undefined && stated.grossProfit !== undefined) {
    plans.push({ key: "cogs", amount: revenue - stated.grossProfit, from: "grossProfit" });
  } else if (revenue === undefined && cogs !== undefined && stated.grossProfit !== undefined) {
    plans.push({ key: "revenue", amount: stated.grossProfit + cogs, from: "grossProfit" });
  }
  const grossProfit = stated.grossProfit ?? (revenue === undefined ? undefined : revenue - (cogs ?? 0));
  if (present(totals, "opex") === undefined && grossProfit !== undefined && stated.ebit !== undefined) {
    plans.push({ key: "opex", amount: grossProfit - stated.ebit, from: "ebit" });
  }
  return plans.filter((plan) => Number.isFinite(plan.amount) && plan.amount > 0);
}

/**
 * Whether a bucket's rows are written negative on this sheet, so a repaired row is written the same
 * way. The buckets repaired here all read as magnitudes, so this is about the reader, not the maths.
 */
function signOfBucket(rows: readonly ClassifiedRatioRow[], bucket: RatioBucket): number {
  const written = rows.filter((row) => row.bucket === bucket && row.amount !== 0);
  return written.length > 0 && written.every((row) => row.amount < 0) ? -1 : 1;
}

function repairLabel(plan: RepairPlan, locale: ReportLocale): string {
  const metric = ratioMetricMeta(plan.key);
  const source = ratioMetricMeta(plan.from);
  const name = metric ? say(metric.label, locale) : plan.key;
  const from = source ? say(source.label, locale) : plan.from;
  return `${name} (${say(RATIO_TEXT.repair.from, locale)} ${from})`;
}

function repairRow(
  plan: RepairPlan,
  period: string,
  rows: readonly ClassifiedRatioRow[],
  locale: ReportLocale,
  currency: string,
): ClassifiedRatioRow {
  const bucket = REPAIR_BUCKET[plan.key];
  return {
    label: repairLabel(plan, locale),
    period,
    amount: plan.amount * signOfBucket(rows, bucket),
    currency,
    bucket,
    confidence: RATIO_REPAIR_CONFIDENCE,
    source: "reconciled",
    reason: `stated:${plan.from}`,
  };
}

export type RatioRepairResult = {
  readonly rows: readonly ClassifiedRatioRow[];
  readonly repairs: readonly RatioRepair[];
};

/**
 * The rows with the buckets a printed subtotal determines added back, one synthetic row each.
 *
 * Nothing is removed and nothing is rewritten: a repair is always an addition, so the audit table
 * and the workbook's Inputs sheet show exactly what the maths read.
 */
export function repairRatioRows(
  rows: readonly ClassifiedRatioRow[],
  stated: readonly RatioStatedRow[],
  periods: readonly string[],
  locale: ReportLocale = "en",
  currency = "",
): RatioRepairResult {
  if (stated.length === 0) {
    return { rows, repairs: [] };
  }
  const added: ClassifiedRatioRow[] = [];
  const repairs: RatioRepair[] = [];
  for (const period of periods) {
    const totals = aggregateTotalsFrom(bucketTotalsFor(rows, period));
    for (const plan of planFor(totals, statedTotalsFor(stated, period))) {
      const row = repairRow(plan, period, rows, locale, currency);
      added.push(row);
      repairs.push({ key: plan.key, period, amount: plan.amount, from: plan.from });
    }
  }
  return added.length === 0 ? { rows, repairs: [] } : { rows: [...rows, ...added], repairs };
}

/**
 * Every printed subtotal that the rows — repaired or not — do not add up to.
 *
 * A figure the rows cannot rebuild at all is not a contradiction and is left alone; only two
 * readings that both exist and disagree are reported.
 */
export function ratioMismatches(
  rows: readonly ClassifiedRatioRow[],
  stated: readonly RatioStatedRow[],
  periods: readonly string[],
): readonly RatioMismatch[] {
  return periods.flatMap((period) => {
    const derived = derivedTotals(aggregateTotalsFrom(bucketTotalsFor(rows, period)));
    const printed = statedTotalsFor(stated, period);
    return Object.entries(printed).flatMap(([key, value]) => {
      const mine = derived[key as RatioStatedKey];
      return mine === undefined || value === undefined || agrees(mine, value)
        ? []
        : [{ key: key as RatioStatedKey, period, derived: mine, stated: value }];
    });
  });
}

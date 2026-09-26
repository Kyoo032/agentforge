/**
 * The ratio maths. Plain arithmetic over confirmed, classified rows — no model, no I/O, no clock.
 *
 * Where a ratio has more than one legitimate reading, every reading is computed and labelled rather
 * than one being chosen behind the reader's back: **three** debt-to-equity figures (total
 * liabilities, interest-bearing debt, long-term liabilities only) and **two** DSCR bases (EBITDA and
 * EBIT). A scorecard that prints a single unlabelled "D/E" is a scorecard that has hidden a choice.
 *
 * `currentRatio`, `quickRatio`, the three debt-to-equity readings and both DSCRs are computed by
 * `ratioSet` in `../engine.ts`, whose definitions match these exactly — quick ratio as
 * (current assets - inventory) / current liabilities, DSCR as income / debt service. Everything else
 * is defined here because the engine has no equivalent.
 */
import { ratioSet } from "../engine";
import type { ReportLocale } from "../report";
import { DEFAULT_RATIO_BANDS, type RatioBandRule } from "./bands";
import { bucketAmount, type RatioBucket } from "./buckets";
import type { ClassifiedRatioRow } from "./classify";
import { RATIO_METRICS } from "./keys";
import { ratioMismatches, repairRatioRows, type RatioMismatch, type RatioRepair } from "./reconcile";
import type { RatioStatedRow } from "./stated";
import {
  aggregateTotalsFrom,
  bucketTotalsFor,
  orderRatioPeriods,
  type RatioAggregateTotals,
  type RatioBucketTotals,
} from "./totals";

/** Days in the year behind the turnover-to-days conversions. Editable; 365 is the convention. */
export const DEFAULT_DAYS_PER_YEAR = 365;

/** The supporting figures a P&L does not print, for one period. */
export type RatioSupporting = {
  readonly depreciation?: number;
  readonly principalRepayment?: number;
};

export type RatioParams = RatioSupporting & {
  readonly daysPerYear?: number;
  /** Per-period supporting figures, keyed by period label. Read before the period-free pair above. */
  readonly supporting?: Readonly<Record<string, RatioSupporting>>;
  /**
   * The `[subtotal]` rows the statement printed. Never summed with the leaves: they are what the
   * rows are held against, and what a missing bucket is rebuilt from. See `./reconcile.ts`.
   */
  readonly stated?: readonly RatioStatedRow[];
  /** The language a rebuilt row is labelled in. Labels only; no arithmetic reads this. */
  readonly locale?: ReportLocale;
};

export type RatioPeriodFigures = {
  readonly period: string;
  readonly buckets: RatioBucketTotals;
  readonly aggregates: RatioAggregateTotals;
  /** Every metric in `RATIO_METRICS`, or null where its inputs are not there. */
  readonly values: Readonly<Record<string, number | null>>;
};

function present(totals: RatioAggregateTotals, name: keyof RatioAggregateTotals): number | undefined {
  return totals[name].count === 0 ? undefined : totals[name].value;
}

function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator === undefined || denominator === undefined || denominator === 0) {
    return null;
  }
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function sum(...parts: readonly (number | undefined)[]): number | undefined {
  const known = parts.filter((part): part is number => part !== undefined);
  return known.length === 0 ? undefined : known.reduce((total, part) => total + part, 0);
}

function percent(numerator: number | undefined, denominator: number | undefined): number | null {
  const value = ratio(numerator, denominator);
  return value === null ? null : value * 100;
}

type Piles = {
  readonly currentAssets?: number;
  readonly nonCurrentAssets?: number;
  readonly totalAssets?: number;
  readonly currentLiabilities?: number;
  readonly nonCurrentLiabilities?: number;
  readonly totalLiabilities?: number;
  readonly interestBearingDebt?: number;
  readonly equity?: number;
  readonly cash?: number;
  readonly receivables?: number;
  readonly inventory?: number;
};

function pilesOf(buckets: RatioBucketTotals, totals: RatioAggregateTotals): Piles {
  const currentAssets = present(totals, "currentAssets");
  const nonCurrentAssets = present(totals, "nonCurrentAssets");
  const currentLiabilities = present(totals, "currentLiabilities");
  const nonCurrentLiabilities = present(totals, "nonCurrentLiabilities");
  return {
    currentAssets,
    nonCurrentAssets,
    totalAssets: sum(currentAssets, nonCurrentAssets),
    currentLiabilities,
    nonCurrentLiabilities,
    totalLiabilities: sum(currentLiabilities, nonCurrentLiabilities),
    interestBearingDebt: present(totals, "interestBearingDebt"),
    equity: present(totals, "equity"),
    cash: buckets.cash.count === 0 ? undefined : buckets.cash.value,
    receivables: buckets.receivables.count === 0 ? undefined : buckets.receivables.value,
    inventory: buckets.inventory.count === 0 ? undefined : buckets.inventory.value,
  };
}

type Result = {
  readonly revenue?: number;
  readonly cogs?: number;
  readonly grossProfit?: number;
  readonly opex?: number;
  readonly ebit?: number;
  readonly depreciation?: number;
  readonly ebitda?: number;
  readonly interestExpense?: number;
  readonly tax?: number;
  readonly otherIncome?: number;
  readonly profitBeforeTax?: number;
  readonly netProfit?: number;
  readonly principalRepayment?: number;
  readonly debtService?: number;
};

/**
 * A figure typed into the panel, read under the sign policy of the bucket a row of it would sit in.
 * The schema lets it be negative, and a repayment typed as -1,050 is a repayment of 1,050 — exactly
 * what a row in `principal-repayment` sums to, and what the workbook's `ABS` over that bucket reads.
 */
function typedAmount(bucket: RatioBucket, value: number | undefined): number | undefined {
  return value === undefined ? undefined : bucketAmount(bucket, value);
}

function resultOf(
  totals: RatioAggregateTotals,
  params: RatioParams,
  period: string,
  buckets: RatioBucketTotals,
): Result {
  const typed = params.supporting?.[period];
  const revenue = present(totals, "revenue");
  const cogs = present(totals, "cogs");
  const opex = present(totals, "opex");
  const grossProfit = revenue === undefined ? undefined : revenue - (cogs ?? 0);
  const ebit = grossProfit === undefined ? undefined : grossProfit - (opex ?? 0);
  // The supporting block under LABA BERSIH is what carries these; a typed parameter stands in only
  // when no row does, so a confirmed row always beats a number typed into the panel.
  const depreciation =
    present(totals, "depreciation") ?? typedAmount("depreciation", typed?.depreciation ?? params.depreciation);
  const interestExpense = present(totals, "interest");
  const tax = present(totals, "tax");
  const otherIncome = present(totals, "otherIncome");
  const principalRepayment =
    present(totals, "principalRepayment") ??
    typedAmount("principal-repayment", typed?.principalRepayment ?? params.principalRepayment);
  const profitBeforeTax = ebit === undefined ? undefined : ebit - (interestExpense ?? 0) + (otherIncome ?? 0);
  return {
    revenue,
    cogs,
    grossProfit,
    opex,
    ebit,
    depreciation,
    // A P&L still builds EBITDA from EBIT. A sentence that only states EBITDA ("EBITDA $80,000")
    // has no EBIT, so that stated row is the figure.
    ebitda:
      ebit === undefined ? (buckets.ebitda.count === 0 ? undefined : buckets.ebitda.value) : ebit + (depreciation ?? 0),
    interestExpense,
    tax,
    otherIncome,
    profitBeforeTax,
    netProfit: profitBeforeTax === undefined ? undefined : profitBeforeTax - (tax ?? 0),
    principalRepayment,
    debtService: sum(interestExpense, principalRepayment),
  };
}

function liquidityValues(piles: Piles): Record<string, number | null> {
  // The engine's own set: current ratio, and quick ratio as (current assets - inventory) / current
  // liabilities. Same definition, so it is reused rather than written a second time.
  const engine = ratioSet({
    currentAssets: piles.currentAssets,
    currentLiabilities: piles.currentLiabilities,
    inventory: piles.inventory,
  });
  return {
    currentRatio: engine.currentRatio,
    quickRatio: engine.quickRatio,
    cashRatio: ratio(piles.cash, piles.currentLiabilities),
    workingCapital:
      piles.currentAssets === undefined || piles.currentLiabilities === undefined
        ? null
        : piles.currentAssets - piles.currentLiabilities,
  };
}

function leverageValues(piles: Piles): Record<string, number | null> {
  const de = (debt: number | undefined) => ratioSet({ totalDebt: debt, totalEquity: piles.equity }).debtToEquity;
  return {
    debtToEquityTotal: de(piles.totalLiabilities),
    debtToEquityInterestBearing: de(piles.interestBearingDebt),
    nonCurrentDebtToEquity: de(piles.nonCurrentLiabilities),
    debtToAssets: ratio(piles.totalLiabilities, piles.totalAssets),
    equityRatio: ratio(piles.equity, piles.totalAssets),
  };
}

function coverageValues(result: Result): Record<string, number | null> {
  const dscr = (income: number | undefined) =>
    ratioSet({ netOperatingIncome: income, debtService: result.debtService }).dscr;
  return {
    interestCoverage: ratio(result.ebit, result.interestExpense),
    dscrEbitda: dscr(result.ebitda),
    dscrEbit: dscr(result.ebit),
  };
}

function performanceValues(piles: Piles, result: Result, daysPerYear: number): Record<string, number | null> {
  const inventoryTurnover = ratio(result.cogs, piles.inventory);
  const receivableShare = ratio(piles.receivables, result.revenue);
  return {
    grossMarginPct: percent(result.grossProfit, result.revenue),
    operatingMarginPct: percent(result.ebit, result.revenue),
    netMarginPct: percent(result.netProfit, result.revenue),
    returnOnAssetsPct: percent(result.netProfit, piles.totalAssets),
    returnOnEquityPct: percent(result.netProfit, piles.equity),
    assetTurnover: ratio(result.revenue, piles.totalAssets),
    inventoryTurnover,
    inventoryDays: inventoryTurnover === null || inventoryTurnover === 0 ? null : daysPerYear / inventoryTurnover,
    receivableDays: receivableShare === null ? null : receivableShare * daysPerYear,
  };
}

function balanceOf(piles: Piles): number | null {
  if (piles.totalAssets === undefined || piles.totalLiabilities === undefined || piles.equity === undefined) {
    return null;
  }
  return piles.totalAssets - piles.totalLiabilities - piles.equity;
}

function figuresFor(rows: readonly ClassifiedRatioRow[], period: string, params: RatioParams): RatioPeriodFigures {
  const buckets = bucketTotalsFor(rows, period);
  const aggregates = aggregateTotalsFrom(buckets);
  const piles = pilesOf(buckets, aggregates);
  const result = resultOf(aggregates, params, period, buckets);
  const values: Record<string, number | null> = {
    cash: piles.cash ?? null,
    receivables: piles.receivables ?? null,
    inventory: piles.inventory ?? null,
    currentAssets: piles.currentAssets ?? null,
    nonCurrentAssets: piles.nonCurrentAssets ?? null,
    totalAssets: piles.totalAssets ?? null,
    currentLiabilities: piles.currentLiabilities ?? null,
    nonCurrentLiabilities: piles.nonCurrentLiabilities ?? null,
    totalLiabilities: piles.totalLiabilities ?? null,
    totalEquity: piles.equity ?? null,
    interestBearingDebt: piles.interestBearingDebt ?? null,
    balanceCheck: balanceOf(piles),
    ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value ?? null])),
    ...liquidityValues(piles),
    ...leverageValues(piles),
    ...coverageValues(result),
    ...performanceValues(piles, result, params.daysPerYear ?? DEFAULT_DAYS_PER_YEAR),
  };
  return { period, buckets, aggregates, values };
}

export type ComputedRatios = {
  readonly rows: readonly ClassifiedRatioRow[];
  readonly periods: readonly string[];
  /** The period every headline ratio is taken from: the newest one there is. */
  readonly latest: string;
  /** The one before it, for the trend arrows. Null when the sheet carries a single period. */
  readonly prior: string | null;
  readonly byPeriod: readonly RatioPeriodFigures[];
  readonly bands: readonly RatioBandRule[];
  readonly currency: string;
  readonly daysPerYear: number;
  /** Rows nothing could place. Shown to the reader; they contribute to no total. */
  readonly unplaced: readonly ClassifiedRatioRow[];
  /** Buckets rebuilt from a printed subtotal because no row of theirs arrived. Always flagged. */
  readonly repairs: readonly RatioRepair[];
  /** Printed subtotals the rows do not add up to. Reported, never quietly adopted. */
  readonly mismatches: readonly RatioMismatch[];
};

/** Every period's figures, with the newest named as the one the scorecard reads. */
export function computeRatios(
  rows: readonly ClassifiedRatioRow[],
  params: RatioParams = {},
  bands: readonly RatioBandRule[] = DEFAULT_RATIO_BANDS,
): ComputedRatios {
  const periods = orderRatioPeriods(rows);
  const currency = rows.find((row) => (row.currency ?? "") !== "")?.currency ?? "";
  const stated = params.stated ?? [];
  // A bucket the sheet printed a subtotal for but no row of comes back as a row, not as an override:
  // the ratios below stay a sum over leaves, and the workbook's own formulas recompute the same
  // figure. What the rows and the printed subtotals still disagree about is reported, never hidden.
  const repaired = repairRatioRows(rows, stated, periods, params.locale ?? "en", currency);
  const byPeriod = periods.map((period) => figuresFor(repaired.rows, period, params));
  return {
    rows: repaired.rows,
    periods,
    latest: periods[periods.length - 1] ?? "",
    prior: periods.length >= 2 ? (periods[periods.length - 2] as string) : null,
    byPeriod,
    bands,
    currency,
    daysPerYear: params.daysPerYear ?? DEFAULT_DAYS_PER_YEAR,
    unplaced: repaired.rows.filter((row) => row.bucket === "excluded" && row.source === "unknown"),
    repairs: repaired.repairs,
    mismatches: ratioMismatches(repaired.rows, stated, periods),
  };
}

/** One period's figures by name, or null when the report asks for a period that is not there. */
export function ratioFigures(computed: ComputedRatios, period: string): RatioPeriodFigures | null {
  return computed.byPeriod.find((entry) => entry.period === period) ?? null;
}

/** One metric in one period. The single door every reader of `ComputedRatios` goes through. */
export function ratioValue(computed: ComputedRatios, key: string, period: string): number | null {
  return ratioFigures(computed, period)?.values[key] ?? null;
}

/** Every metric key this task computes, in report order. */
export function ratioMetricKeys(): readonly string[] {
  return RATIO_METRICS.map((entry) => entry.key);
}

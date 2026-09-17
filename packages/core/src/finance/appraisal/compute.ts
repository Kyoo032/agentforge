/**
 * Every appraisal figure, computed once, in code.
 *
 * This is the only place an appraisal number is made. The model is handed what comes out of here
 * and nothing else, the guard accepts nothing else back, and the workbook's live formulas restate
 * the same arithmetic over the same rows — so the screen, the memo and the spreadsheet cannot
 * disagree about a figure.
 */
import { npv } from "../engine";
import type { LineItem } from "../types";
import {
  appraisalFlowsFromItems,
  negativeYearsOf,
  netFlowsOf,
  outlayOf,
  type AppraisalYearFlow,
} from "./flows";
import { mirrPercent, scanIrr, breakevenRatePercent, type IrrScan } from "./irr-scan";
import {
  cumulative,
  cumulativeDiscounted,
  discountedFlows,
  discountedPaybackYears,
  paybackYears,
  profitabilityIndex,
} from "./series";
import {
  DEFAULT_SHIFT_PERCENTS,
  defaultRatePercents,
  negativeCells,
  npvAtRates,
  sensitivityGrid,
  type HurdleNpv,
  type SensitivityCell,
} from "./sensitivity";

export type AppraisalParams = {
  readonly discountRatePercent: number;
  readonly ratePercents?: readonly number[];
  readonly shiftPercents?: readonly number[];
  readonly financeRatePercent?: number;
  readonly reinvestRatePercent?: number;
  readonly currency?: string;
};

/** One row of the year-by-year table: the net flow and the four running totals read off it. */
export type AppraisalPeriod = {
  readonly period: string;
  readonly year: number;
  readonly net: number;
  readonly cumulative: number;
  readonly discounted: number;
  readonly cumulativeDiscounted: number;
  readonly components: AppraisalYearFlow["components"];
};

export type AppraisalComputed = {
  readonly discountRatePercent: number;
  readonly currency: string;
  readonly periods: readonly AppraisalPeriod[];
  readonly outlay: number;
  readonly npv: number | null;
  readonly irr: IrrScan;
  /** Only filled when the IRR is not unique: the honest answer in its place, with its two rates. */
  readonly mirrPercent: number | null;
  readonly financeRatePercent: number;
  readonly reinvestRatePercent: number;
  readonly paybackYears: number | null;
  readonly discountedPaybackYears: number | null;
  readonly profitabilityIndex: number | null;
  readonly breakevenRatePercent: number | null;
  readonly hurdles: readonly HurdleNpv[];
  readonly ratePercents: readonly number[];
  readonly shiftPercents: readonly number[];
  readonly sensitivity: readonly (readonly SensitivityCell[])[];
  readonly negativeCells: readonly SensitivityCell[];
  readonly negativeYears: readonly AppraisalYearFlow[];
};

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))].sort((left, right) => left - right);
}

function currencyOf(items: readonly LineItem[], fallback: string | undefined): string {
  return items.find((item) => item.currency.trim() !== "")?.currency.trim() ?? fallback?.trim() ?? "";
}

function periodsOf(flows: readonly AppraisalYearFlow[], ratePercent: number): AppraisalPeriod[] {
  const nets = netFlowsOf(flows);
  const running = cumulative(nets);
  const discounted = discountedFlows(ratePercent, nets) ?? nets.map(() => Number.NaN);
  const runningDiscounted = cumulativeDiscounted(ratePercent, nets) ?? nets.map(() => Number.NaN);
  return flows.map((flow, index) => ({
    period: flow.period,
    year: flow.year,
    net: flow.net,
    cumulative: running[index] as number,
    discounted: discounted[index] as number,
    cumulativeDiscounted: runningDiscounted[index] as number,
    components: flow.components,
  }));
}

/**
 * The confirmed rows and one discount rate to every figure the report shows.
 *
 * The IRR is scanned for uniqueness before it is reported at all; where it is not unique the scan
 * says so and `mirrPercent` carries the answer instead. Nothing here reaches a model, a file or a
 * clock.
 */
export function computeAppraisal(items: readonly LineItem[], params: AppraisalParams): AppraisalComputed {
  const flows = appraisalFlowsFromItems(items);
  const nets = netFlowsOf(flows);
  const rate = params.discountRatePercent;
  const outlay = outlayOf(flows) ?? 0;
  const value = npv(rate / 100, nets);
  const scan = scanIrr(nets);
  const ratePercents = uniqueSorted(
    params.ratePercents && params.ratePercents.length > 0 ? params.ratePercents : defaultRatePercents(rate),
  );
  const shiftPercents =
    params.shiftPercents && params.shiftPercents.length > 0
      ? [...params.shiftPercents].filter((shift) => Number.isFinite(shift))
      : [...DEFAULT_SHIFT_PERCENTS];
  const grid = sensitivityGrid(nets, { ratePercents, shiftPercents });
  const financeRatePercent = params.financeRatePercent ?? rate;
  const reinvestRatePercent = params.reinvestRatePercent ?? rate;
  return {
    discountRatePercent: rate,
    currency: currencyOf(items, params.currency),
    periods: periodsOf(flows, rate),
    outlay,
    npv: value,
    irr: scan,
    mirrPercent: scan.unique ? null : mirrPercent(nets, financeRatePercent, reinvestRatePercent),
    financeRatePercent,
    reinvestRatePercent,
    paybackYears: paybackYears(nets),
    discountedPaybackYears: discountedPaybackYears(rate, nets),
    profitabilityIndex: profitabilityIndex(value, outlay),
    breakevenRatePercent: breakevenRatePercent(nets),
    hurdles: npvAtRates(nets, uniqueSorted([...ratePercents, rate])),
    ratePercents,
    shiftPercents,
    sensitivity: grid,
    negativeCells: negativeCells(grid),
    negativeYears: negativeYearsOf(flows),
  };
}

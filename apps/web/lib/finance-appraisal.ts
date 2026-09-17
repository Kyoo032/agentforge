/**
 * The appraisal panel's own logic, kept out of the component so it can be argued with in a test.
 *
 * The studio holds one bag of state per task and knows nothing about what an appraisal asks for, so
 * everything here is a pure function from the rows on screen to the rows that should replace them.
 * Nothing mutates: every helper returns a new array, which is what `setDraft` expects.
 */
import {
  appraisalFlowsFromItems,
  computeAppraisal,
  defaultRatePercents,
  discountRateFromText,
  periodOrdinal,
  type AppraisalComputed,
  type FinanceParams,
  type LineItem,
} from "@agentforge/core/finance";

/** The appraisal's knobs ride on the shared params object; the core schema reads them by name. */
export type AppraisalParams = FinanceParams & {
  readonly rateScenarios?: readonly number[];
  readonly cashFlowShifts?: readonly number[];
};

/** One editable year: its label, its net flow, and the confirmed rows that add up to it. */
export type AppraisalYearRow = {
  readonly period: string;
  readonly year: number;
  readonly amount: number;
  readonly components: readonly { readonly label: string; readonly amount: number }[];
};

/** The rate the panel falls back to when neither the params nor the text names one. */
export const FALLBACK_RATE_PERCENT = 10;
/** The shifts the grid uses until the owner names their own. */
export const DEFAULT_SHIFTS: readonly number[] = Object.freeze([-10, 0, 10]);
/** More than this is not a plan anyone lays out by hand in a panel. */
export const MAX_YEARS = 60;

const DIGITS = /\d+\s*$/;
const LIST_SPLIT = /[,;\s]+/;

/** The confirmed rows as one editable row per year, in timeline order. */
export function appraisalYearRows(items: readonly LineItem[]): AppraisalYearRow[] {
  return appraisalFlowsFromItems(items).map((flow) => ({
    period: flow.period,
    year: flow.year,
    amount: flow.net,
    components: flow.components.map((part) => ({ label: part.label, amount: part.amount })),
  }));
}

/**
 * A year's net flow, changed.
 *
 * A year built from one row keeps that row's own name; a year built from several cannot keep all of
 * them once the reader overrides the total, so it collapses to one row under the name given. Either
 * way the components on screen go on matching the net, which is the only thing that must stay true.
 */
export function setYearAmount(
  items: readonly LineItem[],
  period: string,
  amount: number,
  netLabel: string,
): LineItem[] {
  const inYear = items.filter((item) => item.period === period);
  const single = inYear.length === 1 ? inYear[0] : null;
  const replacement: LineItem = single
    ? { ...single, amount }
    : {
        label: netLabel,
        period,
        amount,
        currency: inYear[0]?.currency ?? items[0]?.currency ?? "",
        category: periodOrdinal(period) === 0 ? "asset" : "cash",
      };
  let written = false;
  const kept = items.flatMap((item) => {
    if (item.period !== period) {
      return [item];
    }
    if (written) {
      return [];
    }
    written = true;
    return [replacement];
  });
  return written ? kept : [...kept, replacement];
}

/** "Tahun 6" and 7 → "Tahun 7". The prefix is whatever the sheet already used. */
export function nextPeriodLabel(periods: readonly string[], year: number): string {
  const last = [...periods].reverse().find((period) => DIGITS.test(period));
  const prefix = last ? last.replace(DIGITS, "") : "Year ";
  return `${prefix}${year}`;
}

/** One more year at the end, at zero, ready to be typed over. */
export function addNextYear(items: readonly LineItem[], netLabel: string): LineItem[] {
  const rows = appraisalYearRows(items);
  if (rows.length >= MAX_YEARS) {
    return [...items];
  }
  const year = rows.length === 0 ? 0 : (rows[rows.length - 1]?.year ?? rows.length - 1) + 1;
  const period = nextPeriodLabel(
    rows.map((row) => row.period),
    year,
  );
  return [
    ...items,
    { label: netLabel, period, amount: 0, currency: items[0]?.currency ?? "", category: year === 0 ? "asset" : "cash" },
  ];
}

/** One year gone, components and all. */
export function removeYear(items: readonly LineItem[], period: string): LineItem[] {
  return items.filter((item) => item.period !== period);
}

/** "10, 12, 14" → [10, 12, 14]. Anything that is not a number is dropped, not guessed at. */
export function parseNumberList(text: string): number[] {
  return text
    .split(LIST_SPLIT)
    .map((part) => part.replace("%", "").replace(",", "."))
    .filter((part) => part !== "")
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value));
}

/** The list as the box shows it back. */
export function formatNumberList(values: readonly number[]): string {
  return values.join(", ");
}

/** The rate to prefill: what the params carry, then what the request said, then the fallback. */
export function prefilledRate(params: AppraisalParams, ...texts: readonly string[]): number {
  if (typeof params.discountRatePercent === "number" && Number.isFinite(params.discountRatePercent)) {
    return params.discountRatePercent;
  }
  for (const text of texts) {
    const found = discountRateFromText(text);
    if (found !== null) {
      return found;
    }
  }
  return FALLBACK_RATE_PERCENT;
}

/** The axes the grid will actually use, so the panel shows the same ones the report will. */
export function gridAxes(params: AppraisalParams, ratePercent: number): {
  readonly ratePercents: readonly number[];
  readonly shiftPercents: readonly number[];
} {
  const rates = params.rateScenarios;
  const shifts = params.cashFlowShifts;
  return {
    ratePercents: rates && rates.length > 0 ? rates : defaultRatePercents(ratePercent),
    shiftPercents: shifts && shifts.length > 0 ? shifts : DEFAULT_SHIFTS,
  };
}

/**
 * The same figures the report will carry, computed here so the panel can show the cumulative line
 * before a single token is spent on a narrative. Null when there is nothing to appraise yet.
 */
export function appraisalPreview(items: readonly LineItem[], params: AppraisalParams, ...texts: readonly string[]): AppraisalComputed | null {
  if (items.length === 0) {
    return null;
  }
  const rate = prefilledRate(params, ...texts);
  const axes = gridAxes(params, rate);
  return computeAppraisal(items, {
    discountRatePercent: rate,
    ratePercents: axes.ratePercents,
    shiftPercents: axes.shiftPercents,
  });
}

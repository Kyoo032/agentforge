/**
 * The appraisal's display strings, and the readings of them the guard has to accept.
 *
 * The grouping, the currency prefix and the locale's own decimal mark all come from Finance's own
 * `format-number`, so an appraisal figure is written exactly the way every other Finance figure is
 * — `Rp 1.450.000.000` in Indonesian, `$820,000` in English. What is decided here is only how many
 * decimals each kind of appraisal figure deserves: a payback to a hundredth of a year, an IRR to a
 * hundredth of a point, a profitability index to a thousandth, and money to the unit.
 *
 * `magnitudeReadings` is the other half of the contract. A reader writes "Rp 139,9 miliar" for the
 * same fact the table shows as 139939434, so those readings are declared too — otherwise the guard
 * strikes out a figure that was right.
 */
import { formatCurrency, formatNumber, formatPercent as percentString, formatRatio as ratioString } from "../format-number";
import type { ReportLocale } from "../report";

/** What a figure that does not exist is shown as. It carries no digits, so no guard sees a number. */
export const NO_VALUE = "—";

export const AMOUNT_DECIMALS = 0;
export const PERCENT_DECIMALS = 2;
export const RATIO_DECIMALS = 3;
export const YEAR_DECIMALS = 2;

/** The magnitudes a currency figure is commonly spoken in: thousands, millions, billions. */
const MAGNITUDES = [1e3, 1e6, 1e9] as const;
/** Below this a figure is already spoken in full, so no shorthand reading of it exists. */
const MAGNITUDE_FLOOR = 1e4;

function missing(value: number | null): boolean {
  return value === null || !Number.isFinite(value);
}

/** A money figure, whole units, with the currency written the way that currency is written. */
export function formatAmount(value: number | null, locale: ReportLocale, currency = ""): string {
  return missing(value) ? NO_VALUE : formatCurrency(value as number, currency, locale, AMOUNT_DECIMALS);
}

/** A percentage, two decimals, with the sign the number carries. */
export function formatPercent(value: number | null, locale: ReportLocale, digits = PERCENT_DECIMALS): string {
  return missing(value) ? NO_VALUE : percentString(value as number, locale, digits);
}

/** A plain multiple, such as the profitability index. */
export function formatRatio(value: number | null, locale: ReportLocale, digits = RATIO_DECIMALS): string {
  return missing(value) ? NO_VALUE : ratioString(value as number, locale, digits);
}

/** A count of years, two decimals, so the fraction of the crossing year stays visible. */
export function formatYears(value: number | null, locale: ReportLocale, digits = YEAR_DECIMALS): string {
  return missing(value) ? NO_VALUE : formatNumber(value as number, locale, digits);
}

/**
 * The readings of one currency figure a narrative may legitimately use: the figure itself, and the
 * same figure spoken in thousands, millions or billions to one decimal. Anything else is struck out.
 */
export function magnitudeReadings(value: number): number[] {
  if (!Number.isFinite(value) || Math.abs(value) < MAGNITUDE_FLOOR) {
    return [value];
  }
  const readings = MAGNITUDES.map((magnitude) => Math.round((value / magnitude) * 10) / 10);
  return [value, ...readings.filter((reading) => Math.abs(reading) >= 1)];
}

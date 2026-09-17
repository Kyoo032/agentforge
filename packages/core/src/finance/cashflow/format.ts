/**
 * How a computed figure is written for the reader, and which readings of it the guard must accept.
 *
 * The model is never given a raw float. It is given the figure already formatted for the reader's
 * language — `1.153.300.000` in Indonesian, `1,153,300,000` in English — so the sentence it writes
 * carries the same digits the table does. `magnitudeReadings` is the other half of that bargain: a
 * writer who says "Rp 1,15 miliar" wrote the same figure, and the number guard has to know it.
 */
import type { ReportLocale } from "../report";

/** What a figure is, which decides how many decimals it keeps. */
export const CASHFLOW_UNITS = ["currency", "percent", "months", "number"] as const;
export type CashflowUnit = (typeof CASHFLOW_UNITS)[number];

const LOCALE_TAG: Readonly<Record<ReportLocale, string>> = Object.freeze({ id: "id-ID", en: "en-US" });

/** Two decimals on a ratio, a percentage or a month count; whole units on money. */
const DECIMALS: Readonly<Record<CashflowUnit, number>> = Object.freeze({
  currency: 0,
  percent: 2,
  months: 2,
  number: 2,
});

const MONTHS_WORD: Readonly<Record<ReportLocale, string>> = Object.freeze({ id: "bulan", en: "months" });

/** The word for "not available", so a missing figure is never written as a zero. */
export const CASHFLOW_MISSING: Readonly<Record<ReportLocale, string>> = Object.freeze({
  id: "tidak tersedia",
  en: "not available",
});

function grouped(value: number, locale: ReportLocale, decimals: number): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale] ?? LOCALE_TAG.en, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** One figure as the reader and the model both see it. `null` becomes words, never a number. */
export function formatCashflowValue(
  value: number | null,
  unit: CashflowUnit,
  locale: ReportLocale,
  currency = "",
): string {
  if (value === null || !Number.isFinite(value)) {
    return CASHFLOW_MISSING[locale] ?? CASHFLOW_MISSING.en;
  }
  const text = grouped(value, locale, DECIMALS[unit]);
  if (unit === "percent") {
    return `${text}%`;
  }
  if (unit === "months") {
    return `${text} ${MONTHS_WORD[locale] ?? MONTHS_WORD.en}`;
  }
  return unit === "currency" && currency ? `${currency} ${text}` : text;
}

const MAGNITUDE_DIVISORS = [1e3, 1e6, 1e9] as const;
const MAGNITUDE_MIN = 1e5;
const MAGNITUDE_DECIMALS = [1, 2] as const;

/**
 * Every reading of one figure the guard should let through: the figure itself, the same money written
 * the other way round (a burn of 8.38m and a net of -8.38m are one movement), and the magnitudes a
 * writer reaches for — "1,15 miliar", "92,0 juta", "$1.49M".
 */
export function magnitudeReadings(value: number): number[] {
  if (!Number.isFinite(value)) {
    return [];
  }
  const signs = value === 0 ? [0] : [value, -value];
  const scaled = Math.abs(value) < MAGNITUDE_MIN ? [] : MAGNITUDE_DIVISORS.flatMap((divisor) => {
    const base = value / divisor;
    return Math.abs(base) < 0.5 ? [] : MAGNITUDE_DECIMALS.flatMap((places) => {
      const rounded = Number(base.toFixed(places));
      return [rounded, -rounded];
    });
  });
  return [...new Set([...signs, ...scaled])];
}

/** Every reading of every figure, de-duplicated — what `allowedNumbers` hands the guard. */
export function allowedReadings(values: readonly (number | null)[]): number[] {
  return [
    ...new Set(
      values.flatMap((value) => (value === null ? [] : magnitudeReadings(value))).filter((value) => Number.isFinite(value)),
    ),
  ];
}

/**
 * How a budget figure is written for the reader — the shared formatter, with the two answers this
 * task needs that a general one cannot give.
 *
 * The grouping, the currency prefix and the magnitude words all come from `../format-number`, so a
 * rupiah is written here the way the workbook, the deck and every other Finance task write it. What
 * is added on top is small and specific: an amount is shown to the cent only when it actually has
 * one, and a percentage that does not exist is written out in words. An unbudgeted line has no
 * percent at all, and "0 %" would be a different — and wrong — statement about it.
 */
import { formatCompactCurrency, formatCurrency, formatPercent } from "../format-number";
import type { ReportLocale } from "../report";

/** Decimals a percentage is shown to. The guard's tolerance is wider than this, on purpose. */
export const BUDGET_PERCENT_DECIMALS = 1;
/** Decimals in the short reading a chart caption uses. */
const MAGNITUDE_DECIMALS = 1;
/** What a figure that is not a number at all reads as. */
const NOT_A_NUMBER = "—";

const NO_PERCENT: Readonly<Record<ReportLocale, string>> = Object.freeze({
  id: "tidak terdefinisi",
  en: "not defined",
});

/** "Rp 207.500.000" / "-$2,000". Whole units unless the figure itself carries cents. */
export function formatBudgetAmount(value: number, locale: ReportLocale, currency: string): string {
  if (!Number.isFinite(value)) {
    return NOT_A_NUMBER;
  }
  return formatCurrency(value, currency, locale, Number.isInteger(value) ? 0 : 2);
}

/** "10,0%" / "-11.2%". A percent that does not exist is written out, never as 0 %. */
export function formatBudgetPercent(value: number | null, locale: ReportLocale): string {
  if (value === null || !Number.isFinite(value)) {
    return NO_PERCENT[locale] ?? NO_PERCENT.en;
  }
  return formatPercent(value, locale, BUDGET_PERCENT_DECIMALS);
}

/** "Rp 207,5 juta" / "-$2.0K" — the short reading, for a chart caption rather than a figure. */
export function formatBudgetMagnitude(value: number, locale: ReportLocale, currency: string): string {
  return Number.isFinite(value) ? formatCompactCurrency(value, currency, locale, MAGNITUDE_DECIMALS) : NOT_A_NUMBER;
}

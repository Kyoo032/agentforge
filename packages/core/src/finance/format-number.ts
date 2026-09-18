/**
 * Figures written the way the reader writes them.
 *
 * A brief that says "the 2024 revenue was 9775000000" and "the margin was 44.1739%" is a brief the
 * owner has to reformat by hand before sending it on. Worse, a model asked to write a number it has
 * only seen as `9775000000` will write it that way, or round it somewhere of its own choosing — so
 * the prompt is given the finished string and told to copy it, and these are the functions that make
 * it. The grouped form is the one the prompt uses: it is exact, and the number guard verifies it
 * without any special case.
 */
import type { AppLocale } from "../locale";

/** Marks each locale writes a thousands group and a decimal point with. */
const MARKS: Record<AppLocale, { group: string; decimal: string }> = {
  en: { group: ",", decimal: "." },
  id: { group: ".", decimal: "," },
};

/** Magnitude words, largest first, for the short form a headline wants. */
const SCALES: Record<AppLocale, ReadonlyArray<readonly [number, string]>> = {
  en: [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ],
  id: [
    [1e12, "triliun"],
    [1e9, "miliar"],
    [1e6, "juta"],
    [1e3, "ribu"],
  ],
};

/** Currencies written in front of the figure, and how. */
const CURRENCY_PREFIX: Record<string, string> = { IDR: "Rp ", USD: "$", EUR: "€", GBP: "£", JPY: "¥" };

export const DEFAULT_PERCENT_DECIMALS = 1;
export const DEFAULT_COMPACT_DECIMALS = 2;

function group(digits: string, mark: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, mark);
}

/** `1250000000` → `1.250.000.000` (id) / `1,250,000,000` (en). Decimals use the locale's own mark. */
export function formatNumber(value: number, locale: AppLocale, decimals = 0): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  const marks = MARKS[locale] ?? MARKS.en;
  const fixed = Math.abs(value).toFixed(Math.max(0, decimals));
  const [whole = "0", fraction] = fixed.split(".");
  const sign = value < 0 ? "-" : "";
  const body = fraction ? `${group(whole, marks.group)}${marks.decimal}${fraction}` : group(whole, marks.group);
  return `${sign}${body}`;
}

function withCurrency(text: string, currency: string): string {
  const prefix = CURRENCY_PREFIX[currency.toUpperCase()];
  if (prefix) {
    return text.startsWith("-") ? `-${prefix}${text.slice(1)}` : `${prefix}${text}`;
  }
  return currency ? `${currency} ${text}` : text;
}

/** `Rp 1.250.000.000` / `$1,250,000,000`. The exact form; nothing is rounded away. */
export function formatCurrency(value: number, currency: string, locale: AppLocale, decimals = 0): string {
  return withCurrency(formatNumber(value, locale, decimals), currency);
}

/** `Rp 1,25 miliar` / `$1.25M`. For a headline, never for a figure the reader may need exactly. */
export function formatCompactCurrency(
  value: number,
  currency: string,
  locale: AppLocale,
  decimals = DEFAULT_COMPACT_DECIMALS,
): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  const scale = (SCALES[locale] ?? SCALES.en).find(([size]) => Math.abs(value) >= size);
  if (!scale) {
    return formatCurrency(value, currency, locale);
  }
  const [size, word] = scale;
  const short = formatNumber(value / size, locale, decimals);
  const spaced = locale === "id" ? ` ${word}` : word;
  return `${withCurrency(short, currency)}${spaced}`;
}

/** `41,6%` / `41.6%`. One decimal by default — a brief never needs four. */
export function formatPercent(value: number, locale: AppLocale, decimals = DEFAULT_PERCENT_DECIMALS): string {
  return Number.isFinite(value) ? `${formatNumber(value, locale, decimals)}%` : "";
}

/** `1,84x` / `1,84 kali` — a ratio reads as a multiple, not as money. */
export function formatRatio(value: number, locale: AppLocale, decimals = DEFAULT_COMPACT_DECIMALS): string {
  return Number.isFinite(value) ? `${formatNumber(value, locale, decimals)}x` : "";
}

const MONTHS_WORD: Record<AppLocale, string> = { en: "months", id: "bulan" };

/** `7,8 bulan` / `7.8 months`. */
export function formatMonths(value: number, locale: AppLocale, decimals = DEFAULT_PERCENT_DECIMALS): string {
  return Number.isFinite(value) ? `${formatNumber(value, locale, decimals)} ${MONTHS_WORD[locale]}` : "";
}

export type FormattableMetric = { readonly value: number | null; readonly unit: string };

const MISSING: Record<AppLocale, string> = { en: "missing", id: "tidak tersedia" };

/**
 * One metric as the reader should see it, chosen by its unit. This is the string the prompt hands the
 * model and asks it to copy, so every number in the finished prose is one this file wrote.
 */
export function formatMetricValue(metric: FormattableMetric, locale: AppLocale): string {
  if (metric.value === null || !Number.isFinite(metric.value)) {
    return MISSING[locale] ?? MISSING.en;
  }
  if (metric.unit === "%") {
    return formatPercent(metric.value, locale);
  }
  if (metric.unit === "x") {
    return formatRatio(metric.value, locale);
  }
  if (metric.unit === "months") {
    return formatMonths(metric.value, locale);
  }
  if (metric.unit === "") {
    return formatNumber(metric.value, locale, Number.isInteger(metric.value) ? 0 : DEFAULT_PERCENT_DECIMALS);
  }
  return formatCurrency(
    metric.value,
    metric.unit,
    locale,
    Number.isInteger(metric.value) ? 0 : DEFAULT_COMPACT_DECIMALS,
  );
}

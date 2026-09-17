/**
 * How a ratio figure is written for a reader, and which readings of it the guard must accept back.
 *
 * Indonesian groups with dots and divides with a comma; English does the opposite. Get that wrong
 * and `1.6009` reads as sixteen thousand to half the audience. So every figure the model is shown
 * arrives already written in the reader's language, and every figure the model may write back is
 * declared here — including the magnitude readings, because a person who is told
 * `Rp 12.607.000.000` will quite reasonably write `Rp 12,6 miliar`, and a guard that has not been
 * told that strips a figure that was perfectly true.
 */
import type { ReportLocale } from "../report";
import type { RatioUnit } from "./keys";

const DECIMALS: Readonly<Record<RatioUnit, number>> = Object.freeze({
  currency: 0,
  ratio: 2,
  percent: 2,
  days: 1,
});

const LOCALE_TAG: Readonly<Record<ReportLocale, string>> = Object.freeze({ id: "id-ID", en: "en-US" });

/** What a reader writes instead of the ISO code. Anything unlisted keeps its code. */
const CURRENCY_SYMBOL: Readonly<Record<string, string>> = Object.freeze({ IDR: "Rp", USD: "$", EUR: "€", GBP: "£" });

/** Magnitude words, largest first. The Indonesian ones are words; the English ones are suffixes. */
const MAGNITUDES: Readonly<Record<ReportLocale, readonly (readonly [number, string])[]>> = Object.freeze({
  id: Object.freeze([
    [1e12, "triliun"],
    [1e9, "miliar"],
    [1e6, "juta"],
    [1e3, "ribu"],
  ] as const),
  en: Object.freeze([
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const),
});

function decimalsFor(unit: RatioUnit): number {
  return DECIMALS[unit] ?? 2;
}

function plain(value: number, locale: ReportLocale, decimals: number): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale] ?? LOCALE_TAG.en, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** The unit token beside a value in a table: `x`, `%`, the currency code, or the word for days. */
export function ratioUnitToken(unit: RatioUnit, locale: ReportLocale, currency = ""): string {
  if (unit === "percent") {
    return "%";
  }
  if (unit === "ratio") {
    return "x";
  }
  return unit === "days" ? (locale === "id" ? "hari" : "days") : currency;
}

export function currencyPrefix(currency: string): string {
  return CURRENCY_SYMBOL[currency.toUpperCase()] ?? currency;
}

/** One figure as the reader sees it: `Rp 12.607.000.000`, `1,60x`, `29,01%`, `71,9 hari`. */
export function formatRatioValue(
  value: number | null,
  unit: RatioUnit,
  locale: ReportLocale,
  currency = "",
): string {
  if (value === null || !Number.isFinite(value)) {
    return locale === "id" ? "tidak tersedia" : "not available";
  }
  const written = plain(value, locale, decimalsFor(unit));
  if (unit === "percent") {
    return `${written}%`;
  }
  if (unit === "ratio") {
    return `${written}x`;
  }
  if (unit === "days") {
    return `${written} ${locale === "id" ? "hari" : "days"}`;
  }
  const prefix = currencyPrefix(currency);
  return prefix === "" ? written : `${prefix} ${written}`;
}

/** The same figure in round numbers: `Rp 12,61 miliar`, `$12.61B`. Empty below the first magnitude. */
export function formatRatioMagnitude(value: number | null, locale: ReportLocale, currency = ""): string {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }
  const scale = (MAGNITUDES[locale] ?? MAGNITUDES.en).find(([size]) => Math.abs(value) >= size);
  if (!scale) {
    return "";
  }
  const [size, word] = scale;
  const written = plain(value / size, locale, 2);
  const prefix = currencyPrefix(currency);
  const body = locale === "id" ? `${written} ${word}` : `${written}${word}`;
  return prefix === "" ? body : `${prefix} ${body}`;
}

/** Below this a magnitude reading is not worth declaring: nobody writes "0,12 ribu". */
const MAGNITUDE_FLOOR = 1e3;
const MAGNITUDE_DECIMALS = 2;

/**
 * Every reading of one figure the guard should accept: the figure itself, and the same figure in
 * each magnitude a reader might round it to. `12_607_000_000` also answers to `12.607` and `12,61`.
 */
export function ratioAllowedReadings(value: number | null, unit: RatioUnit): readonly number[] {
  if (value === null || !Number.isFinite(value)) {
    return [];
  }
  const rounded = Number(value.toFixed(MAGNITUDE_DECIMALS));
  if (unit !== "currency" || Math.abs(value) < MAGNITUDE_FLOOR) {
    return [value, rounded];
  }
  const scaled = MAGNITUDES.en
    .filter(([size]) => Math.abs(value) >= size)
    .map(([size]) => Number((value / size).toFixed(MAGNITUDE_DECIMALS)));
  return [value, rounded, ...scaled];
}

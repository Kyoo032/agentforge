/**
 * Period labels as calendar months, without a clock.
 *
 * "Des 2024", "Desember 2024", "Dec 2024" and "2024-12" are the same month written four ways, and the
 * one question a runway answer turns on — *which month does the till empty?* — cannot be asked until
 * they are. Nothing here reads `Date.now()`: a month is a year and a 1-based index, and the arithmetic
 * is integer division, so the same book always names the same month.
 */
import type { ReportLocale } from "../report";

export type CalendarMonth = { readonly year: number; readonly month: number };

const MONTHS_IN_YEAR = 12;

/** Month names by locale, full form first — the form a reader recognises in a sentence. */
const MONTH_NAMES: Readonly<Record<ReportLocale, readonly string[]>> = Object.freeze({
  id: Object.freeze([
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ]),
  en: Object.freeze([
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]),
});

/** Every spelling a month may arrive under, lowercased, mapped to its 1-based index. */
const MONTH_INDEX: ReadonlyMap<string, number> = new Map(
  [
    ...MONTH_NAMES.id.flatMap((name, at) => [
      [name.toLowerCase(), at + 1] as const,
      [name.toLowerCase().slice(0, 3), at + 1] as const,
    ]),
    ...MONTH_NAMES.en.flatMap((name, at) => [
      [name.toLowerCase(), at + 1] as const,
      [name.toLowerCase().slice(0, 3), at + 1] as const,
    ]),
    // The two Indonesian abbreviations that are not the first three letters of the full name.
    ["agu", 8] as const,
    ["agt", 8] as const,
    ["okt", 10] as const,
    ["des", 12] as const,
    ["sept", 9] as const,
  ].map(([name, index]) => [name, index] as const),
);

const ISO_MONTH = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/;
const NAMED_MONTH = /^([A-Za-zÀ-ɏ]+)[\s./-]+(\d{4})$/;
const MONTH_FIRST_NUMERIC = /^(\d{1,2})[/-](\d{4})$/;

function fromParts(year: number, month: number): CalendarMonth | null {
  return month >= 1 && month <= MONTHS_IN_YEAR && year >= 1000 && year <= 9999 ? { year, month } : null;
}

/** "Des 2024" / "2024-12" / "12/2024" as a calendar month, or null when the label names no month. */
export function parseCalendarMonth(label: string): CalendarMonth | null {
  const text = label.trim();
  const iso = ISO_MONTH.exec(text);
  if (iso) {
    return fromParts(Number(iso[1]), Number(iso[2]));
  }
  const named = NAMED_MONTH.exec(text);
  if (named) {
    const index = MONTH_INDEX.get((named[1] ?? "").toLowerCase());
    return index === undefined ? null : fromParts(Number(named[2]), index);
  }
  const numeric = MONTH_FIRST_NUMERIC.exec(text);
  return numeric ? fromParts(Number(numeric[2]), Number(numeric[1])) : null;
}

/** `count` months on from this one. Negative counts walk backwards. */
export function addCalendarMonths(month: CalendarMonth, count: number): CalendarMonth {
  const zeroBased = month.year * MONTHS_IN_YEAR + (month.month - 1) + Math.trunc(count);
  return { year: Math.floor(zeroBased / MONTHS_IN_YEAR), month: (zeroBased % MONTHS_IN_YEAR) + 1 };
}

/** "September 2025" — the full month name in the reader's language, which is what a sentence needs. */
export function formatCalendarMonth(month: CalendarMonth, locale: ReportLocale): string {
  const names = MONTH_NAMES[locale] ?? MONTH_NAMES.en;
  return `${names[month.month - 1] ?? month.month} ${month.year}`;
}

/**
 * The month a balance runs out, counted forward from the last period in the book.
 *
 * `months` is a fraction — 8.28 months of runway means the till survives the eighth month and empties
 * during the ninth — so the count is rounded *up*. A null runway (no burn) has no such month.
 */
export function monthCashRunsOut(
  lastPeriod: string,
  months: number | null,
  locale: ReportLocale,
): { readonly label: string; readonly monthsAhead: number } | null {
  const start = parseCalendarMonth(lastPeriod);
  if (start === null || months === null || !Number.isFinite(months) || months < 0) {
    return null;
  }
  const monthsAhead = Math.max(1, Math.ceil(months));
  return { label: formatCalendarMonth(addCalendarMonths(start, monthsAhead), locale), monthsAhead };
}

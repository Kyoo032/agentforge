/**
 * Reading a period label well enough to roll quarters and months up into their year.
 *
 * A brief over eight quarters is asked "how did 2024 compare with 2023?", and the answer is not in any
 * one column. Nothing here guesses a calendar: a label only joins a year when it actually names one,
 * and a year only becomes an aggregate when it holds more than one sub-period — so a sheet that is
 * already annual never grows a second, identical "FY2024" beside its own "2024".
 */

const YEAR = /\b(19|20)\d{2}\b/;
const QUARTER = /\bq([1-4])\b|\btw([1-4])\b|\btriwulan\s*([1-4])\b/i;
/** A half year: "H1 2024", or the Indonesian "Semester 2 2024". */
const HALF = /\bh[12]\b|\bsemester\s*[12]\b/i;
/**
 * A fiscal year: "FY2024", "FY24", "FY'24", "FY2024/25". `YEAR` cannot see the first of these —
 * there is no word boundary between the Y and the 2 — so it is named on its own.
 */
const FISCAL_YEAR = /\bfy\s*'?(?:(?:19|20)\d{2}|\d{2})\b/i;
const MONTHS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bjan/i, 1],
  [/\bfeb/i, 2],
  [/\bmar/i, 3],
  [/\bapr/i, 4],
  [/\bmay\b|\bmei\b/i, 5],
  [/\bjun/i, 6],
  [/\bjul/i, 7],
  [/\baug|\bagu/i, 8],
  [/\bsep/i, 9],
  [/\boct|\bokt/i, 10],
  [/\bnov/i, 11],
  [/\bdec|\bdes/i, 12],
];

export type PeriodParts = {
  readonly year: number | null;
  readonly quarter: number | null;
  readonly month: number | null;
};

/** The year, quarter and month a period label names. Anything it does not say stays null. */
export function parsePeriod(period: string): PeriodParts {
  const year = YEAR.exec(period);
  const quarter = QUARTER.exec(period);
  const month = MONTHS.find(([pattern]) => pattern.test(period))?.[1] ?? null;
  const quarterNumber = quarter ? Number(quarter[1] ?? quarter[2] ?? quarter[3]) : null;
  return {
    year: year ? Number(year[0]) : null,
    quarter: Number.isFinite(quarterNumber) ? quarterNumber : null,
    month,
  };
}

/** True when the label names a slice of a year rather than the whole of it. */
export function isSubYearPeriod(period: string): boolean {
  const parts = parsePeriod(period);
  return parts.year !== null && (parts.quarter !== null || parts.month !== null);
}

export const FISCAL_YEAR_PREFIX = "FY";

export type FiscalYearGroup = { readonly label: string; readonly periods: readonly string[] };

/**
 * Quarters and months grouped into their fiscal years, in the order the periods first appear. A year
 * with only one sub-period is left alone: rolling it up would restate the same column twice.
 */
export function fiscalYearGroups(periods: readonly string[]): FiscalYearGroup[] {
  const order: number[] = [];
  const byYear = new Map<number, string[]>();
  for (const period of periods) {
    if (!isSubYearPeriod(period)) {
      continue;
    }
    const year = parsePeriod(period).year as number;
    const existing = byYear.get(year);
    if (existing) {
      existing.push(period);
    } else {
      order.push(year);
      byYear.set(year, [period]);
    }
  }
  return order
    .map((year) => ({ label: `${FISCAL_YEAR_PREFIX}${year}`, periods: byYear.get(year) ?? [] }))
    .filter((group) => group.periods.length > 1);
}

/**
 * How many months a period covers, for turning a per-period burn into a per-month one.
 *
 * The finest unit the label names wins — a month, then a quarter, then a half, then a year — so
 * "Q1 FY2024" is three months and "Mar FY24" one. A label naming none of them is one month.
 */
export function monthsInPeriod(period: string): number {
  const parts = parsePeriod(period);
  if (parts.month !== null) {
    return 1;
  }
  if (parts.quarter !== null) {
    return 3;
  }
  if (HALF.test(period)) {
    return 6;
  }
  return parts.year !== null || FISCAL_YEAR.test(period) ? 12 : 1;
}

/** How many months a whole fiscal-year group covers. */
export function monthsInGroup(group: FiscalYearGroup): number {
  return group.periods.reduce((total, period) => total + monthsInPeriod(period), 0);
}

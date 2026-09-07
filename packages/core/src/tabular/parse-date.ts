/**
 * Date recognition for the formats the profiler accepts, normalised to ISO `YYYY-MM-DD`.
 *
 * - `YYYY-MM-DD` with an optional time part (`T10:20`, ` 10:20:30Z`, `+07:00`)
 * - `YYYY/MM/DD`
 * - `DD/MM/YYYY` or `MM/DD/YYYY`: when both parts fit either slot the value is read as day-first
 *   (the gateway's home market writes dates that way); a first part above 12 forces day-first and
 *   a second part above 12 forces month-first.
 * - `D Mon YYYY`, `D Month YYYY`, `Mon D, YYYY`, `Month D YYYY`
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const YMD_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const DMY_SLASH = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const D_MON_Y = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/;
const MON_D_Y = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MAX_MONTH = 12;

type DateParts = { year: number; month: number; day: number };

function monthFromName(name: string): number | null {
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return index === -1 ? null : index + 1;
}

function dayMonthFromSlashes(first: number, second: number): DateParts | null {
  if (first > MAX_MONTH && second > MAX_MONTH) {
    return null;
  }
  const monthFirst = second > MAX_MONTH;
  return monthFirst ? { year: 0, month: first, day: second } : { year: 0, month: second, day: first };
}

function dateParts(text: string): DateParts | null {
  const iso = ISO.exec(text) ?? YMD_SLASH.exec(text);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }
  const dmy = DMY_SLASH.exec(text);
  if (dmy) {
    const parts = dayMonthFromSlashes(Number(dmy[1]), Number(dmy[2]));
    return parts ? { ...parts, year: Number(dmy[3]) } : null;
  }
  const dayFirst = D_MON_Y.exec(text);
  if (dayFirst) {
    const month = monthFromName(dayFirst[2] as string);
    return month ? { year: Number(dayFirst[3]), month, day: Number(dayFirst[1]) } : null;
  }
  const monthFirst = MON_D_Y.exec(text);
  if (monthFirst) {
    const month = monthFromName(monthFirst[1] as string);
    return month ? { year: Number(monthFirst[3]), month, day: Number(monthFirst[2]) } : null;
  }
  return null;
}

function isCalendarDate({ year, month, day }: DateParts): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function formatIso({ year, month, day }: DateParts): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
}

/** Returns the ISO `YYYY-MM-DD` form of a recognised date, or null. */
export function parseDate(raw: string): string | null {
  const parts = dateParts(raw.trim());
  return parts && isCalendarDate(parts) ? formatIso(parts) : null;
}

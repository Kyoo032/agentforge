/**
 * Ordinal period headers, read as the positions they are.
 *
 * An appraisal's periods are not dates. "Tahun 0" and "Year 10" say where on the timeline a flow
 * sits, and that position is the whole of the discounting — get the order wrong and every number
 * downstream is wrong. The importer's `isPeriodLabel` wants a 19xx/20xx year, so nothing upstream
 * turns these headers into ordinals; this does, in both languages, and answers null rather than
 * guessing when a label carries no ordinal at all.
 */

/** The words a sheet puts in front of (or behind) the number: id first, then en. */
const ORDINAL_WORD = "tahun|thn|th|year|yr|periode|period";

/** "Tahun 0", "Year 10", "Periode 3", "Tahun ke-2". */
const PREFIXED = new RegExp(`^(?:${ORDINAL_WORD})\\s*(?:ke\\s*-?\\s*)?(\\d{1,3})$`, "i");
/** "0 tahun", "2nd year". */
const SUFFIXED = new RegExp(`^(\\d{1,3})(?:st|nd|rd|th)?\\s*(?:${ORDINAL_WORD})$`, "i");
/**
 * A bare "0" … "999". Four digits are deliberately excluded: "2024" is a calendar year, and reading
 * it as the two-thousand-and-twenty-fourth period of the project would discount it into nothing.
 */
const BARE = /^(\d{1,3})$/;

/** The longest horizon this task will lay out. A sheet claiming more is a parse mistake, not a plan. */
export const APPRAISAL_MAX_PERIODS = 120;

/** The ordinal a period label carries ("Tahun 0" → 0, "Year 10" → 10), or null when it carries none. */
export function periodOrdinal(period: string): number | null {
  const text = period.trim().replace(/\s+/g, " ");
  const match = PREFIXED.exec(text) ?? SUFFIXED.exec(text) ?? BARE.exec(text);
  if (!match?.[1]) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) && value >= 0 && value < APPRAISAL_MAX_PERIODS ? value : null;
}

/** True when every label in the list carries an ordinal, which is when ordering by one is safe. */
export function allPeriodsOrdinal(periods: readonly string[]): boolean {
  return periods.length > 0 && periods.every((period) => periodOrdinal(period) !== null);
}

/**
 * Number guard: every figure in model prose must trace back to an input figure
 * or a computed metric. Anything else is flagged and replaced before it reaches
 * the preview or the DOCX. "Never invent numbers" enforced, not promised.
 */

export const GUARD_RELATIVE_TOLERANCE = 0.005;
/** Half a display unit: one decimal for small figures (ratios, percentages), whole units above 100. */
export const GUARD_ABSOLUTE_TOLERANCE = 0.5;
export const GUARD_SMALL_ABSOLUTE_TOLERANCE = 0.0500001;
const SMALL_FIGURE_MAX = 100;
export const UNVERIFIED_MARKER = "[unverified figure]";

/** Small counts and calendar values are not "figures": "3 scenarios", "12 months", "2026". */
const FREE_INTEGER_MAX = 12;
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

const NUMBER_TOKEN =
  /(?<![\w.])[-+]?(?:\$|€|£|Rp\s?)?(\d{1,3}(?:[,.\s]\d{3})+|\d+)(?:[.,]\d+)?\s?(%|percent|k|m|bn|million|billion|thousand|x)?(?![\w])/gi;

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  bn: 1e9,
  billion: 1e9,
};

export type NumberToken = { text: string; value: number; unit: "%" | "x" | ""; index: number };

const GROUPS_ONLY = /^[-+]?\d{1,3}(?:[.,]\d{3})+$/;

/** 1,250,000 and 12.000 are groups; 1,234.56 and 1.234,56 end in a decimal; 12.5 is a decimal. */
function parseGroupedNumber(raw: string): number {
  const cleaned = raw.replace(/[\s$€£]|Rp/g, "");
  if (GROUPS_ONLY.test(cleaned)) {
    return Number(cleaned.replace(/[.,]/g, ""));
  }
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  return Number(cleaned.replace(/,/g, ""));
}

/** Every numeric token in the text with its normalized value. */
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g;

/** Dates are not figures: blank them at equal length so token indexes still point into the original text. */
function maskDates(text: string): string {
  return text.replace(ISO_DATE, (date) => " ".repeat(date.length));
}

export function extractNumbers(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const match of maskDates(text).matchAll(NUMBER_TOKEN)) {
    const whole = match[0];
    const suffix = (match[2] ?? "").toLowerCase();
    const numericPart = whole.replace(/\s?(%|percent|k|m|bn|million|billion|thousand|x)$/i, "");
    const base = parseGroupedNumber(numericPart);
    if (!Number.isFinite(base)) {
      continue;
    }
    const unit: NumberToken["unit"] = suffix === "%" || suffix === "percent" ? "%" : suffix === "x" ? "x" : "";
    const value = unit === "" && SCALE[suffix] ? base * SCALE[suffix] : base;
    out.push({ text: whole.trim(), value, unit, index: match.index ?? 0 });
  }
  return out;
}

export function isFreeNumber(token: NumberToken): boolean {
  const integer = Number.isInteger(token.value);
  if (token.unit === "" && integer && Math.abs(token.value) <= FREE_INTEGER_MAX) {
    return true;
  }
  return token.unit === "" && integer && token.value >= YEAR_MIN && token.value <= YEAR_MAX;
}

export function matchesAllowed(value: number, allowed: readonly number[]): boolean {
  return allowed.some((candidate) => {
    const absolute = Math.abs(candidate) < SMALL_FIGURE_MAX ? GUARD_SMALL_ABSOLUTE_TOLERANCE : GUARD_ABSOLUTE_TOLERANCE;
    const tolerance = Math.max(absolute, Math.abs(candidate) * GUARD_RELATIVE_TOLERANCE);
    return Math.abs(candidate - value) <= tolerance;
  });
}

export type GuardResult = {
  /** Prose with unverified figures replaced by the marker. */
  text: string;
  flagged: NumberToken[];
  verified: NumberToken[];
};

/**
 * Check prose against the allowed figures (inputs + computed metrics, in their natural units;
 * percentages as percent numbers). Unmatched figures are replaced in the returned text.
 */
export function guardNumbers(text: string, allowed: readonly number[]): GuardResult {
  const tokens = extractNumbers(text);
  const flagged = tokens.filter((token) => !isFreeNumber(token) && !matchesAllowed(token.value, allowed));
  const verified = tokens.filter((token) => !flagged.includes(token));
  const cleaned = [...flagged]
    .sort((a, b) => b.index - a.index)
    .reduce(
      (out, token) => `${out.slice(0, token.index)}${UNVERIFIED_MARKER}${out.slice(token.index + token.text.length)}`,
      text,
    );
  return { text: cleaned, flagged, verified };
}

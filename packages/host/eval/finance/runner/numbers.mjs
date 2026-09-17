/**
 * Reading figures back out of prose and markdown, in the two number cultures the
 * product ships in.
 *
 * Nothing here re-implements the parsing the product already does: the magnitude
 * words ("1,25 miliar", "$1.2M") are expanded with the engine's own
 * `expandMagnitudes`, and the tokens are read with the number guard's own
 * `extractNumbers`, so the harness can never disagree with the guard about what a
 * figure is worth. This module adds only what a *scorer* needs on top: accounting
 * parentheses, and a unit hint taken from the words around the number.
 */
import { expandMagnitudes, extractNumbers, isFreeNumber, matchesAllowed } from "./ts-bridge.mjs";

/** Unit classes a truth figure may declare, plus the "no idea" fallback. */
export const UNIT_KINDS = ["currency", "percent", "ratio", "months", "years", "count", "number"];

/** How far either side of a token the unit words are looked for. */
const CONTEXT_CHARS = 16;

const CURRENCY_BEFORE = /(?:rp|idr|usd|us\$|eur|gbp|sgd|jpy|[$€£¥])\s*$/i;
/** The guard's own token keeps a leading `Rp`/`$`, so the mark can sit inside the match. */
const CURRENCY_INSIDE = /^[-+]?\s*(?:rp|idr|[$€£¥])/i;
const CURRENCY_AFTER = /^\s*(?:idr|usd|eur|gbp|sgd|jpy|rupiah|dollars?)\b/i;
const PERCENT_AFTER = /^\s*(?:%|percent|persen|pct)\b/i;
const MONTHS_AFTER = /^\s*(?:months?|bulan|mo)\b/i;
const YEARS_AFTER = /^\s*(?:years?|tahun|yrs?)\b/i;
const RATIO_AFTER = /^\s*(?:x|kali|times)\b/i;
const RATIO_BEFORE = /(?:ratio|rasio)\s*(?:of|:)?\s*$/i;
const COUNT_AFTER =
  /^\s*(?:outlets?|stores?|branches?|cabang|gerai|employees?|staff|karyawan|units?|unit|customers?|pelanggan|users?)\b/i;

/**
 * Accounting negatives: "(1.200)" is minus 1 200. Only a parenthesis whose whole
 * content reads as one money-ish figure is rewritten — "(2024)" stays a year and
 * "(see note 3)" stays prose.
 */
const PARENTHESISED = /\(([^()]{1,40})\)/g;
const MONEY_INNER = /^\s*(?:rp|idr|usd|us\$|eur|gbp|sgd|jpy|[$€£¥])?\s*[\d][\d.,\s]*\s*(?:%|persen|percent)?\s*$/i;
const BARE_YEAR = /^\s*(?:19|20)\d{2}\s*$/;

export function normaliseAccountingNegatives(text) {
  return text.replace(PARENTHESISED, (whole, inner) => {
    if (!MONEY_INNER.test(inner) || BARE_YEAR.test(inner)) {
      return whole;
    }
    // Same width is not required here — indexes are taken from the rewritten text.
    return `-${inner.trim()}`;
  });
}

function unitFromContext(text, token) {
  const before = text.slice(Math.max(0, token.index - CONTEXT_CHARS), token.index);
  const after = text.slice(token.index + token.text.length, token.index + token.text.length + CONTEXT_CHARS);
  if (token.unit === "%" || PERCENT_AFTER.test(after)) {
    return "percent";
  }
  // A currency mark on the figure itself outranks a word after it: "Rp 1.250.000
  // tahun ini" is money in a sentence about a year, not a count of years.
  if (CURRENCY_INSIDE.test(token.text) || CURRENCY_BEFORE.test(before)) {
    return "currency";
  }
  if (MONTHS_AFTER.test(after)) {
    return "months";
  }
  if (YEARS_AFTER.test(after)) {
    return "years";
  }
  if (token.unit === "x" || RATIO_AFTER.test(after) || RATIO_BEFORE.test(before)) {
    return "ratio";
  }
  if (CURRENCY_AFTER.test(after)) {
    return "currency";
  }
  if (COUNT_AFTER.test(after)) {
    return "count";
  }
  return "number";
}

/**
 * Every figure in `text`, normalised.
 *
 * `locale` decides which mark groups and which divides, exactly as the host's own
 * run locale does. A token whose reading is genuinely ambiguous keeps the other
 * reading on `alternate`, and so does a magnitude word read under the other
 * locale ("2.35 juta" is 2 350 000 in en and 235 000 000 in id) — a scorer that
 * accepts either is refusing to fail the app over a comma.
 */
export function extractFigures(text, locale = "en") {
  if (typeof text !== "string" || text.trim() === "") {
    return [];
  }
  const signed = normaliseAccountingNegatives(text);
  const primary = expandMagnitudes(signed, locale === "id" ? "id" : "en");
  const other = expandMagnitudes(signed, locale === "id" ? "en" : "id");
  const tokens = extractNumbers(primary);
  const otherTokens = other === primary ? [] : extractNumbers(other);
  // Positional only when the two readings found the same figures; a different
  // count means the mapping is guesswork, and a guessed alternate is worse than none.
  const alternates = otherTokens.length === tokens.length ? otherTokens.map((token) => token.value) : [];
  return tokens.map((token, at) => ({
    text: token.text,
    value: token.value,
    alternate: token.alternate ?? alternates[at],
    unit: unitFromContext(primary, token),
    /** The guard's own unit ("%", "x" or ""), kept so `isFreeFigure` can ask it directly. */
    rawUnit: token.unit,
    index: token.index,
  }));
}

/**
 * Small counts and calendar years are not figures — the same rule the product's
 * number guard applies, asked of the same helper so the two cannot drift.
 */
export function isFreeFigure(figure) {
  return isFreeNumber({ text: figure.text, value: figure.value, unit: figure.rawUnit ?? "", index: figure.index });
}

/** Both readings of a figure, so a caller never has to know which one was primary. */
export function figureValues(figure) {
  return figure.alternate === undefined || figure.alternate === figure.value
    ? [figure.value]
    : [figure.value, figure.alternate];
}

/**
 * Do two amounts agree?
 *
 * A case's `tolerance` is ABSOLUTE, in the figure's own unit — that is how the
 * case authors write it (`1` rupiah on a billion, `0.5` on a dollar figure). The
 * product's own guard tolerance is always the floor underneath it: half a display
 * unit, or 0.5 % of the figure, whichever is larger. A figure the app's own
 * number guard would call verified is never failed here for being off by less
 * than that — the harness holds the product to its own contract, not to a
 * stricter one it never promised.
 */
export function amountsMatch(truth, candidate, tolerance) {
  if (!Number.isFinite(truth) || !Number.isFinite(candidate)) {
    return false;
  }
  if (matchesAllowed(candidate, [truth])) {
    return true;
  }
  return Number.isFinite(tolerance) && tolerance > 0 && Math.abs(truth - candidate) <= tolerance;
}

/** Unit classes that may stand in for each other when a figure is matched in prose. */
const COMPATIBLE = new Map([
  ["currency", new Set(["currency", "number"])],
  ["percent", new Set(["percent"])],
  ["ratio", new Set(["ratio", "number"])],
  ["months", new Set(["months", "number"])],
  ["years", new Set(["years", "number"])],
  ["count", new Set(["count", "number"])],
  ["number", new Set(UNIT_KINDS)],
]);

export function unitsCompatible(truthUnit, figureUnit) {
  const wanted = COMPATIBLE.get(truthUnit ?? "number") ?? COMPATIBLE.get("number");
  return wanted.has(figureUnit);
}

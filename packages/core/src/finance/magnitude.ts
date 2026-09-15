import type { AppLocale } from "../locale";
import type { LineItem } from "./types";

/**
 * "18.4B" is one token to a reader and two to a model. A quiet-reasoning model told to copy
 * figures verbatim copies the mantissa and drops the suffix, so the brief stores 18.4 where the
 * writer meant 18 400 000 000. Expanding the suffix before the model ever sees the text removes
 * the decision, and {@link looksScaled} catches whatever still slips through.
 */

/** Exact case. `m`, `b` and `t` are deliberately absent: "12 m" is metres or months far more often than money. */
const SINGLE_LETTER = new Map<string, number>([
  ["k", 1e3],
  ["K", 1e3],
  ["B", 1e9],
  ["T", 1e12],
]);

/** Matched case-insensitively. `bio` follows `bn` at 1e9, the sense it carries in finance shorthand. */
const WORD_SUFFIXES = new Map<string, number>([
  ["thousand", 1e3],
  ["rb", 1e3],
  ["ribu", 1e3],
  ["mn", 1e6],
  ["million", 1e6],
  ["jt", 1e6],
  ["juta", 1e6],
  ["bn", 1e9],
  ["bio", 1e9],
  ["billion", 1e9],
  ["miliar", 1e9],
  ["milyar", 1e9],
  ["trillion", 1e12],
  ["triliun", 1e12],
]);

/** Kept verbatim in front of the expanded number so "IDR 18.4B" stays "IDR 18400000000". */
const CURRENCY_TOKENS = new Set(["rp", "idr", "usd", "us$", "eur", "gbp", "sgd", "s$", "jpy", "$", "€", "£", "¥"]);

/** The powers of ten a dropped suffix can cost. */
export const MAGNITUDE_EXPONENTS = [3, 6, 9, 12] as const;

/**
 * Sign, currency, number, suffix. The lookbehind keeps identifiers out: the `4` of `v4` and the
 * `6` of `gpt-5.6-luna` are both preceded by a character that disqualifies them, and a leading
 * token that is not a known currency (the `Q` of "Q3 review") makes the callback hand the text
 * back untouched.
 */
const TOKEN = /(?<![\w.,])(-?)([A-Za-z$€£¥]{0,4})([ \t]?)(\d+(?:[.,]\d+)*)([ \t]?)([A-Za-z]{1,8})(?![A-Za-z0-9_])/g;

/**
 * `18.4` in English is `18,4` in Indonesian, and `18.400` in Indonesian is eighteen thousand four
 * hundred. The run locale picks which mark groups and which one divides; more than one decimal
 * mark means they were all group separators after all.
 */
function parseLocaleNumber(raw: string, locale: AppLocale): number | null {
  const decimal = locale === "id" ? "," : ".";
  const group = locale === "id" ? "." : ",";
  const parts = raw.split(group).join("").split(decimal);
  const value = Number(parts.length <= 2 ? parts.join(".") : parts.join(""));
  return Number.isFinite(value) ? value : null;
}

/**
 * `M` is the one genuinely ambiguous suffix: a million in English, `miliar` (1e9) in Indonesian.
 * The run locale decides it, and nothing else in either list overlaps.
 */
function multiplierFor(suffix: string, locale: AppLocale): number | null {
  if (suffix === "M") {
    return locale === "id" ? 1e9 : 1e6;
  }
  return SINGLE_LETTER.get(suffix) ?? WORD_SUFFIXES.get(suffix.toLowerCase()) ?? null;
}

type Expansion = { text: string; value: number };

/** `groups` is a {@link TOKEN} match: 0 the whole token, then sign, currency, gap, digits, space, suffix. */
function expandToken(groups: readonly string[], locale: AppLocale): Expansion | null {
  const [, sign, currency, gap, digits, , suffix] = groups;
  if (currency !== "" && !CURRENCY_TOKENS.has(currency.toLowerCase())) {
    return null;
  }
  const multiplier = multiplierFor(suffix, locale);
  const mantissa = parseLocaleNumber(digits, locale);
  if (multiplier === null || mantissa === null) {
    return null;
  }
  const value = Math.round(mantissa * multiplier) * (sign === "-" ? -1 : 1);
  if (!Number.isSafeInteger(value)) {
    return null;
  }
  // `String(value)` already carries the minus sign the token opened with.
  return { text: `${currency}${gap}${String(value)}`, value };
}

/**
 * Rewrite every number-plus-magnitude token to a plain integer, leaving currency tokens, spacing
 * and the rest of the sentence alone. Anything the suffix list does not know ("12 outlets",
 * "Q3 review", "gpt-5.6-luna") comes back byte for byte. Sub-unit fractions round to the nearest
 * whole unit, which at these magnitudes is far below the noise floor of the brief itself.
 */
export function expandMagnitudes(text: string, locale: AppLocale): string {
  return text.replace(TOKEN, (...args: string[]) => expandToken(args, locale)?.text ?? args[0]);
}

/** Every value the magnitude tokens in `text` stand for, in the order they appear. */
export function magnitudeValues(text: string, locale: AppLocale): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const expansion = expandToken(match, locale);
    if (expansion) {
      found.push(expansion.value);
    }
  }
  return found;
}

/**
 * Post-parse safety net. When the source text carries a suffixed figure and a parsed row holds
 * that figure's mantissa — the amount times 10^3, 10^6, 10^9 or 10^12 lands on the expanded value —
 * the row comes back at the expanded amount. Rows that already match, and rows no magnitude token
 * explains, pass through untouched, so an amount the writer really did mean as 18.4 survives.
 * Pass the text as the user typed it, not the expanded copy: the suffixes are the evidence.
 */
export function looksScaled(rawText: string, items: readonly LineItem[], locale: AppLocale): LineItem[] {
  const known = new Set(magnitudeValues(rawText, locale));
  if (known.size === 0) {
    return [...items];
  }
  return items.map((item) => {
    if (item.amount === 0 || known.has(item.amount)) {
      return item;
    }
    for (const exponent of MAGNITUDE_EXPONENTS) {
      const scaled = Math.round(item.amount * 10 ** exponent);
      if (Number.isSafeInteger(scaled) && known.has(scaled)) {
        return { ...item, amount: scaled };
      }
    }
    return item;
  });
}

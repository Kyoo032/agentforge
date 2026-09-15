import type { LineItem } from "./types";

/**
 * Nouns that name a quantity of things rather than money. A brief that says
 * "12 outlets" is describing the footprint, not a figure the engine may total.
 */
export const COUNT_WORDS = [
  "outlets",
  "stores",
  "branches",
  "employees",
  "staff",
  "headcount",
  "units",
  "months",
  "weeks",
  "days",
  "customers",
  "users",
] as const;

/** A count row never carries a currency, so anything this large is far more likely to be money. */
export const COUNT_ROW_MAX_AMOUNT = 1000;

function singularOf(word: string): string {
  if (/(?:ch|sh|s|x)es$/.test(word)) {
    return word.slice(0, -2);
  }
  return word.endsWith("s") ? word.slice(0, -1) : word;
}

const COUNT_WORD_PATTERN = new RegExp(
  `\\b(?:${[...new Set(COUNT_WORDS.flatMap((word) => [word, singularOf(word)]))].join("|")})\\b`,
  "i",
);

/**
 * True when a parsed row looks like a count of things ("12 outlets") instead of a
 * monetary amount or a rate. All three signals must agree: no currency, a small
 * whole number, and a label naming a countable noun. "Units sold 12000 IDR" keeps
 * its currency and survives, and so does any figure above {@link COUNT_ROW_MAX_AMOUNT}.
 */
export function isCountRow(item: LineItem): boolean {
  if (item.currency.trim() !== "") {
    return false;
  }
  if (!Number.isInteger(item.amount) || Math.abs(item.amount) >= COUNT_ROW_MAX_AMOUNT) {
    return false;
  }
  return COUNT_WORD_PATTERN.test(item.label);
}

/** Copy of the list without the count rows. The input array is never touched. */
export function dropCountRows(items: readonly LineItem[]): LineItem[] {
  return items.filter((item) => !isCountRow(item));
}

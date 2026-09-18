import type { LineItem } from "./types";

/**
 * Nouns that name a quantity of things rather than money, in both languages. A brief that says
 * "12 outlets" is describing the footprint, not a figure the engine may total.
 *
 * These rows are still the owner's own data — a headcount and a store count belong in the brief — so
 * the parse step keeps them and the engine holds them out of every monetary total by category rather
 * than by deletion. {@link dropCountRows} stays for the one caller that must not see them at all: a
 * model reading free prose, which otherwise offers "3 scenarios" as a figure.
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
  "seats",
  "karyawan",
  "pegawai",
  "orang",
  "gerai",
  "outlet",
  "cabang",
  "toko",
  "mitra",
  "pelanggan",
  "unit",
  "pcs",
  "buah",
  "bulan",
  "hari",
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

/** A parenthesised unit that is not a rate: "(pcs)", "(orang)", "(pcs/bulan)" — but not "(22%)". */
const UNIT_MARKER = /\([^)0-9%]+\)/;

/** True when the label names something countable: "12 outlets", "Jumlah Karyawan Tetap (orang)". */
export function hasCountWord(label: string): boolean {
  return COUNT_WORD_PATTERN.test(label);
}

/** The countable noun a label names, lower-cased, so two rows counting the same thing can be added. */
export function countNoun(label: string): string | null {
  const found = COUNT_WORD_PATTERN.exec(label);
  return found ? singularOf(found[0].toLowerCase()) : null;
}

/** True when the label spells its unit out beside the name, which says "count" however large it is. */
export function hasUnitMarker(label: string): boolean {
  return UNIT_MARKER.test(label);
}

/** True when the amount is the size a count comes in: a small whole number. */
export function isCountAmount(amount: number): boolean {
  return Number.isInteger(amount) && Math.abs(amount) < COUNT_ROW_MAX_AMOUNT;
}

/**
 * True when a parsed row counts things ("12 outlets", "412.000 pcs") instead of naming a monetary
 * amount or a rate. A currency always wins: "Units sold 12000 IDR" is money. Otherwise the label must
 * name a countable noun, and the figure must either be a small whole number or carry its unit in the
 * label — 412,000 pcs is still a count, and the old max-amount rule let the engine total it.
 */
export function isCountRow(item: LineItem): boolean {
  if (item.currency.trim() !== "") {
    return false;
  }
  if (!hasCountWord(item.label)) {
    return false;
  }
  return isCountAmount(item.amount) || (hasUnitMarker(item.label) && Number.isInteger(item.amount));
}

/** Copy of the list without the count rows. The input array is never touched. */
export function dropCountRows(items: readonly LineItem[]): LineItem[] {
  return items.filter((item) => !isCountRow(item));
}

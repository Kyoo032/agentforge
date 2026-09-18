/**
 * Which rows are totals of the other rows.
 *
 * A subtotal that reaches the parse step as an ordinary line item is counted twice: revenue plus
 * "Total revenue" is double the revenue. Names alone are not enough to tell — "Net sales - flagship
 * store" is a line item and "Net cash flow" is not — so a row is checked *arithmetically* first: it is
 * derived when it equals the sum of the rows above it in every period it fills. Names are the fallback
 * for the rows arithmetic cannot reach ("Laba kotor" is revenue minus cost, not a sum).
 *
 * Totals of totals are covered as well: "JUMLAH ASET" matches the last two rows that were themselves
 * marked derived, so the nesting is followed all the way up to "JUMLAH LIABILITAS DAN EKUITAS".
 */
import { hasCountWord, hasUnitMarker, isCountAmount } from "../count-rows";
import type { NumberStyle } from "./numbers";
import { cellValue } from "./numbers";

/** How far a sum may sit from the row it should equal before the row is not that sum. */
export const DERIVED_RELATIVE_TOLERANCE = 0.005;
/** Rupiah sheets round to the rupiah, so a tiny absolute slack costs nothing. */
export const DERIVED_ABSOLUTE_TOLERANCE = 1;
/** Most recent derived rows tried as the parts of a total of totals. */
const DERIVED_WINDOW_MAX = 8;

/** `Total …`, `Jumlah …`, `Subtotal …` — the words that only ever open a total. */
const TOTAL_PREFIX = /^(total|totals|jumlah|sub[ -]?total|grand total)\b/i;
/** Named results that are computed from the rows above but are not a plain sum of them. */
const RESULT_WORDS =
  /\b(laba kotor|laba usaha|laba bersih|laba sebelum pajak|rugi bersih|rugi usaha|arus kas bersih|saldo akhir|surplus|defisit|gross profit|operating income|operating profit|operating loss|net income|net profit|net loss|net cash flow|net operating cash|ebit|ebitda|closing balance|ending balance|net assets)\b/i;

/**
 * "Jumlah Karyawan Tetap (orang)" counts people. The unit spelled out beside the name says so
 * whatever the figure is, so the name alone is enough to keep that row out of the totals — while
 * "Total staff cost" keeps a countable noun and stays a money total, because it names no unit.
 */
export function isCountLabel(label: string): boolean {
  return hasCountWord(label) && hasUnitMarker(label);
}

/**
 * True when the row's name alone says it is a total or a computed result.
 *
 * "Jumlah" and "Total" open a sum everywhere except in front of a counted thing: `Jumlah Karyawan
 * Tetap (orang)` is a headcount the sheet wrote down, not the sum of the rows above it, and tagging
 * it `[subtotal]` costs the reader a real row.
 */
export function isDerivedLabel(label: string): boolean {
  const text = label.trim();
  if (RESULT_WORDS.test(text)) {
    return true;
  }
  return TOTAL_PREFIX.test(text) && !isCountLabel(text);
}

function closeEnough(sum: number, target: number): boolean {
  return Math.abs(sum - target) <= Math.max(DERIVED_ABSOLUTE_TOLERANCE, Math.abs(target) * DERIVED_RELATIVE_TOLERANCE);
}

type Numbers = ReadonlyArray<number | null>;

function valuesOf(row: ReadonlyArray<string>, columns: readonly number[], style: NumberStyle): Numbers {
  return columns.map((index) => cellValue(row[index] ?? "", style));
}

function sumRows(rows: ReadonlyArray<Numbers>, at: number): number {
  return rows.reduce((total, row) => total + (row[at] ?? 0), 0);
}

/**
 * A count with no unit beside it — `Jumlah Karyawan Tetap | 46` — is only recognisable once the
 * row's own figures are in hand: a countable noun plus small whole numbers is a count, and the same
 * noun over a nine-figure amount (`Total staff cost`) is a total.
 */
function looksLikeCount(label: string, values: Numbers): boolean {
  const amounts = values.filter((value): value is number => value !== null);
  return amounts.length > 0 && amounts.every(isCountAmount) && hasCountWord(label);
}

function matchesSum(target: Numbers, parts: ReadonlyArray<Numbers>): boolean {
  if (parts.length < 2) {
    return false;
  }
  const filled = target.flatMap((value, at) => (value === null ? [] : [at]));
  if (filled.length === 0) {
    return false;
  }
  return filled.every((at) => closeEnough(sumRows(parts, at), target[at] ?? 0));
}

export type DerivedInput = {
  /** One entry per body row, in sheet order. */
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  /** The label of each row, already resolved by the caller. */
  readonly labels: ReadonlyArray<string>;
  /** Rows the caller already knows carry no figures (headings, notes). */
  readonly skipped: ReadonlyArray<boolean>;
  /** The columns that hold figures. */
  readonly columns: readonly number[];
  readonly style: NumberStyle;
};

/**
 * One flag per body row: true when the row is a subtotal, a total of totals or a named result.
 * Rows are walked in order because a later total is only recognisable once the earlier ones are.
 */
export function markDerivedRows(input: DerivedInput): boolean[] {
  const values = input.rows.map((row) => valuesOf(row, input.columns, input.style));
  const flags: boolean[] = [];
  const previousDerived: number[] = [];
  input.rows.forEach((_row, index) => {
    if (input.skipped[index]) {
      flags.push(false);
      return;
    }
    const target = values[index] ?? [];
    const lastDerived = previousDerived.at(-1) ?? -1;
    // Plain rows since the last total, then the last few totals themselves: a section, then its parents.
    const plain = [...Array(Math.max(0, index - lastDerived - 1)).keys()]
      .map((step) => lastDerived + 1 + step)
      .filter((at) => !input.skipped[at])
      .map((at) => values[at] ?? []);
    const totals = [...Array(Math.min(DERIVED_WINDOW_MAX, previousDerived.length)).keys()].map((count) =>
      previousDerived.slice(previousDerived.length - count - 2).map((at) => values[at] ?? []),
    );
    const label = input.labels[index] ?? "";
    const derived =
      matchesSum(target, plain) ||
      totals.some((window) => matchesSum(target, window)) ||
      (isDerivedLabel(label) && !looksLikeCount(label, target));
    if (derived) {
      previousDerived.push(index);
    }
    flags.push(derived);
  });
  return flags;
}

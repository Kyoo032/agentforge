/**
 * Which confirmed rows are totals of the other rows.
 *
 * A statement prints its detail rows *and* its "Jumlah …" / "Total …" / "Laba Kotor" rows. When both
 * reach the engine every aggregate comes out doubled — that is what made a 7,570,000,000 revenue read
 * back as 15,164,000,000. The importer tags what it can see (`[subtotal]`); this asks the same
 * question again of the confirmed line items, so a paste, an older import and a hand-edited row are
 * covered on the same terms.
 *
 * Derived rows are never thrown away. They are the sheet's own statement of the answer, so they stay
 * beside the items for display and for cross-checking what we compute. They only ever stay out of sums.
 *
 * The order of evidence: arithmetic first (a row that equals a contiguous run above it, in every
 * period it fills), then names the arithmetic cannot reach ("Laba kotor" is revenue minus cost, not a
 * sum), and last a bare "Total …" prefix — believed only when there are rows above it to be the total
 * of and the row is not a count of things. That last clause is what keeps "Jumlah Karyawan Tetap
 * (orang)" a line item instead of a subtotal.
 */
import { hasCountWord, isCountAmount } from "./count-rows";
import type { LineItem } from "./types";

/** How far a sum may sit from the row it should equal before the row is not that sum. */
export const DERIVED_ROW_RELATIVE_TOLERANCE = 0.005;
/** Rupiah sheets round to the rupiah, so a tiny absolute slack costs nothing. */
export const DERIVED_ROW_ABSOLUTE_TOLERANCE = 1;
/** Most recent derived rows tried as the parts of a total of totals. */
const DERIVED_WINDOW_MAX = 8;
/** Fewer rows than this above it and a row named "Total …" has nothing to be the total of. */
const TOTAL_NAME_MIN_PARTS = 2;

const TOTAL_PREFIX = /^\s*(?:total|totals|jumlah|sub[\s-]?totals?|grand total)\b/i;

/** Named results computed from the rows above without being a plain sum of them. */
const RESULT_WORDS =
  /\b(?:laba kotor|laba usaha|laba operasi|laba bersih|laba sebelum pajak|laba setelah pajak|rugi bersih|rugi usaha|pendapatan bersih|penjualan bersih|arus kas bersih|saldo akhir|saldo awal|surplus|defisit|gross profit|gross margin|operating income|operating profit|operating loss|profit before tax|pre-?tax profit|net income|net profit|net loss|net revenue|net sales|net cash flow|net operating cash|ebitda?|closing balance|ending balance|net assets)\b/i;

/** True when the row's name opens a total: "Jumlah …", "Total …", "Subtotal …". */
export function isTotalName(label: string): boolean {
  return TOTAL_PREFIX.test(label);
}

/** True when the row's name is a computed result rather than a sum of the rows above. */
export function isResultName(label: string): boolean {
  return RESULT_WORDS.test(label);
}

/** True when the name alone says the row is not a line item. */
export function isDerivedName(label: string): boolean {
  return isTotalName(label) || isResultName(label);
}

type RowValues = ReadonlyMap<string, number>;
type Row = { readonly label: string; readonly values: RowValues; readonly tagged: boolean };

function closeEnough(sum: number, target: number): boolean {
  const tolerance = Math.max(DERIVED_ROW_ABSOLUTE_TOLERANCE, Math.abs(target) * DERIVED_ROW_RELATIVE_TOLERANCE);
  return Math.abs(sum - target) <= tolerance;
}

/** One entry per distinct label, in first-appearance order, holding that label's amount per period. */
function rowsOf(items: readonly LineItem[], tagged: readonly boolean[]): Row[] {
  const order: string[] = [];
  const values = new Map<string, Map<string, number>>();
  const flags = new Map<string, boolean>();
  items.forEach((item, at) => {
    const existing = values.get(item.label);
    if (existing) {
      if (!existing.has(item.period)) {
        existing.set(item.period, item.amount);
      }
    } else {
      order.push(item.label);
      values.set(item.label, new Map([[item.period, item.amount]]));
    }
    const already = flags.get(item.label) ?? false;
    flags.set(item.label, already || tagged[at] === true || item.derived === true);
  });
  return order.map((label) => ({
    label,
    values: values.get(label) ?? new Map<string, number>(),
    tagged: flags.get(label) ?? false,
  }));
}

function matchesSum(target: RowValues, parts: readonly RowValues[]): boolean {
  if (parts.length < TOTAL_NAME_MIN_PARTS || target.size === 0) {
    return false;
  }
  for (const [period, amount] of target) {
    const sum = parts.reduce((total, part) => total + (part.get(period) ?? 0), 0);
    if (!closeEnough(sum, amount)) {
      return false;
    }
  }
  return true;
}

/** Every contiguous run of two or more rows that ends just above `index`. */
function runsAbove(values: readonly RowValues[], from: number, index: number): RowValues[][] {
  const runs: RowValues[][] = [];
  for (let start = index - TOTAL_NAME_MIN_PARTS; start >= from; start -= 1) {
    runs.push(values.slice(start, index));
  }
  return runs;
}

/** The last few derived rows, tried as the parts of a total of totals. */
function totalWindows(values: readonly RowValues[], derivedAt: readonly number[]): RowValues[][] {
  const max = Math.min(DERIVED_WINDOW_MAX, derivedAt.length);
  return Array.from({ length: max }, (_unused, count) =>
    derivedAt.slice(derivedAt.length - count - TOTAL_NAME_MIN_PARTS).map((at) => values[at] as RowValues),
  );
}

/** "Jumlah Karyawan Tetap (orang)" counts people; no currency, small whole numbers, a countable noun. */
function looksLikeCount(row: Row): boolean {
  const amounts = [...row.values.values()];
  return amounts.length > 0 && amounts.every(isCountAmount) && hasCountWord(row.label);
}

export type DerivedMarkOptions = {
  /** One flag per item, from the importer's own `[subtotal]` tag. Re-checked, never blindly trusted. */
  readonly tagged?: readonly boolean[];
};

function decide(row: Row, index: number, values: readonly RowValues[], derivedAt: readonly number[]): boolean {
  const plainFrom = (derivedAt.at(-1) ?? -1) + 1;
  const arithmetic =
    runsAbove(values, plainFrom, index).some((run) => matchesSum(row.values, run)) ||
    totalWindows(values, derivedAt).some((window) => matchesSum(row.values, window));
  if (arithmetic || isResultName(row.label)) {
    return true;
  }
  if (!row.tagged && !isTotalName(row.label)) {
    return false;
  }
  if (looksLikeCount(row)) {
    return false;
  }
  // The importer read the sheet and saw what this total sits over — including rows a register folded
  // into its entities, which are not in this list at all any more. A name on its own still has to
  // have something above it before it can be the total of anything.
  return row.tagged || index - plainFrom >= TOTAL_NAME_MIN_PARTS;
}

/** One flag per line item: true when the row is a subtotal, a total of totals or a named result. */
export function markDerivedLineItems(items: readonly LineItem[], options: DerivedMarkOptions = {}): boolean[] {
  const rows = rowsOf(items, options.tagged ?? []);
  const values = rows.map((row) => row.values);
  const derivedAt: number[] = [];
  const byLabel = new Map<string, boolean>();
  rows.forEach((row, index) => {
    const derived = decide(row, index, values, derivedAt);
    if (derived) {
      derivedAt.push(index);
    }
    byLabel.set(row.label, derived);
  });
  return items.map((item) => byLabel.get(item.label) ?? false);
}

function withoutFlag(item: LineItem): LineItem {
  const { derived: _unused, ...rest } = item;
  return rest;
}

/**
 * The same list with `derived: true` on the rows that are totals — and off the rows that are not.
 * Clearing matters: an importer tag is evidence, and this is where a tag the arithmetic contradicts
 * ("Jumlah Karyawan Tetap (orang)") is taken back off the row.
 */
export function withDerivedFlags(items: readonly LineItem[], options: DerivedMarkOptions = {}): LineItem[] {
  const flags = markDerivedLineItems(items, options);
  return items.map((item, at) => {
    if (flags[at]) {
      return item.derived === true ? item : { ...item, derived: true };
    }
    return item.derived === true ? withoutFlag(item) : item;
  });
}

/** The rows that may be summed, and the rows the sheet stated for us to check against. */
export function splitDerivedLineItems(
  items: readonly LineItem[],
  options: DerivedMarkOptions = {},
): { items: LineItem[]; derived: LineItem[] } {
  const tagged = withDerivedFlags(items, options);
  return {
    items: tagged.filter((item) => item.derived !== true),
    derived: tagged.filter((item) => item.derived === true),
  };
}

/**
 * Only the summable rows. A list that already carries `derived` flags is taken at its word, so the
 * defence inside `computeFinance` costs nothing once the parse step has done the work.
 */
export function dropDerivedLineItems(items: readonly LineItem[], options: DerivedMarkOptions = {}): LineItem[] {
  return items.some((item) => item.derived === true)
    ? items.filter((item) => item.derived !== true)
    : splitDerivedLineItems(items, options).items;
}

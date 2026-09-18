/**
 * An entity-per-row table, told apart from a statement.
 *
 * A statement is a label and its periods: `Pendapatan | 2023 | 2024`. A *register* is a different
 * shape entirely — one row per person, branch, asset or item, and several amount columns that all
 * describe that one row: a payroll run (gaji pokok, tunjangan, potongan, gaji bersih), a fee
 * schedule, a per-outlet sales list. Read as a statement it loses everything but its last column,
 * which is how a payroll's four amounts became one; summed as a statement it counts the same rupiah
 * three times over, because `gaji pokok + tunjangan - potongan` IS `gaji bersih`.
 *
 * Nothing here computes anything. It answers three questions about a block — which column names the
 * entity, which columns hold amounts, and which of those the row settles on — and a block that is not
 * a register answers `null`, so every sheet the reader already handled keeps the reading it had.
 */
import { cellValue, type NumberStyle } from "./numbers";
import { isPeriodHeader, isPeriodLabel } from "./periods";

/** Fewest amount columns a block needs before it reads as a register and not a label/value list. */
export const REGISTER_MIN_AMOUNT_COLUMNS = 2;
/** Fewest rows a register needs. Below this a table is a handful of stated figures, not a list. */
export const REGISTER_MIN_ROWS = 3;
/** Share of a column's filled cells that must be figures before it is an amount column. */
const AMOUNT_COLUMN_SHARE = 0.6;
/** Share of an entity column's filled cells that must be distinct: a register names each row once. */
const ENTITY_DISTINCT_SHARE = 0.8;
/** Most amount columns the net-column search tries sign combinations over. */
const NET_SEARCH_MAX_COLUMNS = 6;
/** How far a net column may sit from the columns it settles before it is not their settlement. */
const NET_RELATIVE_TOLERANCE = 0.005;
const NET_ABSOLUTE_TOLERANCE = 1;
/** Digits past which a whole number is an identifier — an NIK, an NPWP, an account — not an amount. */
const IDENTIFIER_MIN_DIGITS = 12;

/** "No", "Nomor", "#" — a row counter is a number, but it is never the figure and never the label. */
const ROW_NUMBER_HEADER = /^(no\.?|nomor|num|number|#|id|urut)$/i;

/** How many rows of a register the shape search will look at. Past this the block is a ledger. */
const REGISTER_MAX_ROWS = 400;

export type RegisterShape = {
  /** The column that names the entity each row is about. */
  readonly entityAt: number;
  /** Every column holding an amount, left to right. */
  readonly amountAt: readonly number[];
  /**
   * The column the other amounts settle into — the one a reader would call the row's bottom line.
   * It is the only column that may be added down the sheet without counting the same money twice.
   */
  readonly netAt: number;
};

type Cells = ReadonlyArray<ReadonlyArray<string>>;
type Amounts = ReadonlyArray<number | null>;

function columnCells(body: Cells, index: number): string[] {
  return body.map((row) => (row[index] ?? "").trim());
}

function filledCells(body: Cells, index: number): string[] {
  return columnCells(body, index).filter((cell) => cell !== "");
}

/** A 16-digit NIK reads as a perfectly good number; no amount on a real sheet is written that way. */
function isIdentifier(cell: string): boolean {
  return cell.replace(/\D+/g, "").length >= IDENTIFIER_MIN_DIGITS;
}

/** "No", or a column that simply counts 1, 2, 3 down the page. */
export function isRowCounterColumn(header: string, body: Cells, index: number): boolean {
  if (ROW_NUMBER_HEADER.test(header.trim())) {
    return true;
  }
  const filled = filledCells(body, index);
  return filled.length >= 3 && filled.every((cell, at) => cell === String(at + 1));
}

export function isAmountColumn(body: Cells, index: number, style: NumberStyle): boolean {
  const filled = filledCells(body, index);
  if (filled.length === 0 || filled.some(isIdentifier)) {
    return false;
  }
  const numbers = filled.filter((cell) => cellValue(cell, style) !== null).length;
  return numbers / filled.length >= AMOUNT_COLUMN_SHARE;
}

function isEntityColumn(body: Cells, index: number, style: NumberStyle): boolean {
  if (isAmountColumn(body, index, style)) {
    return false;
  }
  const filled = filledCells(body, index);
  const distinct = new Set(filled.map((cell) => cell.toLowerCase())).size;
  return filled.length >= REGISTER_MIN_ROWS && distinct / filled.length >= ENTITY_DISTINCT_SHARE;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(NET_ABSOLUTE_TOLERANCE, Math.abs(right) * NET_RELATIVE_TOLERANCE);
}

/** Every ± assignment over `count` columns, as arrays of 1 and -1. */
function signVectors(count: number): number[][] {
  return Array.from({ length: 2 ** count }, (_unused, mask) =>
    Array.from({ length: count }, (_also, at) => ((mask >> at) & 1 ? -1 : 1)),
  );
}

function settles(rows: ReadonlyArray<Amounts>, at: number, signs: readonly number[]): boolean {
  return rows.every((row) => {
    const others = row.flatMap((value, index) => (index === at ? [] : [value ?? 0]));
    const total = others.reduce((sum, value, index) => sum + value * (signs[index] ?? 1), 0);
    return closeEnough(total, row[at] ?? 0);
  });
}

/**
 * Which amount column the others add up to, searched from the right — a register puts its bottom
 * line last, and the identity is symmetric, so `gaji pokok` would "settle" the other three just as
 * well as `gaji bersih` does. A block whose columns are independent of one another has no
 * settlement at all and simply keeps its rightmost amount.
 */
export function registerNetAt(rows: ReadonlyArray<Amounts>, count: number): number {
  const full = rows.filter((row) => row.every((value) => value !== null));
  if (full.length < 2 || count > NET_SEARCH_MAX_COLUMNS) {
    return count - 1;
  }
  const vectors = signVectors(count - 1);
  for (let at = count - 1; at >= 0; at -= 1) {
    if (vectors.some((signs) => settles(full, at, signs))) {
      return at;
    }
  }
  return count - 1;
}

export type RegisterColumns = {
  /** Every column holding an amount, left to right, with the row counters already out. */
  readonly amountAt: number[];
  /** The column naming what each row is about, or -1 when no column does. */
  readonly entityAt: number;
};

/** Which columns of a block hold amounts and which one names the row. Row counters are neither. */
export function registerColumns(header: ReadonlyArray<string>, body: Cells, style: NumberStyle): RegisterColumns {
  const width = Math.max(header.length, ...body.map((row) => row.length), 0);
  // A column headed by a period is a period column, whatever it holds: a statement is never a
  // register, and a register never carries its dates in its headers.
  const usable = [...Array(width).keys()].filter((index) => {
    const name = header[index] ?? "";
    return !isRowCounterColumn(name, body, index) && !isPeriodLabel(name) && !isPeriodHeader(name);
  });
  const amountAt = usable.filter((index) => isAmountColumn(body, index, style));
  const entityAt = usable.find((index) => !amountAt.includes(index) && isEntityColumn(body, index, style));
  return { amountAt, entityAt: entityAt ?? -1 };
}

/**
 * The register this block is, or `null` when it is a statement, a ledger or a key/value list.
 *
 * Two or more amount columns beside a column of distinct names is the whole test. One amount column
 * is the label/value shape the narrow reader already handles, and a block with period headers never
 * reaches here — so every sheet that worked before still takes the path it took before.
 */
export function registerShape(header: ReadonlyArray<string>, body: Cells, style: NumberStyle): RegisterShape | null {
  if (body.length < REGISTER_MIN_ROWS || body.length > REGISTER_MAX_ROWS) {
    return null;
  }
  const { amountAt, entityAt } = registerColumns(header, body, style);
  if (amountAt.length < REGISTER_MIN_AMOUNT_COLUMNS || entityAt < 0) {
    return null;
  }
  const rows = body.map((row) => amountAt.map((index) => cellValue((row[index] ?? "").trim(), style)));
  return { entityAt, amountAt, netAt: amountAt[registerNetAt(rows, amountAt.length)] as number };
}

/** How many trailing words of a heading are tried as the period it names. */
const PERIOD_TAIL_WORDS = 3;
const HAS_YEAR = /\b(?:19|20)\d{2}\b/;

function trailingPeriod(text: string): string {
  const words = text.trim().split(/\s+/);
  for (let take = Math.min(PERIOD_TAIL_WORDS, words.length); take >= 1; take -= 1) {
    const tail = words.slice(words.length - take).join(" ");
    if (HAS_YEAR.test(tail) && isPeriodLabel(tail)) {
      return tail;
    }
  }
  return "";
}

/**
 * The period a register sheet names in its own headings, when it names exactly one.
 *
 * A register has no period columns to carry the date, so the month it covers is written once, in a
 * title or a total row — "Reimbursement Oktober 2024", "TOTAL PEMBAYARAN OKTOBER 2024". One distinct
 * answer is the sheet saying what it is about; two would be a guess, and a guess is not worth
 * stamping on every row, so two or more answer "".
 */
export function registerSheetPeriod(rows: Cells): string {
  const found: string[] = [];
  for (const row of rows) {
    const period = trailingPeriod(row.find((cell) => cell.trim() !== "") ?? "");
    if (period !== "" && !found.some((seen) => seen.toLowerCase() === period.toLowerCase())) {
      found.push(period);
    }
  }
  return found.length === 1 ? (found[0] as string) : "";
}

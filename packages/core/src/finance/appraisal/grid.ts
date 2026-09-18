/**
 * A label column and year columns, read into rows — in code, with no model in the loop.
 *
 * An appraisal sheet is the one finance shape a machine can read outright: the header names the
 * periods, the first cell of every row names the line, and the rest are amounts. So the model is
 * never asked to transcribe an amount here; it is only asked for a narrative, later, over figures
 * this function produced.
 *
 * Two defences are deliberate. Amounts go through the importer's own cell reader, so a row that
 * arrives un-normalised — `(1,450,000,000)` with its parentheses and its comma thousands — still
 * reads as −1450000000. And a `Net cash flow` row is tested against the column sums of the rows
 * above it before it is dropped, so a real row that merely sounds like a total survives.
 */
import { normalizeAmount, sheetPointStyle, type PointStyle } from "../import-table";
import type { LineItem, LineItemCategory } from "../types";
import { isSubtotalLabel, isTaggedSubtotal } from "./flows";
import { allPeriodsOrdinal, periodOrdinal } from "./periods";

/** A sheet header the importer prints above the table; never a data row. */
const SHEET_HEADER = /^\s*sheet\s*:/i;
/** Two or more spaces, or a tab, as a column break where the text carries no pipes. */
const WIDE_GAP = /\t+|\s{2,}/;
/** A cell that is a rate, not a flow: it ends in a percent sign once normalised. */
const PERCENT_CELL = /%\s*$/;
/** The ISO code or currency mark `normalizeAmount` puts in front of the value it read. */
const VALUE_PREFIX = /^(?:[A-Z]{3}|Rp|[$€£¥])\s*/;
/** The mark a sheet writes its money with, taken as the currency when no ISO code is there. */
const CURRENCY_MARK: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bIDR\b|Rp\s?\d|\bRp\b/i, "IDR"],
  [/\bUSD\b|\$\s?\d/, "USD"],
  [/\bEUR\b|€\s?\d/, "EUR"],
  [/\bSGD\b/i, "SGD"],
];
/** A sheet with more rows than this is not an appraisal table; it is a ledger export. */
const MAX_ROWS = 200;
/** Column sums match their subtotal to within this share of themselves. */
const SUBTOTAL_TOLERANCE = 1e-6;

export type AppraisalGrid = {
  /** One row per non-zero cell, carrying the year header as its period. */
  readonly items: LineItem[];
  /** The year headers, in the order the sheet wrote them. */
  readonly periods: string[];
  /** The rows dropped because they restate the rows above them. */
  readonly subtotals: string[];
  /** The currency the sheet writes in, or "" when it says nothing. */
  readonly currency: string;
};

type RawRow = { readonly label: string; readonly cells: readonly string[] };

function splitCells(line: string): string[] {
  const parts = line.includes("|") ? line.split("|") : line.split(WIDE_GAP);
  return parts.map((cell) => cell.trim());
}

function currencyOf(text: string): string {
  return CURRENCY_MARK.find(([pattern]) => pattern.test(text))?.[1] ?? "";
}

/** The amount a cell carries, or null when it is blank, a rate, or not a number at all. */
export function gridAmount(cell: string, style: PointStyle): number | null {
  const normalised = normalizeAmount(cell, style);
  if (normalised === null || PERCENT_CELL.test(normalised)) {
    return null;
  }
  const value = Number(normalised.replace(VALUE_PREFIX, ""));
  return Number.isFinite(value) ? value : null;
}

/** The header row's period columns, or null when this line is not a year header. */
function periodHeader(cells: readonly string[]): string[] | null {
  const periods = cells.slice(1).filter((cell) => cell !== "");
  return periods.length >= 2 && allPeriodsOrdinal(periods) ? periods : null;
}

function findHeader(lines: readonly string[]): { at: number; periods: string[] } | null {
  for (const [at, line] of lines.entries()) {
    const periods = periodHeader(splitCells(line));
    if (periods) {
      return { at, periods };
    }
  }
  return null;
}

function readRows(lines: readonly string[], columns: number): RawRow[] {
  return lines
    .map((line) => splitCells(line))
    .filter((cells) => cells.length >= 2 && (cells[0] ?? "") !== "")
    .map((cells) => ({ label: cells[0] as string, cells: cells.slice(1, columns + 1) }))
    .slice(0, MAX_ROWS);
}

function amountsOf(row: RawRow, columns: number, style: PointStyle): (number | null)[] {
  return Array.from({ length: columns }, (_unused, index) => gridAmount(row.cells[index] ?? "", style));
}

/** True when this row's cells are the column sums of every row that is not itself a candidate. */
function totalsTheColumns(amounts: readonly (number | null)[], others: readonly (number | null)[][]): boolean {
  if (others.length < 1) {
    return false;
  }
  return amounts.every((value, column) => {
    const total = others.reduce((sum, row) => sum + (row[column] ?? 0), 0);
    const scale = Math.max(Math.abs(total), Math.abs(value ?? 0), 1);
    return Math.abs(total - (value ?? 0)) <= scale * SUBTOTAL_TOLERANCE;
  });
}

/**
 * The outlay row is an asset the plan buys; everything after it is cash moving. Categories do not
 * change a single figure — every flow is netted by period — but they are what the reader confirms.
 */
function categoryOf(amounts: readonly (number | null)[]): LineItemCategory {
  const nonZero = amounts.filter((value) => value !== null && value !== 0);
  const first = amounts[0];
  return nonZero.length === 1 && first !== null && first !== undefined && first < 0 ? "asset" : "cash";
}

/**
 * The imported figures text to confirmed rows, or null when this text is not a year-column table.
 *
 * A null is the honest answer, not a failure: free-typed figures go to the brief's own line-item
 * read instead, and the owner confirms whatever comes back either way.
 */
export function appraisalGridFromText(text: string): AppraisalGrid | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !SHEET_HEADER.test(line));
  const header = findHeader(lines);
  if (!header) {
    return null;
  }
  const periods = header.periods;
  const raw = readRows(lines.slice(header.at + 1), periods.length);
  const style = sheetPointStyle(raw.map((row) => [...row.cells]));
  const rows = raw.map((row) => ({ row, amounts: amountsOf(row, periods.length, style) }));
  const plain = rows.filter((entry) => !isSubtotalLabel(entry.row.label));
  const kept = rows.filter(
    (entry) =>
      !isSubtotalLabel(entry.row.label) ||
      (!isTaggedSubtotal(entry.row.label) &&
        !totalsTheColumns(
          entry.amounts,
          plain.map((other) => other.amounts),
        )),
  );
  const items = kept.flatMap((entry) =>
    entry.amounts.flatMap((amount, column) =>
      amount === null || amount === 0
        ? []
        : [
            {
              label: entry.row.label,
              period: periods[column] as string,
              amount,
              currency: currencyOf(text),
              category: categoryOf(entry.amounts),
            },
          ],
    ),
  );
  return items.length === 0
    ? null
    : {
        items,
        periods: [...periods].sort((left, right) => (periodOrdinal(left) ?? 0) - (periodOrdinal(right) ?? 0)),
        subtotals: rows.filter((entry) => !kept.includes(entry)).map((entry) => entry.row.label),
        currency: currencyOf(text),
      };
}

/**
 * Words that introduce the rate, in both languages. The rate itself is whatever percentage follows
 * within a short reach — far enough for "diskonto 12% per tahun", short enough that the next
 * sentence's percentage cannot be mistaken for it.
 */
const RATE_PHRASE =
  /(?:diskonto|potongan|tingkat\s+diskonto|discount\s*rate|discount|hurdle(?:\s*rate)?|wacc|required\s*return)[^%\d]{0,24}(\d{1,3}(?:[.,]\d{1,4})?)\s*%/i;
/** The other order: "use an 8% discount rate", where the figure comes before the words. */
const RATE_BEFORE =
  /(\d{1,3}(?:[.,]\d{1,4})?)\s*%[^%\d]{0,16}(?:tingkat\s+diskonto|diskonto|discount\s*rate|hurdle(?:\s*rate)?|wacc)/i;
/** The mirror: "12% per tahun", "8% p.a." — a rate that names its own period instead. */
const RATE_SUFFIX = /(\d{1,3}(?:[.,]\d{1,4})?)\s*%\s*(?:per\s+tahun|per\s+year|p\.?a\.?|annually|setahun)/i;

/**
 * The discount rate the request states in words, or null when it states none.
 *
 * Best effort on purpose: this only prefills the field the owner then confirms, and a rate nobody
 * confirmed never reaches `compute`. The percentage is read with a point decimal after the comma
 * form is normalised, so "12,5%" and "12.5%" both read as 12.5.
 */
export function discountRateFromText(text: string): number | null {
  const match = RATE_PHRASE.exec(text) ?? RATE_BEFORE.exec(text) ?? RATE_SUFFIX.exec(text);
  const digits = match?.[1];
  if (digits === undefined) {
    return null;
  }
  const value = Number(digits.replace(",", "."));
  return Number.isFinite(value) && value > -100 && value < 1000 ? value : null;
}

/**
 * Where the header is, what sat above it, and where one table ends and the next begins.
 *
 * "The first row with two filled cells is the header" was wrong for every real sheet: a cash book
 * opens with `Saldo awal (1 Jan 2024) | 45.000.000`, that row became the header, the twelve month
 * columns below it were then not period columns, and the narrow reader kept only the last of them —
 * eleven months gone without a word. So candidate rows are *scored* instead, and a key/value row
 * above the header is kept as a fact line rather than dropped or promoted.
 */
import type { FinanceSheetFact } from "./limits";
import { cellValue } from "./numbers";
import { isPeriodLabel } from "./periods";

/** How many rows from the top of a block may be the header. */
const HEADER_SEARCH_ROWS = 6;
/** A note is prose, not a figure: one long cell on its own line. */
const NOTE_PREFIX = /^(catatan|keterangan tambahan|note|notes)\b/i;
const NOTE_MIN_CHARS = 60;

export type CellKind = "empty" | "period" | "number" | "text";

export function cellKind(cell: string): CellKind {
  const text = cell.trim();
  if (text === "") {
    return "empty";
  }
  if (isPeriodLabel(text)) {
    return "period";
  }
  return cellValue(text) === null ? "text" : "number";
}

export function filledCount(row: ReadonlyArray<string>): number {
  return row.filter((cell) => cell.trim() !== "").length;
}

function kindsOf(row: ReadonlyArray<string>): CellKind[] {
  return row.map(cellKind);
}

/**
 * How much a row looks like the header of the rows under it: period cells count most, then the other
 * text cells, then every column the rows below fill with a figure. Its own figures count against it —
 * a header does not hold amounts.
 */
export function scoreHeaderRow(row: ReadonlyArray<string>, below: ReadonlyArray<ReadonlyArray<string>>): number {
  const kinds = kindsOf(row);
  if (kinds.filter((kind) => kind !== "empty").length < 2) {
    return Number.NEGATIVE_INFINITY;
  }
  const periods = kinds.filter((kind) => kind === "period").length;
  const texts = kinds.filter((kind) => kind === "text").length;
  const numbers = kinds.filter((kind) => kind === "number").length;
  const supported = kinds.reduce((total, kind, index) => {
    const filledBelow = below.filter((next) => cellKind(next[index] ?? "") === "number").length;
    return kind !== "empty" && filledBelow >= 2 ? total + 1 : total;
  }, 0);
  return periods * 4 + Math.max(0, texts - 1) - numbers * 3 + supported;
}

/**
 * The index of the row that reads as the header, searching only the first few rows of the block.
 * Each row down costs a point, so the header of a *second* table further down never outscores the
 * first one and takes the rows above it with it.
 */
export function findHeaderIndex(rows: ReadonlyArray<ReadonlyArray<string>>): number {
  const limit = Math.min(HEADER_SEARCH_ROWS, Math.max(rows.length - 1, 1));
  const scored = [...Array(limit).keys()].map((index) => ({
    index,
    score: scoreHeaderRow(rows[index] ?? [], rows.slice(index + 1, index + 12)) - index,
  }));
  const best = scored.reduce((winner, entry) => (entry.score > winner.score ? entry : winner), {
    index: 0,
    score: Number.NEGATIVE_INFINITY,
  });
  return Number.isFinite(best.score) ? best.index : 0;
}

/** True for a row that is one heading on its own ("BEBAN USAHA", "Aset Lancar"). */
export function isSectionHeading(row: ReadonlyArray<string>): boolean {
  const kinds = kindsOf(row);
  return kinds.filter((kind) => kind !== "empty").length === 1 && !kinds.includes("number");
}

/** True for a heading row that is really a sentence of prose. */
export function isNoteRow(row: ReadonlyArray<string>): boolean {
  const text = row.find((cell) => cell.trim() !== "")?.trim() ?? "";
  return isSectionHeading(row) && (NOTE_PREFIX.test(text) || text.length >= NOTE_MIN_CHARS);
}

/** An ALL-CAPS heading opens a new top-level section; a mixed-case one nests under it. */
export function headingDepth(text: string): 1 | 2 {
  const letters = text.replace(/[^A-Za-zÀ-ɏ]/g, "");
  return letters.length >= 2 && letters === letters.toUpperCase() ? 1 : 2;
}

/** The running "ASET / Aset Lancar" path after this heading is seen. */
export function pushHeading(path: ReadonlyArray<string>, text: string): string[] {
  return headingDepth(text) === 1 ? [text] : [...path.slice(0, 1), text];
}

export type SheetBlock = {
  /** The header row of this block. */
  readonly header: ReadonlyArray<string>;
  /** Everything under it, headings and notes included — the emitter decides what to do with them. */
  readonly body: ReadonlyArray<ReadonlyArray<string>>;
};

/**
 * A second table under the first one — a cash-and-burn block below the P&L, a reimbursement list
 * below a payroll run — has its own header and its own periods. Merging it into the table above
 * injects amounts into rows that never had them, so a row that reads as a *new* header (two or more
 * cells, none of them a figure, a different set of filled columns, and figures underneath) starts a
 * new block.
 */
export function splitBlocks(header: ReadonlyArray<string>, body: ReadonlyArray<ReadonlyArray<string>>): SheetBlock[] {
  const filledColumns = (row: ReadonlyArray<string>) =>
    row.flatMap((cell, index) => (cell.trim() === "" ? [] : [index])).join(",");
  const start = body.flatMap((row, index) => {
    const kinds = kindsOf(row);
    const isHeaderShape =
      index > 0 &&
      kinds.filter((kind) => kind !== "empty").length >= 2 &&
      !kinds.includes("number") &&
      filledColumns(row) !== filledColumns(header) &&
      body.slice(index + 1, index + 6).some((next) => kindsOf(next).includes("number"));
    return isHeaderShape ? [index] : [];
  });
  const bounds = [0, ...start, body.length];
  return bounds.slice(0, -1).map((from, at) => {
    const to = bounds[at + 1] ?? body.length;
    return at === 0
      ? { header, body: body.slice(from, to) }
      : { header: body[from] ?? [], body: body.slice(from + 1, to) };
  });
}

/** Key/value rows above the header ("Saldo awal (1 Jan 2024) | 45.000.000") become their own lines. */
export function sheetFacts(
  above: ReadonlyArray<ReadonlyArray<string>>,
  amount: (cell: string) => string | null,
): FinanceSheetFact[] {
  return above.flatMap((row) => {
    const filled = row.filter((cell) => cell.trim() !== "");
    const label = filled[0] ?? "";
    const value = amount(filled[1] ?? "");
    return filledCount(row) === 2 && value !== null && cellKind(label) === "text" ? [{ label, value }] : [];
  });
}

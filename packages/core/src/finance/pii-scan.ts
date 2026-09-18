/**
 * Column-aware PII scan for Finance inputs.
 *
 * Finance is the one studio whose prompt is almost entirely long digit runs, so the shared scanner
 * (`../security/pii.ts`) refuses anything it cannot justify without context. This file is where the
 * context exists: a sheet has headers, so a column titled `NIK` or `Nama` can be redacted wholesale
 * even though the same digits loose in a sentence would be left alone.
 *
 * A sheet is rarely one table, so the columns are read per *block*: a reimbursement list under a
 * payroll run has its own header and its own shape, and classifying it by the payroll header masked
 * its `Jumlah` amounts as `[npwp]` because column four of the block above was the tax number. The
 * importer already knows where the blocks are (`./import-table/layout.ts`), so this file asks it.
 *
 * Three invariants hold for every function here:
 *  - **Amounts are never touched.** A column the header calls money is not an identifying column,
 *    and a cell the importer's own number reader accepts is never rewritten by anything below —
 *    whatever a free-text regex thinks it sees in the digits.
 *  - **Nothing is mutated.** Rows, items and text come back as new values.
 *  - **A preview is redacted.** A hit reports where something was found, never what it said.
 */
import { PII_MASK, maskPii, scanPii, type PiiKind } from "../security/pii";
import { classifyFinanceHeader, pseudonymAllocator, type FinanceColumnKind } from "./pii-columns";
import { isDerivedLabel } from "./import-table/derived";
import { findHeaderIndex, splitBlocks } from "./import-table/layout";
import { cellValue } from "./import-table/numbers";
import type { LineItem } from "./types";

/** Longest redacted excerpt reported back. A preview is evidence of a hit, not a copy of it. */
export const FINANCE_PII_PREVIEW_MAX = 120;

export type FinancePiiHit = {
  kind: PiiKind;
  /** Sheet position: 0-based row (the header is row 0) and column, plus the header's own text. */
  cell?: { row: number; column: number; header: string };
  /** Position in figures text (0-based line) or in a line-item list (0-based item index). */
  line?: number;
  /** The redacted text, never the original. Previews are shown to the owner and written to no log. */
  preview: string;
};

export type FinancePiiScan<T> = { hits: FinancePiiHit[]; redacted: T };

export type FinancePiiInput =
  | { rows: ReadonlyArray<ReadonlyArray<string>> }
  | { figuresText: string }
  | { lineItems: ReadonlyArray<LineItem> };

/** Digits a value must have before a labelled line will accept it as that kind of identifier. */
const DIGIT_RANGE: Record<FinanceColumnKind, { min: number; max: number }> = {
  nik: { min: 16, max: 16 },
  npwp: { min: 15, max: 16 },
  account: { min: 8, max: 20 },
  phone: { min: 9, max: 15 },
  name: { min: 0, max: Number.POSITIVE_INFINITY },
  email: { min: 0, max: Number.POSITIVE_INFINITY },
};

function previewOf(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > FINANCE_PII_PREVIEW_MAX ? `${flat.slice(0, FINANCE_PII_PREVIEW_MAX)}…` : flat;
}

/**
 * A cell the importer would read as a figure.
 *
 * Deliberately not a shape of this file's own: the reader that decides what a number is when the
 * sheet is parsed (`./import-table/numbers.ts`) is the reader that decides what a number is when the
 * sheet is redacted, so the two can never drift apart. A hand-rolled pattern here is what let
 * `(Rp1.250.000)` read as free text. Whether a lone `1.250` means a thousand or a decimal does not
 * change *whether* it is a number, so the sheet's own style is not needed to answer this.
 */
function parsesAsAmount(value: string): boolean {
  return cellValue(value) !== null;
}

/** The kinds the shared scanner found in one piece of free text, in first-seen order. */
function freeTextKinds(value: string): PiiKind[] {
  return [...new Set(scanPii(value).map((finding) => finding.kind))];
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/**
 * A name or an email column never rewrites a figure: the header was wrong, the number is not. A row's
 * own total is not a person either — "TOTAL GAJI" pseudonymised to "Karyawan 9" reads as a ninth
 * employee, and the one word that said the row was a sum is gone.
 */
function redactColumnCell(value: string, kind: FinanceColumnKind, pseudonym: (name: string) => string): string {
  if (value.trim() === "" || ((kind === "name" || kind === "email") && parsesAsAmount(value))) {
    return value;
  }
  if (kind === "name" && isDerivedLabel(value)) {
    return value;
  }
  return kind === "name" ? pseudonym(value) : PII_MASK[kind];
}

/** What one block's header says about its own columns. No other block's rows ever read these. */
type ColumnRules = {
  readonly header: ReadonlyArray<string>;
  readonly kinds: ReadonlyArray<FinanceColumnKind | null>;
};

function columnRules(header: ReadonlyArray<string>): ColumnRules {
  return { header, kinds: header.map((cell) => classifyFinanceHeader(cell)) };
}

/**
 * One entry per row: the rules of the block that row sits in, or `null` for a row that has no
 * columns of its own — anything above the first header, and every header row itself. A header names
 * the columns, so it is never read as one of them and never carries a pseudonym.
 */
function rulesByRow(rows: ReadonlyArray<ReadonlyArray<string>>): Array<ColumnRules | null> {
  const headerAt = findHeaderIndex(rows);
  const blocks = splitBlocks(rows[headerAt] ?? [], rows.slice(headerAt + 1));
  const below = blocks.flatMap((block, at) => {
    const rules = columnRules(block.header);
    // Every block after the first opens with a header row of its own, which the split consumed.
    return [...(at === 0 ? [] : [null]), ...block.body.map(() => rules)];
  });
  return [...rows.slice(0, headerAt + 1).map(() => null), ...below];
}

/**
 * Which cells sit under a header that positively named an identifying column.
 *
 * The privacy guard's safety net reads this (`packages/host/src/finance-privacy.ts`): a `true` is
 * permission to rewrite the cell and nothing more, and every `false` cell that held a figure before
 * redaction has to still hold it after — whatever a later change to a pattern in here decides.
 */
export function financeIdentifierCells(rows: ReadonlyArray<ReadonlyArray<string>>): boolean[][] {
  const rules = rulesByRow(rows);
  return rows.map((row, index) => row.map((_cell, column) => (rules[index]?.kinds[column] ?? null) !== null));
}

type RowContext = {
  readonly rules: ColumnRules | null;
  readonly pseudonym: (name: string) => string;
};

function scanRow(row: ReadonlyArray<string>, rowIndex: number, context: RowContext, hits: FinancePiiHit[]): string[] {
  const { rules, pseudonym } = context;
  return row.map((cell, column) => {
    const where = { row: rowIndex, column, header: rules?.header[column] ?? "" };
    const kind = rules?.kinds[column] ?? null;
    if (kind) {
      const redacted = redactColumnCell(cell, kind, pseudonym);
      if (redacted !== cell) {
        hits.push({ kind, cell: where, preview: previewOf(redacted) });
      }
      return redacted;
    }
    // The column was not named as an identifier, so a cell that reads as a number is a figure and
    // nothing below may rewrite it. 2024 cost of sales, written `(23.960.000.000)` under a column
    // headed `2024`, reached the model as `[phone])` before this line existed: no word in that
    // header says "amount", so the cell fell through to free-text masking and lost its digits.
    if (parsesAsAmount(cell)) {
      return cell;
    }
    const masked = maskPii(cell);
    if (masked === cell) {
      return cell;
    }
    for (const found of freeTextKinds(cell)) {
      hits.push({ kind: found, cell: where, preview: previewOf(masked) });
    }
    return masked;
  });
}

/** One allocator for the whole sheet, so a person who reappears in a later block keeps their number. */
function scanRows(rows: ReadonlyArray<ReadonlyArray<string>>): FinancePiiScan<string[][]> {
  const rules = rulesByRow(rows);
  const pseudonym = pseudonymAllocator();
  const hits: FinancePiiHit[] = [];
  const redacted = rows.map((row, index) => scanRow(row, index, { rules: rules[index] ?? null, pseudonym }, hits));
  return { hits, redacted };
}

// ---------------------------------------------------------------------------------------------
// Figures text
// ---------------------------------------------------------------------------------------------

/** Below this a stray `|` in prose is not a table, and the per-line rules are the safer reading. */
const PIPE_TABLE_MIN_LINES = 2;

/**
 * `Nama karyawan: Budi` — the words before the colon are the only header a pasted line ever has.
 * The value has to fit the kind as well: "Karyawan 1 (Jan): 12000000" is a payroll amount, and a
 * label that happens to say "karyawan" must not cost it its digits.
 */
function redactLabelledLine(line: string): { text: string; kind: FinanceColumnKind } | null {
  const at = line.indexOf(":");
  if (at <= 0) {
    return null;
  }
  const kind = classifyFinanceHeader(line.slice(0, at));
  const value = line.slice(at + 1).trim();
  if (!kind || value === "") {
    return null;
  }
  if (kind === "name" || kind === "email" ? parsesAsAmount(value) : !fitsDigitRange(value, kind)) {
    return null;
  }
  return { text: `${line.slice(0, at + 1)} ${PII_MASK[kind]}`, kind };
}

function fitsDigitRange(value: string, kind: FinanceColumnKind): boolean {
  const digits = value.replace(/\D/g, "").length;
  return digits >= DIGIT_RANGE[kind].min && digits <= DIGIT_RANGE[kind].max;
}

/**
 * How much of a line the scanner may rewrite: the whole of it, only the label of `label: figure`, or
 * none of it when the line is a figure and nothing else. A person's name lives in the words, never
 * in the digits, so there is nothing to find on the value side and everything to lose.
 */
function scannablePart(line: string): string | null {
  const at = line.indexOf(":");
  if (at > 0 && parsesAsAmount(line.slice(at + 1))) {
    return line.slice(0, at);
  }
  return parsesAsAmount(line) ? null : line;
}

function scanPlainLine(line: string, index: number, hits: FinancePiiHit[]): string {
  const labelled = redactLabelledLine(line);
  if (labelled) {
    hits.push({ kind: labelled.kind, line: index, preview: previewOf(labelled.text) });
    return labelled.text;
  }
  const scannable = scannablePart(line);
  if (scannable === null) {
    return line;
  }
  const masked = maskPii(scannable);
  if (masked === scannable) {
    return line;
  }
  for (const found of freeTextKinds(scannable)) {
    hits.push({ kind: found, line: index, preview: previewOf(masked) });
  }
  return `${masked}${line.slice(scannable.length)}`;
}

/**
 * Figures text written as a wide table ("Label | 2024 | 2025") keeps its columns, so it is scanned
 * with the same header rules as a sheet. Lines without a pipe (the `Sheet: <name>` preamble) stay
 * where they are and go through the per-line rules instead.
 */
function scanFiguresText(text: string): FinancePiiScan<string> {
  const lines = text.split("\n");
  const pipedAt = lines.flatMap((line, index) => (line.includes("|") ? [index] : []));
  const hits: FinancePiiHit[] = [];
  if (pipedAt.length < PIPE_TABLE_MIN_LINES) {
    return { hits, redacted: lines.map((line, index) => scanPlainLine(line, index, hits)).join("\n") };
  }
  const table = scanRows(pipedAt.map((index) => (lines[index] ?? "").split("|").map((cell) => cell.trim())));
  const replaced = new Map(pipedAt.map((index, at) => [index, (table.redacted[at] ?? []).join(" | ")]));
  for (const hit of table.hits) {
    hits.push({ ...hit, line: hit.cell ? pipedAt[hit.cell.row] : hit.line });
  }
  return { hits, redacted: lines.map((line, index) => replaced.get(index) ?? scanPlainLine(line, index, hits)).join("\n") };
}

// ---------------------------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------------------------

/**
 * Confirmed line items carry no headers, so only the free-text fields are scanned and `amount` is
 * never read. A person's name that survived as prose inside a label survives here too — by design:
 * the place to catch it is the sheet it came from, where the column above it says what it is.
 */
function scanLineItems(items: ReadonlyArray<LineItem>): FinancePiiScan<LineItem[]> {
  const hits: FinancePiiHit[] = [];
  const redacted = items.map((item, index) => {
    const label = maskPii(item.label);
    const period = maskPii(item.period);
    if (label === item.label && period === item.period) {
      return item;
    }
    for (const kind of new Set([...freeTextKinds(item.label), ...freeTextKinds(item.period)])) {
      hits.push({ kind, line: index, preview: previewOf(`${label} ${period}`) });
    }
    return { ...item, label, period };
  });
  return { hits, redacted };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export function scanFinanceTablePii(input: { rows: ReadonlyArray<ReadonlyArray<string>> }): FinancePiiScan<string[][]>;
export function scanFinanceTablePii(input: { figuresText: string }): FinancePiiScan<string>;
export function scanFinanceTablePii(input: { lineItems: ReadonlyArray<LineItem> }): FinancePiiScan<LineItem[]>;
export function scanFinanceTablePii(
  input: FinancePiiInput,
): FinancePiiScan<string[][]> | FinancePiiScan<string> | FinancePiiScan<LineItem[]> {
  if ("rows" in input) {
    return scanRows(input.rows);
  }
  if ("figuresText" in input) {
    return scanFiguresText(input.figuresText);
  }
  return scanLineItems(input.lineItems);
}

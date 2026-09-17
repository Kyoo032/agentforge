/**
 * File bytes to sheets of plain strings.
 *
 * Rules that keep an upload untrusted: formulas are never evaluated (SheetJS hands back the cached
 * value only), every cell is treated as text (control characters stripped, length capped), and the
 * byte / sheet / row / column caps are enforced before any of it is materialised.
 *
 * What changed: the rows above the header are no longer thrown away. A title row on its own still
 * goes, but `Saldo awal (1 Jan 2024) | 45.000.000` is a figure someone wrote down, so it comes back
 * on the sheet as a `fact` — kept out of `rows` so the first row is still the real header.
 */
import * as XLSX from "xlsx";
import { sniffDelimiter, tokenize } from "../../tabular/parse-delimited";
import {
  FINANCE_IMPORT_EXTENSIONS,
  FINANCE_IMPORT_MAX_BYTES,
  FINANCE_IMPORT_MAX_CELL_CHARS,
  FINANCE_IMPORT_MAX_COLS,
  FINANCE_IMPORT_MAX_ROWS,
  FINANCE_IMPORT_MAX_SHEETS,
  FinanceImportError,
  type FinanceImportExtension,
  type FinanceImportWarning,
  type FinanceSheet,
  type FinanceTableFile,
} from "./limits";
import { findHeaderIndex, sheetFacts } from "./layout";
import { normalizeAmount, sheetNumberStyle } from "./numbers";

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];
/** Anything below the space, plus DEL: sheet junk that must never reach a prompt or the screen. */
const LAST_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;
const BOM = "﻿";

/** `.csv`, `.xlsx` or `.xls` from the filename's real ending, or null for anything else. */
export function financeImportExtension(filename: string): FinanceImportExtension | null {
  const lower = filename.trim().toLowerCase();
  return FINANCE_IMPORT_EXTENSIONS.find((extension) => lower.endsWith(extension)) ?? null;
}

/** Magic-byte check: `zip` for OOXML (`.xlsx`), `cfb` for the legacy OLE `.xls`, null for anything else. */
export function financeWorkbookKind(bytes: Uint8Array): "zip" | "cfb" | null {
  const matches = (magic: readonly number[]) => magic.every((byte, index) => bytes[index] === byte);
  if (matches(ZIP_MAGIC)) {
    return "zip";
  }
  return matches(CFB_MAGIC) ? "cfb" : null;
}

function isControlChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code <= LAST_CONTROL_CODE || code === DELETE_CODE;
}

/** One cell, cleaned, and whether {@link FINANCE_IMPORT_MAX_CELL_CHARS} had to cut it. */
type CleanCell = { readonly text: string; readonly capped: boolean };

/** Every cell is untrusted text: control characters out, whitespace collapsed, length capped. */
function cleanCellPart(raw: string): CleanCell {
  const text = [...raw]
    .map((char) => (isControlChar(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > FINANCE_IMPORT_MAX_CELL_CHARS
    ? { text: text.slice(0, FINANCE_IMPORT_MAX_CELL_CHARS).trim(), capped: true }
    : { text, capped: false };
}

/** The cleaned text alone, for the places where a cut is not something the owner lost (sheet names). */
function cleanCell(raw: string): string {
  return cleanCellPart(raw).text;
}

function filledCount(row: ReadonlyArray<string>): number {
  return row.filter((cell) => cell !== "").length;
}

/** Columns that are empty in every row carry nothing; they are dropped before the caps are checked. */
function withoutEmptyColumns(rows: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const keep = [...Array(width).keys()].filter((index) => rows.some((row) => (row[index] ?? "") !== ""));
  return rows.map((row) => keep.map((index) => row[index] ?? ""));
}

type Split = { readonly rows: string[][]; readonly facts: { label: string; value: string }[] };

/** One sheet plus the count of its cells the cell cap cut, which no public shape carries. */
type ReadSheet = { readonly sheet: FinanceSheet; readonly capped: number };

/**
 * Leading title / merged-header rows ("PT Toko Token", "Monthly figures") carry one cell each and go.
 * A key/value row above the header keeps its figure as a fact instead of being dropped — or, worse,
 * promoted to the header, which is what used to cost a cash book eleven of its twelve months.
 */
function splitAboveHeader(rows: ReadonlyArray<string[]>): Split {
  const header = findHeaderIndex(rows);
  if (header <= 0) {
    return { rows: rows.map((row) => [...row]), facts: [] };
  }
  const above = rows.slice(0, header);
  const style = sheetNumberStyle(rows);
  return {
    rows: rows.slice(header).map((row) => [...row]),
    facts: sheetFacts(above, (cell) => normalizeAmount(cell, style)),
  };
}

type CleanedRows = Split & { readonly capped: number };

function cleanRows(raw: ReadonlyArray<ReadonlyArray<string>>, sheet: string): CleanedRows {
  const parts = raw.map((row) => row.map(cleanCellPart));
  const capped = parts.reduce((sum, row) => sum + row.filter((cell) => cell.capped).length, 0);
  const cleaned = parts.map((row) => row.map((cell) => cell.text));
  const split = splitAboveHeader(withoutEmptyColumns(cleaned).filter((row) => filledCount(row) > 0));
  const width = split.rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width > FINANCE_IMPORT_MAX_COLS) {
    throw new FinanceImportError("too_large", `"${sheet}" has more than ${FINANCE_IMPORT_MAX_COLS} columns of figures`);
  }
  if (split.rows.length > FINANCE_IMPORT_MAX_ROWS) {
    throw new FinanceImportError("too_large", `"${sheet}" has more than ${FINANCE_IMPORT_MAX_ROWS} rows`);
  }
  return {
    ...split,
    capped,
    rows: split.rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]),
  };
}

function sheetNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const cleaned = cleanCell(base.replace(/\.[^.]+$/, ""));
  return cleaned === "" ? "Sheet1" : cleaned;
}

function readCsvSheets(bytes: Uint8Array, filename: string): ReadSheet[] {
  const text = new TextDecoder("utf-8").decode(bytes).replace(new RegExp(`^${BOM}`), "");
  const delimiter = sniffDelimiter(text);
  // One more record than the cap so a file over it is refused rather than silently cut.
  const raw = tokenize(text, delimiter, FINANCE_IMPORT_MAX_ROWS + 1);
  const name = sheetNameFromFilename(filename);
  const { capped, ...split } = cleanRows(raw, name);
  return [{ sheet: { name, ...split }, capped }];
}

/** SheetJS reads cached values only: no formula is ever evaluated and no VBA is loaded. */
function openWorkbook(bytes: Uint8Array): XLSX.WorkBook {
  try {
    return XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellFormula: false,
      cellHTML: false,
      bookVBA: false,
      sheetRows: FINANCE_IMPORT_MAX_ROWS + 1,
    });
  } catch {
    throw new FinanceImportError("unreadable", "That workbook could not be opened");
  }
}

function readWorkbookSheets(bytes: Uint8Array): ReadSheet[] {
  const workbook = openWorkbook(bytes);
  if (workbook.SheetNames.length > FINANCE_IMPORT_MAX_SHEETS) {
    throw new FinanceImportError("too_large", `That workbook has more than ${FINANCE_IMPORT_MAX_SHEETS} sheets`);
  }
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const raw = sheet
      ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false })
      : [];
    const rows = raw.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
    const { capped, ...split } = cleanRows(rows, name);
    return { sheet: { name: cleanCell(name) || "Sheet", ...split }, capped };
  });
}

function requireContainer(extension: FinanceImportExtension, bytes: Uint8Array): void {
  const kind = financeWorkbookKind(bytes);
  if (extension === ".csv" && kind !== null) {
    throw new FinanceImportError("unsupported_type", "That .csv file is a workbook; save it as .xlsx and try again");
  }
  if (extension === ".xlsx" && kind !== "zip") {
    throw new FinanceImportError("unsupported_type", "That .xlsx file is not an Excel workbook");
  }
  if (extension === ".xls" && kind === null) {
    throw new FinanceImportError("unsupported_type", "That .xls file is not an Excel workbook");
  }
}

/** A sheet with a header but no rows under it is not an error; it just has nothing to import. */
function sheetWarnings(dropped: ReadonlyArray<FinanceSheet>): FinanceImportWarning[] {
  return dropped.length === 0
    ? []
    : [
        {
          code: "dropped_rows",
          message: `${dropped.length} sheets had no rows of figures and were not imported`,
          detail: dropped.map((sheet) => sheet.name),
        },
      ];
}

/**
 * The other half of {@link FINANCE_IMPORT_MAX_CELL_CHARS}: a cut cell is told, not lost in silence.
 *
 * One line for the whole file, counted the way the truncation warning counts lines, so the screen
 * reads "12 cells were too long and were shortened" rather than listing every label it shortened.
 */
function cappedCellWarnings(capped: number): FinanceImportWarning[] {
  return capped === 0
    ? []
    : [
        {
          code: "capped_cells",
          message: `${capped} cells were longer than ${FINANCE_IMPORT_MAX_CELL_CHARS} characters and were shortened`,
          detail: [`${capped} cells`],
        },
      ];
}

/**
 * Read an upload into sheets of plain strings. Throws {@link FinanceImportError} for an extension we
 * do not take, bytes that are not what the name claims, a file over a cap, or a file with no rows.
 */
export function readFinanceTable(bytes: Uint8Array, filename: string): FinanceTableFile {
  const extension = financeImportExtension(filename);
  if (!extension) {
    throw new FinanceImportError("unsupported_type", "Only .csv, .xlsx and .xls files can be read as figures");
  }
  if (bytes.byteLength > FINANCE_IMPORT_MAX_BYTES) {
    throw new FinanceImportError("too_large", `That file is over the ${FINANCE_IMPORT_MAX_BYTES / 1_000_000} MB cap`);
  }
  if (bytes.byteLength === 0) {
    throw new FinanceImportError("empty", "That file is empty");
  }
  requireContainer(extension, bytes);
  const all = extension === ".csv" ? readCsvSheets(bytes, filename) : readWorkbookSheets(bytes);
  const kept = all.filter((read) => read.sheet.rows.length >= 2);
  if (kept.length === 0) {
    throw new FinanceImportError("empty", "No rows of figures were found in that file");
  }
  // Only the kept sheets: a cell cut on a sheet nobody imports is not something the owner lost.
  const capped = kept.reduce((sum, read) => sum + read.capped, 0);
  return {
    sheets: kept.map((read) => read.sheet),
    warnings: [
      ...sheetWarnings(all.filter((read) => read.sheet.rows.length < 2).map((read) => read.sheet)),
      ...cappedCellWarnings(capped),
    ],
  };
}

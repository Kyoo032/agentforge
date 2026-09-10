/**
 * Workbook writer over SheetJS. One entry point: rows in, `.xlsx` bytes out.
 * Callers pass plain arrays of arrays; nothing here is mutated after creation.
 */
import * as XLSX from "xlsx";

export type WorkbookCell = string | number | null;

export type WorkbookSheet = {
  /** Sheet tab name. Sanitised to Excel's rules (31 chars, no `[]:*?/\`). */
  name: string;
  /** Row-major cells. The first row is conventionally the header. */
  rows: readonly (readonly WorkbookCell[])[];
  /** Column widths in characters, one per column; missing entries use the Excel default. */
  widths?: readonly number[];
};

/** Excel refuses tab names longer than this. */
export const MAX_SHEET_NAME_CHARS = 31;
const SHEET_NAME_FORBIDDEN = /[[\]:*?/\\]/g;
const DEFAULT_SHEET_NAME = "Sheet";

/** Excel-safe sheet name: forbidden characters replaced, trimmed, capped, never empty. */
export function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(SHEET_NAME_FORBIDDEN, " ").trim().slice(0, MAX_SHEET_NAME_CHARS).trim();
  return cleaned === "" ? DEFAULT_SHEET_NAME : cleaned;
}

/** Ensures duplicate tab names get a numeric suffix so `book_append_sheet` does not throw. */
function uniqueSheetNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const base = sanitizeSheetName(name);
    const suffixed = (attempt: number): string =>
      attempt === 0 ? base : `${base.slice(0, MAX_SHEET_NAME_CHARS - String(attempt).length - 1)} ${attempt}`;
    const chosen = [...Array(taken.size + 1).keys()].map(suffixed).find((candidate) => !taken.has(candidate));
    const label = chosen ?? suffixed(taken.size);
    taken.add(label);
    return label;
  });
}

function toWorksheet(sheet: WorkbookSheet): XLSX.WorkSheet {
  const rows = sheet.rows.map((row) => row.map((cell) => cell ?? ""));
  const worksheet = XLSX.utils.aoa_to_sheet(rows.length > 0 ? rows : [[]]);
  if (!sheet.widths || sheet.widths.length === 0) {
    return worksheet;
  }
  return { ...worksheet, "!cols": sheet.widths.map((wch) => ({ wch })) };
}

/**
 * Builds an `.xlsx` workbook from plain rows. Throws a RangeError when no sheets are given,
 * since an empty workbook is not a valid Excel file.
 */
export function writeWorkbook(sheets: readonly WorkbookSheet[]): Uint8Array {
  if (sheets.length === 0) {
    throw new RangeError("writeWorkbook requires at least one sheet");
  }
  const names = uniqueSheetNames(sheets.map((sheet) => sheet.name));
  const workbook = XLSX.utils.book_new();
  sheets.forEach((sheet, index) => {
    XLSX.utils.book_append_sheet(workbook, toWorksheet(sheet), names[index]);
  });
  const buffer: ArrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Uint8Array(buffer);
}

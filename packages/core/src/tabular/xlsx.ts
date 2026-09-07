import * as XLSX from "xlsx";
import { tableFromRows } from "./parse-delimited";
import type { TabularTable } from "./types";

/** Tables read from workbooks report a tab delimiter (the natural text form of a sheet). */
export const XLSX_DELIMITER = "\t";

/** Hard cap on workbook bytes handed to SheetJS. Callers map the RangeError to 413. */
export const MAX_WORKBOOK_BYTES = 25_000_000;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

/** True for a ZIP container (`.xlsx`/`.xlsm`) or an OLE compound file (legacy `.xls`). */
export function isWorkbookBytes(bytes: Uint8Array): boolean {
  return [ZIP_MAGIC, CFB_MAGIC].some((magic) => magic.every((byte, index) => bytes[index] === byte));
}

/** Only real workbook containers are read; SheetJS would otherwise guess a text format and invent a sheet. */
function readWorkbook(bytes: Uint8Array, maxRows?: number): XLSX.WorkBook | null {
  if (bytes.byteLength > MAX_WORKBOOK_BYTES) {
    throw new RangeError(`Workbook exceeds ${MAX_WORKBOOK_BYTES.toLocaleString()} bytes`);
  }
  if (!isWorkbookBytes(bytes)) {
    return null;
  }
  try {
    // sheetRows bounds how much of each sheet SheetJS materializes (header + maxRows); 0 means all.
    return XLSX.read(bytes, { type: "array", cellDates: true, sheetRows: maxRows === undefined ? 0 : maxRows + 1 });
  } catch {
    return null;
  }
}

function pickSheet(workbook: XLSX.WorkBook, sheet: string | number | undefined): XLSX.WorkSheet | null {
  const name = typeof sheet === "number" ? workbook.SheetNames[sheet] : (sheet ?? workbook.SheetNames[0]);
  return name === undefined ? null : (workbook.Sheets[name] ?? null);
}

function sheetRows(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  return rows.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

export function listXlsxSheets(bytes: Uint8Array): string[] {
  const workbook = readWorkbook(bytes);
  return workbook ? [...workbook.SheetNames] : [];
}

export function parseXlsx(
  bytes: Uint8Array,
  options?: { sheet?: string | number; maxRows?: number },
): TabularTable | null {
  const workbook = readWorkbook(bytes, options?.maxRows);
  const sheet = workbook ? pickSheet(workbook, options?.sheet) : null;
  if (!sheet) {
    return null;
  }
  return tableFromRows(sheetRows(sheet), XLSX_DELIMITER, options?.maxRows);
}

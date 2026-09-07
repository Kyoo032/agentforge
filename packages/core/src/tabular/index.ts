import { escapeMarkdownCell, markdownRow } from "./profile";
import { parseDelimited } from "./parse-delimited";
import type { TabularTable } from "./types";
import { isWorkbookBytes, parseXlsx } from "./xlsx";

export type { CellType, ColumnProfile, ColumnType, TableProfile, TabularTable, TypedCell, TypedTable } from "./types";
export {
  DELIMITERS,
  MAX_TABULAR_CHARS,
  parseDelimited,
  sniffDelimiter,
  tableFromRows,
  tokenize,
} from "./parse-delimited";
export type { ParseDelimitedOptions } from "./parse-delimited";
export {
  TYPE_THRESHOLD,
  classifyCell,
  coerceCell,
  columnCells,
  inferColumnType,
  isEmptyCell,
  parseBoolean,
  parseDate,
  parseNumber,
  toTypedTable,
} from "./infer-types";
export {
  escapeMarkdownCell,
  formatNumber,
  markdownRow,
  profileColumn,
  profileTable,
  profileToMarkdown,
} from "./profile";
export { summarizeNumbers } from "./stats";
export type { NumberSummary } from "./stats";
export { MAX_WORKBOOK_BYTES, XLSX_DELIMITER, isWorkbookBytes, listXlsxSheets, parseXlsx } from "./xlsx";

const WORKBOOK_EXTENSIONS = [".xlsx", ".xlsm", ".xls"];
const DEFAULT_SAMPLE_ROWS = 20;
const CSV_QUOTE_NEEDED = /[",\r\n]/;

function hasWorkbookExtension(filename: string | undefined): boolean {
  const lower = filename?.toLowerCase() ?? "";
  return WORKBOOK_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export type ParseTabularInput = { text?: string; bytes?: Uint8Array; filename?: string; maxRows?: number };

/** Routes to the workbook reader for `.xlsx`/`.xlsm`/`.xls` names or workbook magic bytes, else to the delimited parser. */
export function parseTabular(input: ParseTabularInput): TabularTable | null {
  const { text, bytes, filename, maxRows } = input;
  if (bytes && (hasWorkbookExtension(filename) || isWorkbookBytes(bytes))) {
    return parseXlsx(bytes, { maxRows });
  }
  const source = text ?? (bytes ? new TextDecoder("utf-8").decode(bytes) : undefined);
  return source === undefined ? null : parseDelimited(source, { maxRows });
}

function csvField(value: string): string {
  return CSV_QUOTE_NEEDED.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC-4180 comma-separated text (LF line endings), whatever delimiter the table was read with. */
export function tableToCsv(table: TabularTable): string {
  return [table.headers, ...table.rows].map((row) => row.map(csvField).join(",")).join("\n");
}

/** Markdown table of the first `maxRows` rows; pipes are escaped and newlines flattened. */
export function tableSample(table: TabularTable, maxRows = DEFAULT_SAMPLE_ROWS): string {
  const body = table.rows.slice(0, Math.max(0, maxRows)).map((row) => row.map(escapeMarkdownCell));
  const lines = [
    markdownRow(table.headers.map(escapeMarkdownCell)),
    markdownRow(table.headers.map(() => "---")),
    ...body.map(markdownRow),
  ];
  return lines.join("\n");
}

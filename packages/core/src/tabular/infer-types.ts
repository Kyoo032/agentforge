import { parseDate } from "./parse-date";
import { parseNumber } from "./parse-number";
import type { CellType, ColumnType, TabularTable, TypedCell, TypedTable } from "./types";

export { parseDate } from "./parse-date";
export { parseNumber } from "./parse-number";

/** Share of non-empty cells that must agree on a type before the column takes it. */
export const TYPE_THRESHOLD = 0.9;

const EMPTY_TOKENS = new Set(["", "na", "n/a", "null", "-"]);
const TRUE_TOKENS = new Set(["true", "yes", "y"]);
const FALSE_TOKENS = new Set(["false", "no", "n"]);
const CANDIDATE_TYPES: ReadonlyArray<Exclude<ColumnType, "string">> = ["number", "date", "boolean"];

export function isEmptyCell(raw: string): boolean {
  return EMPTY_TOKENS.has(raw.trim().toLowerCase());
}

export function parseBoolean(raw: string): boolean | null {
  const token = raw.trim().toLowerCase();
  if (TRUE_TOKENS.has(token)) {
    return true;
  }
  return FALSE_TOKENS.has(token) ? false : null;
}

export function classifyCell(raw: string): CellType {
  if (isEmptyCell(raw)) {
    return "empty";
  }
  if (parseBoolean(raw) !== null) {
    return "boolean";
  }
  if (parseNumber(raw) !== null) {
    return "number";
  }
  return parseDate(raw) !== null ? "date" : "string";
}

export function inferColumnType(cells: ReadonlyArray<string>): ColumnType {
  const classes = cells.map(classifyCell).filter((type) => type !== "empty");
  if (classes.length === 0) {
    return "string";
  }
  const winner = CANDIDATE_TYPES.find(
    (type) => classes.filter((cellType) => cellType === type).length / classes.length >= TYPE_THRESHOLD,
  );
  return winner ?? "string";
}

/**
 * Empty tokens → null. number → parsed value or null; boolean → true/false or null;
 * date → ISO string, or the raw text when it does not parse; string → raw text.
 */
export function coerceCell(raw: string, type: ColumnType): TypedCell {
  if (isEmptyCell(raw)) {
    return null;
  }
  switch (type) {
    case "number":
      return parseNumber(raw);
    case "boolean":
      return parseBoolean(raw);
    case "date":
      return parseDate(raw) ?? raw;
    default:
      return raw;
  }
}

export function columnCells(table: TabularTable, index: number): string[] {
  return table.rows.map((row) => row[index] ?? "");
}

export function toTypedTable(table: TabularTable): TypedTable {
  const types = table.headers.map((_, index) => inferColumnType(columnCells(table, index)));
  const rows = table.rows.map((row) => row.map((cell, index) => coerceCell(cell, types[index] ?? "string")));
  return { headers: [...table.headers], types, rows };
}

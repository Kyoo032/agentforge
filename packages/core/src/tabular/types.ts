export type CellType = "number" | "date" | "boolean" | "string" | "empty";

export type ColumnType = "number" | "date" | "boolean" | "string";

/**
 * A parsed table of raw, trimmed strings. Every row has exactly `headers.length` cells;
 * `ragged` is true when any source row had a different width before padding/truncation.
 */
export type TabularTable = {
  headers: string[];
  rows: string[][];
  delimiter: string;
  ragged: boolean;
};

export type ColumnProfile = {
  name: string;
  type: ColumnType;
  nulls: number;
  distinct: number;
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  stddev?: number;
  topK: Array<{ value: string; count: number }>;
};

export type TableProfile = {
  rowCount: number;
  columnCount: number;
  columns: ColumnProfile[];
};

export type TypedCell = number | string | boolean | null;

export type TypedTable = {
  headers: string[];
  types: ColumnType[];
  rows: Array<Array<TypedCell>>;
};

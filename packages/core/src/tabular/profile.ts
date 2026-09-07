import { columnCells, inferColumnType, isEmptyCell, parseDate, parseNumber } from "./infer-types";
import { summarizeNumbers } from "./stats";
import type { ColumnProfile, ColumnType, TableProfile, TabularTable } from "./types";

const DEFAULT_TOP_K = 5;
const NUMBER_DECIMALS = 4;
const MARKDOWN_HEADERS = ["Column", "Type", "Nulls", "Distinct", "Min", "Max", "Mean", "Top values"];

type Stats = Pick<ColumnProfile, "min" | "max" | "mean" | "median" | "stddev">;

function countValues(values: ReadonlyArray<string>): Map<string, number> {
  return values.reduce((acc, value) => acc.set(value, (acc.get(value) ?? 0) + 1), new Map<string, number>());
}

/** Most frequent values; ties keep first-appearance order (Map insertion order + stable sort). */
function topValues(counts: Map<string, number>, limit: number): ColumnProfile["topK"] {
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function numberStats(values: ReadonlyArray<string>): Stats {
  const numbers = values.map(parseNumber).filter((value): value is number => value !== null);
  return summarizeNumbers(numbers) ?? {};
}

function dateStats(values: ReadonlyArray<string>): Stats {
  const dates = values.map(parseDate).filter((value): value is string => value !== null);
  if (dates.length === 0) {
    return {};
  }
  const sorted = [...dates].sort();
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

function statsFor(type: ColumnType, values: ReadonlyArray<string>): Stats {
  if (type === "number") {
    return numberStats(values);
  }
  return type === "date" ? dateStats(values) : {};
}

export function profileColumn(name: string, cells: ReadonlyArray<string>, options?: { topK?: number }): ColumnProfile {
  const type = inferColumnType(cells);
  const present = cells.filter((cell) => !isEmptyCell(cell));
  const counts = countValues(present);
  return {
    name,
    type,
    nulls: cells.length - present.length,
    distinct: counts.size,
    ...statsFor(type, present),
    topK: topValues(counts, options?.topK ?? DEFAULT_TOP_K),
  };
}

export function profileTable(table: TabularTable, options?: { topK?: number }): TableProfile {
  return {
    rowCount: table.rows.length,
    columnCount: table.headers.length,
    columns: table.headers.map((name, index) => profileColumn(name, columnCells(table, index), options)),
  };
}

/** Up to four decimals, trailing zeros removed (`2`, `2.5`, `0.3333`). */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  const rounded = Number(value.toFixed(NUMBER_DECIMALS));
  return String(rounded === 0 ? 0 : rounded);
}

export function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n|\r/g, " ");
}

function formatStat(value: number | string | undefined): string {
  if (value === undefined) {
    return "";
  }
  return typeof value === "number" ? formatNumber(value) : escapeMarkdownCell(value);
}

function profileRow(column: ColumnProfile): string[] {
  const top = column.topK.map((entry) => `${escapeMarkdownCell(entry.value)} (${entry.count})`).join(", ");
  return [
    escapeMarkdownCell(column.name),
    column.type,
    String(column.nulls),
    String(column.distinct),
    formatStat(column.min),
    formatStat(column.max),
    formatStat(column.mean),
    top,
  ];
}

export function markdownRow(cells: ReadonlyArray<string>): string {
  return `| ${cells.join(" | ")} |`;
}

export function profileToMarkdown(profile: TableProfile): string {
  const separator = MARKDOWN_HEADERS.map(() => "---");
  const lines = [
    markdownRow(MARKDOWN_HEADERS),
    markdownRow(separator),
    ...profile.columns.map(profileRow).map(markdownRow),
  ];
  return lines.join("\n");
}

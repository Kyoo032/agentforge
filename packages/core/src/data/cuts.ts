import type { ColumnProfile, TableProfile } from "../tabular/types";

/** At most this many cuts. A person who brought no method does not get every textbook pass. */
export const DATA_CUT_LIMIT = 3;

export type DataCutKind = "compare" | "over_time" | "split" | "blanks" | "rows";

export type DataAggregate = "sum" | "avg" | "count";

export type PlannedCut = {
  kind: DataCutKind;
  /** Original column headers from the profile. Empty for a whole-sheet row count. */
  columns: string[];
  aggregate: DataAggregate;
};

/** A method the sheet cannot support. The cuts still run; the wording must not invent this. */
export type SheetLimit = "forecast" | "other_table";

const FORECAST =
  /\b(forecast|predict|prediction|regression|p-value|p value|statistically significant|confidence interval|prakiraan|prediksi|regresi)\b/i;
const OTHER_TABLE =
  /\b(another (?:table|file|sheet|spreadsheet)|other (?:table|file|sheet)|second (?:table|file|sheet)|tabel lain|file lain|lembar lain)\b/i;
const AVERAGE = /\b(average|mean|avg|rata-rata|rataan)\b/i;
const BLANKS = /\b(blank|missing|null|empty cells?|kosong|hilang)\b/i;

export function sheetLimit(question: string): SheetLimit | null {
  if (FORECAST.test(question)) {
    return "forecast";
  }
  if (OTHER_TABLE.test(question)) {
    return "other_table";
  }
  return null;
}

export function aggregateFor(question: string): DataAggregate {
  return AVERAGE.test(question) ? "avg" : "sum";
}

function named(question: string, column: ColumnProfile): boolean {
  const name = column.name.trim();
  if (name.length < 2) {
    return false;
  }
  return question.toLowerCase().includes(name.toLowerCase());
}

function isCategory(column: ColumnProfile, rowCount: number): boolean {
  if (column.type !== "string" && column.type !== "boolean") {
    return false;
  }
  if (column.distinct < 2 || column.distinct > 40) {
    return false;
  }
  return !(rowCount > 40 && column.distinct === rowCount);
}

function isMeasure(column: ColumnProfile): boolean {
  return column.type === "number" && column.distinct > 0;
}

function isDate(column: ColumnProfile): boolean {
  return column.type === "date" && column.distinct > 0;
}

function preferNamed(question: string, columns: ColumnProfile[]): ColumnProfile | undefined {
  return columns.find((column) => named(question, column)) ?? columns[0];
}

/**
 * The cuts this sheet can honestly answer, chosen from column types.
 * A named column in the question wins; otherwise comparison, then time, then blanks.
 */
export function planDataCuts(profile: TableProfile, question: string): PlannedCut[] {
  const categories = profile.columns.filter((column) => isCategory(column, profile.rowCount));
  const measures = profile.columns.filter(isMeasure);
  const dates = profile.columns.filter(isDate);
  const blankColumns = profile.columns.filter((column) => column.nulls > 0).slice(0, 12);
  const aggregate = aggregateFor(question);
  const category = preferNamed(question, categories);
  const measure = preferNamed(question, measures);
  const date = preferNamed(question, dates);

  const candidates: Array<{ cut: PlannedCut; score: number }> = [];
  if (category && measure) {
    candidates.push({
      cut: { kind: "compare", columns: [category.name, measure.name], aggregate },
      score: 3 + (named(question, category) ? 3 : 0) + (named(question, measure) ? 1 : 0),
    });
  }
  if (date && measure) {
    candidates.push({
      cut: { kind: "over_time", columns: [date.name, measure.name], aggregate },
      score: 2 + (named(question, date) ? 3 : 0) + (named(question, measure) ? 1 : 0),
    });
  }
  if (category && !measure) {
    candidates.push({
      cut: { kind: "split", columns: [category.name], aggregate: "count" },
      score: 3 + (named(question, category) ? 3 : 0),
    });
  }
  if (blankColumns.length > 0) {
    candidates.push({
      cut: {
        kind: "blanks",
        columns: blankColumns.map((column) => column.name),
        aggregate: "count",
      },
      score: BLANKS.test(question) ? 4 : 1,
    });
  }
  if (candidates.length === 0) {
    candidates.push({ cut: { kind: "rows", columns: [], aggregate: "count" }, score: 1 });
  }

  const namedColumns = profile.columns.filter((column) => named(question, column)).map((column) => column.name);
  let ranked = candidates;
  if (namedColumns.length > 0) {
    const focused = candidates.filter((item) => item.cut.columns.some((name) => namedColumns.includes(name)));
    if (focused.length > 0) {
      ranked = focused;
    }
  }
  ranked.sort((a, b) => b.score - a.score);

  const picked: PlannedCut[] = [];
  for (const item of ranked) {
    if (picked.length >= DATA_CUT_LIMIT) {
      break;
    }
    if (picked.some((cut) => cut.kind === item.cut.kind)) {
      continue;
    }
    picked.push(item.cut);
  }
  return picked;
}

/**
 * Which header cells name a period.
 *
 * Named periods ("Jan", "Mei 2024", "Q1 2023", "FY2024", "2024-01") are one half. The other half is
 * the *ordinal* header a projection or a budget writes — "Tahun 0", "Year 10", "Bulan 1", "Q1 Budget",
 * "Q1 Actual". Those used to fall between the wide and the narrow reader and the sheet was dumped raw,
 * so a "(1,450,000,000)" reached the prompt with its brackets and its commas still on it.
 *
 * A trailing word on an ordinal header is a scenario, not part of the period: "Q1 Budget" is Q1 under
 * the budget, "Q1 Actual" is the same Q1 under the actuals. Both are kept so a later task can tell the
 * two columns apart instead of averaging them.
 */

const MONTH_WORDS = [
  "jan(?:uari|uary)?",
  "feb(?:ruari|ruary)?",
  "mar(?:et|ch)?",
  "apr(?:il)?",
  "may",
  "mei",
  "jun(?:i|e)?",
  "jul(?:i|y)?",
  "aug(?:ust)?",
  "agu(?:stus)?",
  "ags",
  "agt",
  "sep(?:t|tember)?",
  "oct(?:ober)?",
  "okt(?:ober)?",
  "nov(?:ember)?",
  "dec(?:ember)?",
  "des(?:ember)?",
].join("|");
const MONTH_LABEL = new RegExp(`^(?:${MONTH_WORDS})\\.?(?:[ \\-/']*(?:19|20)?\\d{2})?$`, "i");
const QUARTER_LABEL = /^(?:q|tw|kuartal|quarter|triwulan)[ -]?[1-4](?:[ \-/]*(?:19|20)?\d{2})?$/i;
const YEAR_LABEL = /^(?:fy|ty|thn)?[ ]*(?:19|20)\d{2}(?:[ \-/]*(?:19|20)?\d{2})?$/i;
const ISO_MONTH_LABEL = /^(?:19|20)\d{2}[-/](?:0?[1-9]|1[0-2])$/;
/** Header words that name a period column even when the cells hold the period itself. */
const PERIOD_HEADER = /period|periode|date|tanggal|month|bulan|quarter|kuartal|triwulan|year|tahun|^fy$/i;

/** "Tahun 0", "Year 10", "Bulan 1", "Q1 Budget" — a unit plus its ordinal, plus an optional scenario. */
const ORDINAL_UNITS = "tahun|thn|year|yr|periode|period|bulan|month|mo|minggu|week|kuartal|quarter|triwulan|tw|q";
const ORDINAL_PERIOD = new RegExp(`^(${ORDINAL_UNITS})\\s*[-‑–]?\\s*(\\d{1,4})\\b[ \\-/]*(.*)$`, "i");
/** The words a budget sheet puts after the period to say which version of it a column holds. */
const SCENARIO_WORDS =
  /^(budget|anggaran|actual|actuals|aktual|realisasi|realisation|plan|rencana|forecast|proyeksi|projected|target|estimate|estimasi|ytd|variance|varians|selisih|rkap)$/i;

export type OrdinalPeriod = { readonly period: string; readonly scenario: string };

/** "Q1 Budget" → { period: "Q1", scenario: "Budget" }; "Tahun 0" → { period: "Tahun 0", scenario: "" }. */
export function ordinalPeriod(text: string): OrdinalPeriod | null {
  const value = text.trim();
  const match = ORDINAL_PERIOD.exec(value);
  const unit = match?.[1] ?? "";
  const ordinal = match?.[2] ?? "";
  const rest = (match?.[3] ?? "").trim();
  if (!match || unit === "" || ordinal === "") {
    return null;
  }
  if (rest !== "" && !SCENARIO_WORDS.test(rest)) {
    return null;
  }
  return { period: `${unit} ${ordinal}`.replace(/\s+/g, " "), scenario: rest };
}

/** True for "Jan", "Feb 2024", "Mei", "Q1", "TW2", "2024", "FY2024", "2024-01", "Tahun 0", "Q1 Budget". */
export function isPeriodLabel(text: string): boolean {
  const value = text.trim();
  if (value === "") {
    return false;
  }
  if ([MONTH_LABEL, QUARTER_LABEL, YEAR_LABEL, ISO_MONTH_LABEL].some((pattern) => pattern.test(value))) {
    return true;
  }
  return ordinalPeriod(value) !== null;
}

/** True for a header whose *cells* hold the periods ("Period", "Bulan", "Tanggal"). */
export function isPeriodHeader(text: string): boolean {
  return PERIOD_HEADER.test(text.trim());
}

export type PeriodColumn = {
  readonly index: number;
  /** The header exactly as the sheet wrote it. */
  readonly label: string;
  /** The period without its scenario suffix. */
  readonly period: string;
  /** "Budget", "Actual", "Anggaran", "Realisasi" … or "" when the column has no scenario. */
  readonly scenario: string;
};

/** The period columns of a header row, each with its scenario split off. */
export function financePeriodHeaders(header: ReadonlyArray<string>): PeriodColumn[] {
  return header.flatMap((cell, index) => {
    const label = cell.trim();
    if (!isPeriodLabel(label)) {
      return [];
    }
    const ordinal = ordinalPeriod(label);
    const period = ordinal ? ordinal.period : label;
    return [{ index, label, period, scenario: ordinal?.scenario ?? "" }];
  });
}

/** Indexes of the header cells that are themselves periods — the mark of a wide, per-period table. */
export function financePeriodColumns(header: ReadonlyArray<string>): number[] {
  return financePeriodHeaders(header).map((column) => column.index);
}

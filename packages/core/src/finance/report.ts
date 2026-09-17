/**
 * Format-neutral shape every finance task ends in. Screen charts, the workbook, the deck and the
 * document all read this one object, so they can never disagree about a number.
 *
 * Conventions the renderers rely on:
 * - `tables[].id === "inputs"` is the confirmed-rows sheet and `"calc"` the live-formula sheet;
 *   every other table gets a sheet of its own.
 * - A table's header sits on row 1 of its sheet, so its first data row is
 *   REPORT_TABLE_FIRST_DATA_ROW. Formula strings address their own row through that offset.
 */

export const REPORT_FLAG_LEVELS = ["good", "watch", "risk"] as const;
export type ReportFlagLevel = (typeof REPORT_FLAG_LEVELS)[number];

export const REPORT_CHART_KINDS = ["line", "bar", "heat", "gauge"] as const;
export type ReportChartKind = (typeof REPORT_CHART_KINDS)[number];

export type ReportLocale = "id" | "en";

/** Header on row 1, data from here down. The formulas built in core count on this offset. */
export const REPORT_TABLE_FIRST_DATA_ROW = 2;

/** The table id the renderers treat as the confirmed-inputs sheet. */
export const INPUTS_TABLE_ID = "inputs";
/** The table id the renderers treat as the live-formula sheet. */
export const CALC_TABLE_ID = "calc";

export type ReportCell = string | number | boolean | null;

export type ReportKpi = {
  readonly label: string;
  readonly value: number | string | null;
  readonly unit?: string;
  readonly flag?: ReportFlagLevel;
};

export type ReportTable = {
  readonly id: string;
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly ReportCell[])[];
  /**
   * Optional matrix parallel to `rows`. A non-null entry replaces that cell's value with a live
   * Excel formula. Never built out of user text: the only literals are our own category names, and
   * anything the user typed is referenced as a cell instead.
   */
  readonly formulas?: readonly (readonly (string | null)[])[];
};

export type ReportSeries = {
  readonly name: string;
  readonly values: readonly (number | null)[];
};

export type ReportChart = {
  readonly id: string;
  readonly title: string;
  readonly kind: ReportChartKind;
  readonly categories: readonly string[];
  readonly series: readonly ReportSeries[];
  /** One or two guarded lines explaining the chart. Shown under it on screen and on its slide. */
  readonly note?: string;
};

export type ReportFlag = {
  readonly level: ReportFlagLevel;
  readonly text: string;
};

export type ReportNote = {
  readonly heading: string;
  readonly body: string;
};

export type FinanceReport = {
  /** Finance task id. A plain string here on purpose: the task-id module owns the union. */
  readonly task: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly locale: ReportLocale;
  readonly currency?: string;
  readonly summary: readonly ReportKpi[];
  readonly tables: readonly ReportTable[];
  readonly charts: readonly ReportChart[];
  readonly flags: readonly ReportFlag[];
  readonly notes: readonly ReportNote[];
};

export function isReportFlagLevel(value: unknown): value is ReportFlagLevel {
  return typeof value === "string" && (REPORT_FLAG_LEVELS as readonly string[]).includes(value);
}

export function isReportChartKind(value: unknown): value is ReportChartKind {
  return typeof value === "string" && (REPORT_CHART_KINDS as readonly string[]).includes(value);
}

/** The table a renderer should put on the sheet named by `id`, or null when the report has none. */
export function reportTable(report: FinanceReport, id: string): ReportTable | null {
  return report.tables.find((table) => table.id === id) ?? null;
}

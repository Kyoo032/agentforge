import type { NamedTable } from "../artifacts/data-analysis";
import type { FinanceBrief, FinanceMetric } from "../artifacts/finance-brief";
import {
  CALC_TABLE_ID,
  INPUTS_TABLE_ID,
  type FinanceReport,
  type ReportChart,
  type ReportFlag,
  type ReportFlagLevel,
  type ReportKpi,
  type ReportLocale,
  type ReportNote,
  type ReportSeries,
  type ReportTable,
} from "./report";
import { CALC_COLUMNS, calcFormulaMatrix, isInputsShaped, metricBaseKey } from "./report-formulas";

/** Heading the assumptions land under, matching the DOCX builder's own appendix. */
export const ASSUMPTIONS_HEADING = "Assumptions";
/** Name the engine gives the confirmed line items table. */
export const LINE_ITEMS_TABLE_NAME = "Line items";
export const DEFAULT_REPORT_TASK = "brief";
export const KPI_MAX = 8;

/**
 * Metric bases worth a KPI tile, in the order a reader wants them. The profit ladder is here in
 * full: an operating margin and a net margin are different questions, and a tile row that shows
 * only one of them is the reason a brief called an operating profit a net profit.
 */
const KPI_BASE_KEYS = [
  "revenue",
  "gross_margin",
  "operating_margin",
  "net_margin",
  "net_profit_after_tax",
  "net_profit",
  "revenue_growth",
  "cash",
  "runway",
  "runway_latest_burn",
  "burn",
  "monthly_burn",
  "current_ratio",
  "debt_to_equity",
  "npv",
  "irr",
  // A register has none of the rungs above; these are the two tiles it does have, and they sit
  // last so a statement that fills the ladder never loses a tile to them.
  "register_payout",
  "register_count",
] as const;

/** Chart series, in order, built from these metric bases. */
const CHART_BASE_KEYS = ["gross_margin", "net_margin", "revenue_growth"] as const;

const MARGIN_WATCH_PERCENT = 10;
const RUNWAY_RISK_MONTHS = 6;
const RUNWAY_WATCH_MONTHS = 12;
const CURRENT_RATIO_RISK = 1;
const CURRENT_RATIO_WATCH = 1.5;
const DEBT_EQUITY_RISK = 2;
const DEBT_EQUITY_WATCH = 1;
const SUFFIX_UNITS = new Set(["%", "x"]);
const NON_CURRENCY_UNITS = new Set(["%", "x", "months", ""]);

export type GuardFlags = {
  readonly flagged: readonly { readonly section: number; readonly text: string }[];
  readonly total: number;
  /** Sentences taken out because their figure could not be traced even after one rewrite. */
  readonly removed?: number;
};

/**
 * The reader is told when the report is short by a sentence. Silently dropping one would leave a
 * gap they cannot see; leaving "[unverified figure]" in would leave a repair job they did not ask
 * for. This is the third option: say it, once, where the other flags are.
 */
export const REMOVED_SENTENCE_FLAG: Record<ReportLocale, string> = {
  en: "One sentence was removed because its figure could not be traced.",
  id: "Satu kalimat dihapus karena angkanya tidak bisa ditelusuri.",
};

export type FinanceReportOptions = {
  readonly task?: string;
  readonly locale?: ReportLocale;
  readonly subtitle?: string;
  readonly guard?: GuardFlags;
};

function marginBand(value: number): ReportFlagLevel {
  return value < 0 ? "risk" : value < MARGIN_WATCH_PERCENT ? "watch" : "good";
}

function bandFor(base: string, value: number): ReportFlagLevel | undefined {
  if (base === "gross_margin" || base === "net_margin" || base === "operating_margin") {
    return marginBand(value);
  }
  if (base === "runway_latest_burn") {
    return bandFor("runway", value);
  }
  if (base === "revenue_growth") {
    return value < 0 ? "risk" : "good";
  }
  if (base === "runway") {
    return value < RUNWAY_RISK_MONTHS ? "risk" : value < RUNWAY_WATCH_MONTHS ? "watch" : "good";
  }
  if (base === "current_ratio") {
    return value < CURRENT_RATIO_RISK ? "risk" : value < CURRENT_RATIO_WATCH ? "watch" : "good";
  }
  if (base === "debt_to_equity") {
    return value > DEBT_EQUITY_RISK ? "risk" : value > DEBT_EQUITY_WATCH ? "watch" : "good";
  }
  return undefined;
}

/** The last metric with this base that actually has a value: the newest period wins. */
function latestMetric(metrics: readonly FinanceMetric[], base: string): FinanceMetric | null {
  let found: FinanceMetric | null = null;
  for (const metric of metrics) {
    if (metricBaseKey(metric.key) === base && metric.value !== null) {
      found = metric;
    }
  }
  return found;
}

function kpiFor(metric: FinanceMetric): ReportKpi {
  const band = metric.value === null ? undefined : bandFor(metricBaseKey(metric.key), metric.value);
  return { label: metric.label, value: metric.value, unit: metric.unit, ...(band ? { flag: band } : {}) };
}

function summaryOf(metrics: readonly FinanceMetric[]): ReportKpi[] {
  return KPI_BASE_KEYS.flatMap((base) => {
    const metric = latestMetric(metrics, base);
    return metric ? [kpiFor(metric)] : [];
  }).slice(0, KPI_MAX);
}

function currencyOf(metrics: readonly FinanceMetric[]): string | undefined {
  return metrics.find((metric) => !NON_CURRENCY_UNITS.has(metric.unit))?.unit;
}

function slug(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "table";
}

function tableFrom(table: NamedTable, id: string): ReportTable {
  return { id, title: table.name, columns: table.columns, rows: table.rows };
}

function calcTable(metrics: readonly FinanceMetric[], inputsShaped: boolean): ReportTable {
  const rows = metrics.map((metric) => [metric.label, metric.value, metric.unit, metric.period, metric.formula]);
  const base: ReportTable = { id: CALC_TABLE_ID, title: CALC_COLUMNS[0], columns: [...CALC_COLUMNS], rows };
  return inputsShaped ? { ...base, formulas: calcFormulaMatrix(metrics) } : base;
}

function tablesOf(brief: FinanceBrief): ReportTable[] {
  const lineItems = brief.computed.tables.find((table) => table.name === LINE_ITEMS_TABLE_NAME);
  const inputsShaped = lineItems ? isInputsShaped(lineItems.columns) : false;
  const inputs = lineItems ? [tableFrom(lineItems, INPUTS_TABLE_ID)] : [];
  const rest = brief.computed.tables
    .filter((table) => table !== lineItems)
    .map((table) => tableFrom(table, slug(table.name)));
  return [...inputs, calcTable(brief.computed.metrics, inputsShaped), ...rest];
}

/** "Gross margin 2026" with period "2026" reads as "Gross margin" once the period is its own axis. */
function labelWithoutPeriod(metric: FinanceMetric): string {
  const suffix = ` ${metric.period}`;
  return metric.period && metric.label.endsWith(suffix) ? metric.label.slice(0, -suffix.length) : metric.label;
}

function periodsOf(metrics: readonly FinanceMetric[]): string[] {
  const seen: string[] = [];
  for (const metric of metrics) {
    if (metricBaseKey(metric.key) === "revenue" && metric.period && !seen.includes(metric.period)) {
      seen.push(metric.period);
    }
  }
  return seen;
}

function seriesFor(metrics: readonly FinanceMetric[], base: string, periods: readonly string[]): ReportSeries | null {
  const matching = metrics.filter((metric) => metricBaseKey(metric.key) === base);
  const first = matching[0];
  if (!first) {
    return null;
  }
  const values = periods.map((period) => matching.find((metric) => metric.period === period)?.value ?? null);
  return values.some((value) => value !== null) ? { name: labelWithoutPeriod(first), values } : null;
}

function chartsOf(brief: FinanceBrief): ReportChart[] {
  const periods = periodsOf(brief.computed.metrics);
  if (periods.length === 0) {
    return [];
  }
  const series = CHART_BASE_KEYS.flatMap((base) => {
    const row = seriesFor(brief.computed.metrics, base, periods);
    return row ? [row] : [];
  });
  if (series.length === 0) {
    return [];
  }
  return [{ id: "margin-growth", title: brief.title, kind: "bar", categories: periods, series }];
}

function notesOf(brief: FinanceBrief): ReportNote[] {
  const sections = brief.sections.map((section) => ({ heading: section.heading, body: section.body }));
  if (brief.assumptions.length === 0) {
    return sections;
  }
  return [...sections, { heading: ASSUMPTIONS_HEADING, body: brief.assumptions.join("\n") }];
}

function kpiText(kpi: ReportKpi): string {
  if (kpi.value === null) {
    return kpi.label;
  }
  const unit = kpi.unit ?? "";
  const suffixed = SUFFIX_UNITS.has(unit) ? `${kpi.value}${unit}` : unit ? `${kpi.value} ${unit}` : `${kpi.value}`;
  return `${kpi.label}: ${suffixed}`;
}

function flagsOf(summary: readonly ReportKpi[], guard?: GuardFlags, locale: ReportLocale = "en"): ReportFlag[] {
  const stripped = (guard?.flagged ?? []).map((entry) => ({ level: "watch" as const, text: entry.text }));
  const removed =
    (guard?.removed ?? 0) > 0
      ? [{ level: "watch" as const, text: REMOVED_SENTENCE_FLAG[locale] ?? REMOVED_SENTENCE_FLAG.en }]
      : [];
  const banded = summary
    .filter((kpi) => kpi.flag === "risk" || kpi.flag === "watch")
    .map((kpi) => ({ level: kpi.flag as ReportFlagLevel, text: kpiText(kpi) }));
  return [...stripped, ...removed, ...banded];
}

/** Today's computed brief, seen as the format-neutral report every renderer reads. */
export function financeReportFromBrief(brief: FinanceBrief, options: FinanceReportOptions = {}): FinanceReport {
  const summary = summaryOf(brief.computed.metrics);
  const currency = currencyOf(brief.computed.metrics);
  return {
    task: options.task ?? DEFAULT_REPORT_TASK,
    title: brief.title,
    ...(options.subtitle ? { subtitle: options.subtitle } : {}),
    locale: options.locale ?? "en",
    ...(currency ? { currency } : {}),
    summary,
    tables: tablesOf(brief),
    charts: chartsOf(brief),
    flags: flagsOf(summary, options.guard, options.locale ?? "en"),
    notes: notesOf(brief),
  };
}

export type MarkdownReportOptions = {
  readonly title: string;
  readonly task?: string;
  readonly locale?: ReportLocale;
};

function notesFromMarkdown(markdown: string, fallbackHeading: string): ReportNote[] {
  const notes: ReportNote[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  const push = () => {
    if (heading !== null) {
      notes.push({ heading, body: body.join("\n").trim() });
    }
  };
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^##\s+(.*\S)\s*$/.exec(line);
    if (match?.[1]) {
      push();
      heading = match[1];
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  push();
  if (notes.length > 0) {
    return notes;
  }
  const text = markdown.replace(/^#\s+.*$/m, "").trim();
  return text ? [{ heading: fallbackHeading, body: text }] : [];
}

/**
 * A finance brief that was saved as markdown, recovered well enough to export. Its numbers are
 * already guarded prose by then, so the report carries notes only - no tables, no charts.
 */
export function financeReportFromMarkdown(markdown: string, options: MarkdownReportOptions): FinanceReport {
  return {
    task: options.task ?? DEFAULT_REPORT_TASK,
    title: options.title,
    locale: options.locale ?? "en",
    summary: [],
    tables: [],
    charts: [],
    flags: [],
    notes: notesFromMarkdown(markdown, options.title),
  };
}

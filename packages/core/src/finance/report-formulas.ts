import type { FinanceMetric } from "../artifacts/finance-brief";
import { REPORT_TABLE_FIRST_DATA_ROW } from "./report";

/**
 * Live Excel formulas for the Calc sheet, mirroring what the engine already computed so a reader
 * can change an input row and watch the metric move.
 *
 * Every formula addresses the Inputs sheet by column (A Label, B Period, C Category, D Amount,
 * E Currency) and its own Calc row (A Metric, B Value, C Unit, D Period, E Formula). Category
 * names are our own enum values; a period is whatever the user typed, so it is referenced as the
 * row's own Period cell and never inlined as a literal.
 *
 * Only the operating line can be addressed that way. Interest, other income and tax are *roles* the
 * engine reads off a row's label, not categories on the Inputs sheet, and `periodBase` deliberately
 * holds them out of opex - so no SUMIFS over Category can state a pre-tax or a net figure, and one
 * that tried would quietly answer with the operating profit instead. That is what this sheet used to
 * do: an operating margin written into the row labelled net margin. Below the operating line the
 * formulas therefore point at the Calc sheet's own Value cells for the same period, which already
 * carry the engine's numbers, and the role-based leaves keep no formula at all.
 */

/** The columns an inputs table must have before any of this addressing holds. */
export const INPUTS_COLUMNS = ["Label", "Period", "Category", "Amount", "Currency"] as const;

/** The Calc sheet's own columns, in order. */
export const CALC_COLUMNS = ["Metric", "Value", "Unit", "Period", "Formula"] as const;

/** Index of the Calc column a metric formula is written into. */
export const CALC_VALUE_COLUMN = 1;

const AMOUNT = "Inputs!$D:$D";
const CATEGORY = "Inputs!$C:$C";
const PERIOD = "Inputs!$B:$B";
const CALC_PERIOD_COLUMN_LETTER = "D";
const CALC_VALUE_COLUMN_LETTER = "B";
const PERCENT = 100;

/** Metric key without its period suffix: "gross_margin Q1 2026" -> "gross_margin". */
export function metricBaseKey(key: string): string {
  const space = key.indexOf(" ");
  return space === -1 ? key : key.slice(0, space);
}

/** What a builder may look at: its own row, and every other Calc row it might point at. */
type BuilderContext = {
  readonly metrics: readonly FinanceMetric[];
  readonly rowIndex: number;
  readonly period: string;
  readonly hasPeriod: boolean;
};

function periodRef(rowIndex: number): string {
  return `$${CALC_PERIOD_COLUMN_LETTER}${REPORT_TABLE_FIRST_DATA_ROW + rowIndex}`;
}

/** sum of one category, narrowed to the row's own period when the metric has one. */
function sumOf(category: string, context: BuilderContext): string {
  const base = `SUMIFS(${AMOUNT},${CATEGORY},"${category}"`;
  return context.hasPeriod ? `${base},${PERIOD},${periodRef(context.rowIndex)})` : `${base})`;
}

function marginOf(costs: readonly string[], context: BuilderContext): string {
  const revenue = sumOf("revenue", context);
  const subtracted = costs.map((category) => sumOf(category, context)).join("-");
  return `IFERROR((${revenue}-${subtracted})/${revenue}*${PERCENT},"")`;
}

function differenceOf(categories: readonly string[], context: BuilderContext): string {
  return categories.map((category) => sumOf(category, context)).join("-");
}

/**
 * The Calc Value cell of the row that states `base` for this row's own period. A row that is not
 * there, or that states nothing, answers null: a reference to a blank cell would read as a zero and
 * quietly disagree with the engine.
 */
function siblingRef(context: BuilderContext, base: string): string | null {
  const at = context.metrics.findIndex(
    (metric) =>
      metricBaseKey(metric.key) === base &&
      metric.period.trim() === context.period &&
      typeof metric.value === "number",
  );
  return at === -1 ? null : `$${CALC_VALUE_COLUMN_LETTER}${REPORT_TABLE_FIRST_DATA_ROW + at}`;
}

/** The first of these bases the same period actually states, in the engine's own order of preference. */
function firstSiblingRef(context: BuilderContext, bases: readonly string[]): string | null {
  for (const base of bases) {
    const ref = siblingRef(context, base);
    if (ref !== null) {
      return ref;
    }
  }
  return null;
}

/** A margin one Calc cell over another, for the ladder rows no SUMIFS can reach. */
function ratioOfSiblings(context: BuilderContext, over: readonly string[], by: string): string | null {
  const top = firstSiblingRef(context, over);
  const bottom = siblingRef(context, by);
  return top === null || bottom === null ? null : `IFERROR(${top}/${bottom}*${PERCENT},"")`;
}

/** operating profit - interest + other income, each term only when its own row states it. */
function pretaxProfit(context: BuilderContext): string | null {
  const operating = siblingRef(context, "operating_profit");
  if (operating === null) {
    return null;
  }
  const interest = siblingRef(context, "interest_expense");
  const other = siblingRef(context, "other_income");
  return `${operating}${interest === null ? "" : `-${interest}`}${other === null ? "" : `+${other}`}`;
}

function netProfitAfterTax(context: BuilderContext): string | null {
  const pretax = siblingRef(context, "pretax_profit");
  const tax = siblingRef(context, "tax_expense");
  return pretax === null || tax === null ? null : `${pretax}-${tax}`;
}

type Builder = (context: BuilderContext) => string | null;

const BUILDERS: Record<string, Builder> = {
  revenue: (context) => sumOf("revenue", context),
  opex: (context) => sumOf("opex", context),
  cash: (context) => sumOf("cash", context),
  gross_profit: (context) => differenceOf(["revenue", "cogs"], context),
  gross_margin: (context) => marginOf(["cogs"], context),
  operating_profit: (context) => differenceOf(["revenue", "cogs", "opex"], context),
  operating_margin: (context) => marginOf(["cogs", "opex"], context),
  pretax_profit: pretaxProfit,
  net_profit_after_tax: netProfitAfterTax,
  // `net_profit` is the after-tax figure when tax is stated and the pre-tax one when it is not.
  net_profit: (context) => firstSiblingRef(context, ["net_profit_after_tax", "pretax_profit"]),
  net_margin: (context) => ratioOfSiblings(context, ["net_profit_after_tax", "net_profit"], "revenue"),
};

/** The formula for this metric's Value cell, or null when it cannot be derived from the sheet. */
export function metricFormula(
  metric: FinanceMetric,
  rowIndex: number,
  metrics: readonly FinanceMetric[] = [],
): string | null {
  const builder = BUILDERS[metricBaseKey(metric.key)];
  if (!builder) {
    return null;
  }
  const period = metric.period.trim();
  return builder({ metrics, rowIndex, period, hasPeriod: period !== "" });
}

/** A formula matrix parallel to the Calc rows: the Value column only, null everywhere else. */
export function calcFormulaMatrix(metrics: readonly FinanceMetric[]): (string | null)[][] {
  return metrics.map((metric, rowIndex) =>
    CALC_COLUMNS.map((_column, columnIndex) =>
      columnIndex === CALC_VALUE_COLUMN ? metricFormula(metric, rowIndex, metrics) : null,
    ),
  );
}

/** True when a table can be addressed the way the formulas above assume. */
export function isInputsShaped(columns: readonly string[]): boolean {
  return columns.length === INPUTS_COLUMNS.length && INPUTS_COLUMNS.every((name, at) => columns[at] === name);
}

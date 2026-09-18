/**
 * The budget report's tables, including the workbook's live formulas.
 *
 * The variance table comes first on purpose: it is the one a reader (and the eval harness) looks at
 * to find a line's budget beside its actual, and a roll-up table that arrived first would answer
 * that question with a section name.
 *
 * The Calc sheet is live. Every cell on it is a formula over the Inputs sheet, and every criterion
 * is a *cell reference* rather than an inlined label: the owner's own wording never becomes part of
 * a formula string, so a line called `"` or `,` cannot break the workbook. The two label columns and
 * the two period columns exist for exactly that reason — they are what the SUMIFS point at.
 */
import { CALC_TABLE_ID, INPUTS_TABLE_ID, REPORT_TABLE_FIRST_DATA_ROW, type ReportCell, type ReportLocale, type ReportTable } from "../report";
import { INPUTS_COLUMNS } from "../report-formulas";
import { budgetCurrency, type BudgetComputed } from "./compute";
import { formatBudgetAmount, formatBudgetPercent } from "./format";
import { budgetAggregateName, budgetDirectionWord, budgetStageWord, budgetWord } from "./text";
import { budgetSlug, type BudgetVarianceCell, type BudgetVarianceLine } from "./variance";

/** The Calc sheet's columns. The four text ones are what the formulas' criteria point at. */
export const BUDGET_CALC_COLUMNS = [
  "Metric",
  "Period",
  "Budget line",
  "Budget tag",
  "Actual line",
  "Actual tag",
  "Budget",
  "Actual",
  "Variance",
  "Variance %",
] as const;

const AMOUNT_COLUMN = "Inputs!$D:$D";
const LABEL_COLUMN = "Inputs!$A:$A";
const PERIOD_COLUMN = "Inputs!$B:$B";
const CALC_BUDGET_LETTER = "G";
const CALC_ACTUAL_LETTER = "H";
/** Rows drawn on the variance chart before it stops being readable. */
export const BUDGET_CHART_ROW_MAX = 12;

function sheetRow(index: number): number {
  return REPORT_TABLE_FIRST_DATA_ROW + index;
}

function sumIfs(labelCell: string, periodCell: string): string {
  return `SUMIFS(${AMOUNT_COLUMN},${LABEL_COLUMN},${labelCell},${PERIOD_COLUMN},${periodCell})`;
}

function reading(cell: BudgetVarianceCell, locale: ReportLocale, currency: string): string {
  return `${formatBudgetAmount(cell.variance, locale, currency)} (${formatBudgetPercent(cell.variancePct, locale)})`;
}

function matchText(line: BudgetVarianceLine, locale: ReportLocale): string {
  // "Too close to call" is still a line with no partner as far as the arithmetic is concerned, so it
  // reads as one here; the pairing screen is where the two candidates were offered.
  if (line.matchStage === "unmatched" || line.matchStage === "ambiguous") {
    return `${budgetStageWord(line.matchStage, locale)} · ${budgetWord(line.budgetLabel ? "budgetOnly" : "actualOnly", locale)}`;
  }
  return `${budgetStageWord(line.matchStage, locale)} · ${line.matchScore.toFixed(2)}`;
}

function flagText(cell: BudgetVarianceCell, locale: ReportLocale): string {
  return budgetWord(cell.flagged ? "flagged" : "withinLimit", locale);
}

function lineRow(line: BudgetVarianceLine, cell: BudgetVarianceCell, locale: ReportLocale): ReportCell[] {
  return [
    line.label,
    cell.budget,
    cell.actual,
    cell.variance,
    cell.variancePct,
    budgetDirectionWord(cell.direction, locale),
    flagText(cell, locale),
  ];
}

/**
 * A money column says which money it is.
 *
 * The percent column has always said "%", and the three amount columns beside it said nothing — so a
 * reader (and anything reading the report back) had only the row's name to go on, and 72.000.000
 * under a column headed "Selisih" is as easily a percentage as a rupiah. The code is the report's
 * own currency, never a symbol the sheet might have meant differently.
 */
function varianceColumns(locale: ReportLocale, currency: string): string[] {
  const money = (key: "budget" | "actual" | "variance"): string => `${budgetWord(key, locale)} (${currency})`;
  return [
    budgetWord("line", locale),
    money("budget"),
    money("actual"),
    money("variance"),
    budgetWord("variancePct", locale),
    budgetWord("direction", locale),
    budgetWord("flag", locale),
  ];
}

/**
 * The headline table: one row per line over the whole period, with the pairing itself.
 *
 * The partner column is the one a reader of a two-sheet workbook cannot do without. "Donasi individu"
 * was compared against "Penerimaan donasi perorangan", and until the report says so the reader has a
 * variance and no way to check what it is a variance BETWEEN. It sits beside the confidence because
 * the two are one sentence: which line, and how sure. An empty cell is a line with no partner, which
 * the unmatched note names in full.
 */
function fullPeriodTable(computed: BudgetComputed, locale: ReportLocale): ReportTable {
  const currency = budgetCurrency(computed, locale);
  return {
    id: "variance",
    title: budgetWord("varianceTable", locale),
    columns: [
      ...varianceColumns(locale, currency),
      budgetWord("partner", locale),
      budgetWord("match", locale),
      budgetWord("reading", locale),
    ],
    rows: computed.lines.map((line) => [
      ...lineRow(line, line.total, locale),
      // The actual-side line this variance was taken against. A row that exists only in the actuals
      // IS that line; a budget line nobody ever spent has none, and the cell is left empty.
      line.actualLabel ?? "",
      matchText(line, locale),
      reading(line.total, locale, currency),
    ]),
  };
}

function periodTables(computed: BudgetComputed, locale: ReportLocale): ReportTable[] {
  if (computed.periods.length < 2) {
    return [];
  }
  const currency = budgetCurrency(computed, locale);
  return computed.periods.map((period, at) => ({
    id: `variance-${budgetSlug(period)}`,
    title: `${budgetWord("periodTable", locale)} ${period}`,
    columns: varianceColumns(locale, currency),
    rows: computed.lines.flatMap((line) => {
      const cell = line.periods[at];
      return cell ? [lineRow(line, cell, locale)] : [];
    }),
  }));
}

/** Every roll-up, per period and over the whole period. Never named after the sheet's own totals. */
function aggregateTable(computed: BudgetComputed, locale: ReportLocale): ReportTable {
  const many = computed.periods.length > 1;
  return {
    id: "sections",
    title: budgetWord("aggregateTable", locale),
    columns: [
      budgetWord("section", locale),
      budgetWord("period", locale),
      ...varianceColumns(locale, budgetCurrency(computed, locale)).slice(1, -2),
      budgetWord("direction", locale),
    ],
    rows: computed.aggregates.flatMap((aggregate) => {
      const name = budgetAggregateName(aggregate.id, locale);
      const cells = many ? [...aggregate.periods, aggregate.total] : [aggregate.total];
      return cells.map((cell, at) => [
        name,
        many && at < aggregate.periods.length ? cell.period : budgetWord("fullPeriod", locale),
        cell.budget,
        cell.actual,
        cell.variance,
        cell.variancePct,
        budgetDirectionWord(cell.direction, locale),
      ]);
    }),
  };
}

/** The columns the flagged-line table uses: the variance columns, under the period they broke in. */
function flaggedColumns(computed: BudgetComputed, locale: ReportLocale): string[] {
  // The flag column is dropped: every row in this table is a flagged row, and a column that says
  // "flagged" fourteen times tells a reader nothing the title has not already said.
  return [budgetWord("period", locale), ...varianceColumns(locale, budgetCurrency(computed, locale)).slice(0, -1)];
}

function flaggedRow(period: string, line: BudgetVarianceLine, cell: BudgetVarianceCell, locale: ReportLocale): ReportCell[] {
  return [period, ...lineRow(line, cell, locale).slice(0, -1)];
}

/**
 * WHICH lines broke the limit, period by period and over the whole period.
 *
 * A quarter that flags fifteen lines and a year that flags eight are two different statements about
 * the same sheet, and a report that only carries the second lets the first disappear — a line that
 * overspends every quarter and nets to nothing over the year is exactly the row this task exists to
 * find. Naming them rather than counting them is the difference between "13 lines in Q3" and a
 * reader who can act on it.
 */
function flaggedLineTable(computed: BudgetComputed, locale: ReportLocale): ReportTable {
  const many = computed.periods.length > 1;
  const perPeriod = many
    ? computed.periods.flatMap((period, at) =>
        computed.lines.flatMap((line) => {
          const cell = line.periods[at];
          return cell?.flagged ? [flaggedRow(period, line, cell, locale)] : [];
        }),
      )
    : [];
  const fullPeriod = computed.lines.flatMap((line) =>
    line.total.flagged ? [flaggedRow(budgetWord("fullPeriod", locale), line, line.total, locale)] : [],
  );
  return {
    id: "flags",
    title: budgetWord("flagsTable", locale),
    columns: flaggedColumns(computed, locale),
    rows: [...perPeriod, ...fullPeriod],
  };
}

/** The same lines counted, for a reader who wants the shape of the year before the detail. */
function flagCountTable(computed: BudgetComputed, locale: ReportLocale): ReportTable {
  const many = computed.periods.length > 1;
  return {
    id: "flag-counts",
    title: budgetWord("flagCountsTable", locale),
    columns: [budgetWord("period", locale), budgetWord("flaggedCount", locale), budgetWord("linesCount", locale)],
    rows: [
      ...(many
        ? computed.flagCounts.byPeriod.map((entry) => [entry.period, entry.count, computed.lines.length])
        : []),
      [budgetWord("fullPeriod", locale), computed.flagCounts.total, computed.lines.length],
    ],
  };
}

/** The rows the owner confirmed, in the shape every Finance workbook addresses its formulas at. */
function inputsTable(computed: BudgetComputed, locale: ReportLocale): ReportTable {
  const currency = budgetCurrency(computed, locale);
  return {
    id: INPUTS_TABLE_ID,
    title: budgetWord("inputsTable", locale),
    columns: [...INPUTS_COLUMNS],
    rows: computed.items.map((item) => [
      item.label,
      item.period,
      item.category,
      item.amount,
      item.currency || currency,
    ]),
  };
}

type CalcRow = { readonly cells: ReportCell[]; readonly formulas: (string | null)[] };

function calcRow(line: BudgetVarianceLine, cell: BudgetVarianceCell, at: number, index: number): CalcRow {
  const row = sheetRow(index);
  const budgetFormula = sumIfs(`$C${row}`, `$D${row}`);
  const actualFormula = sumIfs(`$E${row}`, `$F${row}`);
  return {
    cells: [
      line.label,
      cell.period,
      line.budgetLabel ?? "",
      line.budgetTags[at] ?? "",
      line.actualLabel ?? "",
      line.actualTags[at] ?? "",
      cell.budget,
      cell.actual,
      cell.variance,
      cell.variancePct,
    ],
    formulas: [
      null,
      null,
      null,
      null,
      null,
      null,
      budgetFormula,
      actualFormula,
      `${CALC_ACTUAL_LETTER}${row}-${CALC_BUDGET_LETTER}${row}`,
      `IF(${CALC_BUDGET_LETTER}${row}=0,"",(${CALC_ACTUAL_LETTER}${row}-${CALC_BUDGET_LETTER}${row})/${CALC_BUDGET_LETTER}${row}*100)`,
    ],
  };
}

function totalRow(line: BudgetVarianceLine, first: number, last: number, index: number, locale: ReportLocale): CalcRow {
  const row = sheetRow(index);
  const span = (letter: string): string => `SUM(${letter}${sheetRow(first)}:${letter}${sheetRow(last)})`;
  return {
    cells: [
      line.label,
      budgetWord("fullPeriod", locale),
      line.budgetLabel ?? "",
      "",
      line.actualLabel ?? "",
      "",
      line.total.budget,
      line.total.actual,
      line.total.variance,
      line.total.variancePct,
    ],
    formulas: [
      null,
      null,
      null,
      null,
      null,
      null,
      span(CALC_BUDGET_LETTER),
      span(CALC_ACTUAL_LETTER),
      `${CALC_ACTUAL_LETTER}${row}-${CALC_BUDGET_LETTER}${row}`,
      `IF(${CALC_BUDGET_LETTER}${row}=0,"",(${CALC_ACTUAL_LETTER}${row}-${CALC_BUDGET_LETTER}${row})/${CALC_BUDGET_LETTER}${row}*100)`,
    ],
  };
}

/** One live row per line and period, and — when there is more than one period — its own total. */
function calcTable(computed: BudgetComputed, locale: ReportLocale): ReportTable {
  const many = computed.periods.length > 1;
  const rows: CalcRow[] = [];
  for (const line of computed.lines) {
    const first = rows.length;
    for (const [at, cell] of line.periods.entries()) {
      rows.push(calcRow(line, cell, at, rows.length));
    }
    if (many) {
      rows.push(totalRow(line, first, rows.length - 1, rows.length, locale));
    }
  }
  return {
    id: CALC_TABLE_ID,
    title: budgetWord("calcTable", locale),
    columns: [...BUDGET_CALC_COLUMNS],
    rows: rows.map((row) => row.cells),
    formulas: rows.map((row) => row.formulas),
  };
}

/** Variance first, then the periods, the roll-ups, the confirmed rows and the live Calc sheet. */
export function budgetTables(computed: BudgetComputed, locale: ReportLocale): ReportTable[] {
  return [
    fullPeriodTable(computed, locale),
    ...periodTables(computed, locale),
    aggregateTable(computed, locale),
    flaggedLineTable(computed, locale),
    flagCountTable(computed, locale),
    inputsTable(computed, locale),
    calcTable(computed, locale),
  ];
}

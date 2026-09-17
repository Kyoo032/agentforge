/**
 * The budget task's finished report: the object the screen, the workbook, the deck and the document
 * all read, so none of them can disagree about a number.
 *
 * Three of its parts are written in code rather than by the model, on purpose. The flags are the
 * lines that broke the limit, stated as facts. The unmatched note names the lines that never found a
 * partner — the two unbudgeted costs and the reserve nobody drew down are the whole point of this
 * report, and they must be in it whether or not a narrator thought to mention them. And the basis
 * note says which limits were applied, because a flag without its threshold is an opinion.
 */
import type {
  FinanceReport,
  ReportChart,
  ReportFlag,
  ReportFlagLevel,
  ReportKpi,
  ReportLocale,
  ReportNote,
  ReportSeries,
} from "../report";
import type { FinanceTaskProse, FinanceTaskReportOptions } from "../tasks/types";
import { budgetCurrency, flaggedBudgetLines, type BudgetComputed } from "./compute";
import { formatBudgetAmount, formatBudgetMagnitude, formatBudgetPercent } from "./format";
import { BUDGET_CHART_ROW_MAX, budgetTables } from "./tables";
import { budgetAggregateName, budgetDirectionWord, budgetThresholdSentence, budgetWord } from "./text";
import type { BudgetVarianceCell, BudgetVarianceLine } from "./variance";

const TASK_ID = "budget";

function levelFor(cell: BudgetVarianceCell): ReportFlagLevel | undefined {
  if (cell.direction === "neutral") {
    return undefined;
  }
  if (cell.direction === "favourable") {
    return "good";
  }
  return cell.flagged ? "risk" : "watch";
}

function kpisFor(computed: BudgetComputed, locale: ReportLocale): ReportKpi[] {
  const currency = budgetCurrency(computed, locale);
  const rollUps = computed.aggregates.map((aggregate) => {
    const level = levelFor(aggregate.total);
    return {
      label: `${budgetAggregateName(aggregate.id, locale)} — ${budgetWord("variance", locale)}`,
      value: aggregate.total.variance,
      unit: currency,
      ...(level ? { flag: level } : {}),
    };
  });
  return [
    ...rollUps,
    { label: budgetWord("flaggedCount", locale), value: computed.flagCounts.total, unit: "" },
    { label: budgetWord("linesCount", locale), value: computed.lines.length, unit: "" },
    {
      label: budgetWord("unmatchedCount", locale),
      value: computed.budgetOnly.length + computed.actualOnly.length,
      unit: "",
    },
  ];
}

/** The lines worth drawing: the flagged ones first, then the largest, back in the sheet's order. */
function chartLines(computed: BudgetComputed): readonly BudgetVarianceLine[] {
  if (computed.lines.length <= BUDGET_CHART_ROW_MAX) {
    return computed.lines;
  }
  const ranked = [...computed.lines].sort((left, right) => {
    if (left.total.flagged !== right.total.flagged) {
      return left.total.flagged ? -1 : 1;
    }
    return Math.abs(right.total.variance) - Math.abs(left.total.variance);
  });
  const kept = new Set(ranked.slice(0, BUDGET_CHART_ROW_MAX).map((line) => line.label));
  return computed.lines.filter((line) => kept.has(line.label));
}

function splitSeries(lines: readonly BudgetVarianceLine[], locale: ReportLocale): ReportSeries[] {
  const flagged = lines.map((line) => (line.total.flagged ? line.total.variance : null));
  const within = lines.map((line) => (line.total.flagged ? null : line.total.variance));
  // Both series always, even when one is empty: the flagged lines are always series 0, so the screen
  // and the deck can colour them without guessing which half of the chart they are looking at.
  return [
    { name: budgetWord("flagged", locale), values: flagged },
    { name: budgetWord("withinLimit", locale), values: within },
  ];
}

function varianceChart(computed: BudgetComputed, locale: ReportLocale): ReportChart | null {
  const lines = chartLines(computed);
  if (lines.length === 0) {
    return null;
  }
  const currency = budgetCurrency(computed, locale);
  const worst = [...lines].sort((left, right) => Math.abs(right.total.variance) - Math.abs(left.total.variance))[0];
  const cap = lines.length < computed.lines.length ? ` ${budgetWord("chartCap", locale)}` : "";
  return {
    id: "variance-bars",
    title: budgetWord("varianceChart", locale),
    kind: "bar",
    categories: lines.map((line) => line.label),
    series: splitSeries(lines, locale),
    note: worst
      ? `${worst.label}: ${formatBudgetMagnitude(worst.total.variance, locale, currency)} (${formatBudgetPercent(worst.total.variancePct, locale)}).${cap}`
      : undefined,
  };
}

function periodChart(computed: BudgetComputed, locale: ReportLocale): ReportChart | null {
  if (computed.periods.length < 2) {
    return null;
  }
  return {
    id: "variance-by-period",
    title: budgetWord("periodChart", locale),
    kind: "bar",
    categories: [...computed.periods],
    series: computed.aggregates.map((aggregate) => ({
      name: budgetAggregateName(aggregate.id, locale),
      values: aggregate.periods.map((cell) => cell.variance),
    })),
  };
}

function flagsFor(computed: BudgetComputed, locale: ReportLocale, guard?: FinanceTaskReportOptions["guard"]): ReportFlag[] {
  const currency = budgetCurrency(computed, locale);
  const stripped = (guard?.flagged ?? []).map((entry) => ({ level: "watch" as const, text: entry.text }));
  const lines = flaggedBudgetLines(computed).map((line) => ({
    level: line.total.direction === "favourable" ? ("good" as const) : ("risk" as const),
    text: `${line.label}: ${formatBudgetAmount(line.total.variance, locale, currency)} (${formatBudgetPercent(line.total.variancePct, locale)}) — ${budgetDirectionWord(line.total.direction, locale)}`,
  }));
  return [...stripped, ...lines];
}

function flaggedNote(computed: BudgetComputed, locale: ReportLocale): ReportNote {
  const currency = budgetCurrency(computed, locale);
  const lines = flaggedBudgetLines(computed);
  const body =
    lines.length === 0
      ? budgetWord("noFlagged", locale)
      : lines
          .map(
            (line) =>
              `- ${line.label}: ${formatBudgetAmount(line.total.budget, locale, currency)} → ${formatBudgetAmount(line.total.actual, locale, currency)}, ${formatBudgetAmount(line.total.variance, locale, currency)} (${formatBudgetPercent(line.total.variancePct, locale)}), ${budgetDirectionWord(line.total.direction, locale)}`,
          )
          .join("\n");
  return { heading: budgetWord("flaggedNote", locale), body };
}

function unmatchedNote(computed: BudgetComputed, locale: ReportLocale): ReportNote {
  const left = computed.budgetOnly.map((label) => `- ${label} (${budgetWord("budgetOnly", locale)})`);
  const right = computed.actualOnly.map((label) => `- ${label} (${budgetWord("actualOnly", locale)})`);
  const body = left.length + right.length === 0 ? budgetWord("noUnmatched", locale) : [...left, ...right].join("\n");
  return { heading: budgetWord("unmatchedNote", locale), body };
}

function excludedNote(computed: BudgetComputed, locale: ReportLocale): ReportNote[] {
  const labels = [...new Set(computed.excluded.map((row) => row.label))];
  return labels.length === 0
    ? []
    : [{ heading: budgetWord("excludedNote", locale), body: labels.map((label) => `- ${label}`).join("\n") }];
}

function basisNote(computed: BudgetComputed, locale: ReportLocale, assumptions: readonly string[]): ReportNote {
  const currency = budgetCurrency(computed, locale);
  const rule = budgetThresholdSentence(
    locale,
    formatBudgetAmount(computed.thresholds.abs, locale, currency),
    formatBudgetPercent(computed.thresholds.pct, locale),
    computed.thresholds.mode,
  );
  const periods = computed.periods.filter((period) => period !== "").join(", ");
  const spread =
    periods === ""
      ? ""
      : locale === "id"
        ? `\nPeriode: ${periods}. Angka seluruh periode dijumlahkan dulu, baru dibagi.`
        : `\nPeriods: ${periods}. The full period is summed first and divided after.`;
  return { heading: budgetWord("basisNote", locale), body: [rule + spread, ...assumptions].join("\n") };
}

/** The finished report. `prose` is the guarded narrative; every number below came out of `compute`. */
export function budgetReport(
  computed: BudgetComputed,
  prose: FinanceTaskProse,
  options: FinanceTaskReportOptions = {},
): FinanceReport {
  const locale: ReportLocale = options.locale ?? "en";
  const charts = [varianceChart(computed, locale), periodChart(computed, locale)].filter(
    (chart): chart is ReportChart => chart !== null,
  );
  return {
    task: TASK_ID,
    title: prose.title || budgetWord("title", locale),
    subtitle: options.subtitle ?? budgetWord("subtitle", locale),
    locale,
    currency: budgetCurrency(computed, locale),
    summary: kpisFor(computed, locale),
    tables: budgetTables(computed, locale),
    charts,
    flags: flagsFor(computed, locale, options.guard),
    notes: [
      ...prose.sections.map((section) => ({ heading: section.heading, body: section.body })),
      flaggedNote(computed, locale),
      unmatchedNote(computed, locale),
      ...excludedNote(computed, locale),
      basisNote(computed, locale, prose.assumptions),
    ],
  };
}

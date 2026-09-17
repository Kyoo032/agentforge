/**
 * The only numbers the model is shown, and the only numbers the guard will take back.
 *
 * `budgetPromptFacts` is deliberately narrow: the lines that broke the limit, the roll-ups a reader
 * needs to place them in, and the lines that never found a partner. Everything else is on budget and
 * says so in one sentence, because a narrator handed forty rows writes about forty rows.
 *
 * `budgetAllowedNumbers` is the same set seen from the other side, plus the rounded readings the
 * facts actually print — the guard compares what the model wrote, and the model writes what it was
 * shown. A figure in one list and not the other is a bug here, not in the guard.
 */
import type { ReportLocale } from "../report";
import { budgetAggregate, budgetCurrency, flaggedBudgetLines, type BudgetComputed, type BudgetTaskInput } from "./compute";
import { BUDGET_PERCENT_DECIMALS, formatBudgetAmount, formatBudgetPercent } from "./format";
import { budgetAggregateName, budgetDirectionWord, budgetThresholdSentence, budgetWord } from "./text";
import type { BudgetVarianceCell, BudgetVarianceLine } from "./variance";

/** Flagged lines written out in full before the list is cut; the count is always stated. */
export const BUDGET_FACT_LINE_MAX = 30;

const HEADINGS: Readonly<Record<ReportLocale, Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    flagged: "Lines over the limit (computed in code; quote them as they stand):",
    periodOnly: "Flagged in a single period but not over the whole period:",
    rollUps: "Roll-ups:",
    unmatched: "Lines with no partner in the other set:",
    counts: "Counts:",
    onBudget: "Every other line is within the limit and needs no paragraph of its own.",
    none: "No line ran past the limit.",
  }),
  id: Object.freeze({
    flagged: "Baris yang melewati batas (dihitung di kode; kutip apa adanya):",
    periodOnly: "Ditandai di satu periode saja, tidak untuk seluruh periode:",
    rollUps: "Rekap pos:",
    unmatched: "Baris yang tidak punya pasangan di set lain:",
    counts: "Jumlah:",
    onBudget: "Baris lain ada di dalam batas dan tidak perlu paragraf sendiri.",
    none: "Tidak ada baris yang melewati batas.",
  }),
});

function heading(key: string, locale: ReportLocale): string {
  return HEADINGS[locale]?.[key] ?? HEADINGS.en[key] ?? key;
}

function cellFact(cell: BudgetVarianceCell, locale: ReportLocale, currency: string): string {
  return [
    `${budgetWord("budget", locale)} ${formatBudgetAmount(cell.budget, locale, currency)}`,
    `${budgetWord("actual", locale)} ${formatBudgetAmount(cell.actual, locale, currency)}`,
    `${budgetWord("variance", locale)} ${formatBudgetAmount(cell.variance, locale, currency)}`,
    formatBudgetPercent(cell.variancePct, locale),
    budgetDirectionWord(cell.direction, locale),
  ].join(" | ");
}

function lineFact(line: BudgetVarianceLine, locale: ReportLocale, currency: string): string {
  return `- ${line.slug} | ${line.label} | ${cellFact(line.total, locale, currency)}`;
}

function periodFacts(line: BudgetVarianceLine, locale: ReportLocale, currency: string): string[] {
  return line.periods.length < 2
    ? []
    : line.periods.map((cell) => `  · ${cell.period}: ${cellFact(cell, locale, currency)}`);
}

function flaggedBlock(computed: BudgetComputed, locale: ReportLocale, currency: string): string[] {
  const lines = flaggedBudgetLines(computed);
  if (lines.length === 0) {
    return [heading("flagged", locale), heading("none", locale)];
  }
  const shown = lines.slice(0, BUDGET_FACT_LINE_MAX);
  return [
    heading("flagged", locale),
    ...shown.flatMap((line) => [lineFact(line, locale, currency), ...periodFacts(line, locale, currency)]),
  ];
}

/** The trap this task exists to catch: four bad quarters that net to nothing over the year. */
function periodOnlyBlock(computed: BudgetComputed, locale: ReportLocale, currency: string): string[] {
  const lines = computed.lines.filter(
    (line) => !line.total.flagged && line.periods.some((cell) => cell.flagged),
  );
  return lines.length === 0
    ? []
    : [
        heading("periodOnly", locale),
        ...lines.slice(0, BUDGET_FACT_LINE_MAX).flatMap((line) => [
          lineFact(line, locale, currency),
          ...periodFacts(line, locale, currency).filter((_text, at) => line.periods[at]?.flagged === true),
        ]),
      ];
}

function rollUpBlock(computed: BudgetComputed, locale: ReportLocale, currency: string): string[] {
  return [
    heading("rollUps", locale),
    ...computed.aggregates.map(
      (aggregate) =>
        `- ${aggregate.id} | ${budgetAggregateName(aggregate.id, locale)} | ${cellFact(aggregate.total, locale, currency)}`,
    ),
  ];
}

function unmatchedBlock(computed: BudgetComputed, locale: ReportLocale): string[] {
  const left = computed.budgetOnly.map((label) => `- ${label} (${budgetWord("budgetOnly", locale)})`);
  const right = computed.actualOnly.map((label) => `- ${label} (${budgetWord("actualOnly", locale)})`);
  return left.length + right.length === 0 ? [] : [heading("unmatched", locale), ...left, ...right];
}

function countsBlock(computed: BudgetComputed, locale: ReportLocale): string[] {
  const perPeriod =
    computed.periods.length < 2
      ? []
      : computed.flagCounts.byPeriod.map((entry) => `- ${entry.period}: ${entry.count}`);
  return [
    heading("counts", locale),
    `- ${budgetWord("linesCount", locale)}: ${computed.lines.length}`,
    `- ${budgetWord("flaggedCount", locale)}: ${computed.flagCounts.total}`,
    `- ${budgetWord("unmatchedCount", locale)}: ${computed.budgetOnly.length + computed.actualOnly.length}`,
    ...perPeriod,
  ];
}

/** Everything the narrator is allowed to know, already written for the reader's language. */
export function budgetPromptFacts(computed: BudgetComputed, locale: ReportLocale): string {
  const currency = budgetCurrency(computed, locale);
  const rule = budgetThresholdSentence(
    locale,
    formatBudgetAmount(computed.thresholds.abs, locale, currency),
    formatBudgetPercent(computed.thresholds.pct, locale),
    computed.thresholds.mode,
  );
  return [
    rule,
    ...flaggedBlock(computed, locale, currency),
    ...periodOnlyBlock(computed, locale, currency),
    ...rollUpBlock(computed, locale, currency),
    ...unmatchedBlock(computed, locale),
    ...countsBlock(computed, locale),
    heading("onBudget", locale),
  ].join("\n");
}

/**
 * A figure and its magnitude.
 *
 * The facts print a variance signed — "-Rp 22.300.000" — and a narrator writing either language moves
 * that sign into a word: "under budget by Rp 22.300.000", "di bawah anggaran Rp 22.300.000". That is
 * the same figure said the way a reader says it, so both readings are allowed. The direction itself is
 * never left to the narrator: it is stated in code, in every table, flag and fact.
 */
function withMagnitudes(values: readonly number[]): number[] {
  return values.flatMap((value) => (value < 0 ? [value, Math.abs(value)] : [value]));
}

function cellNumbers(cell: BudgetVarianceCell): number[] {
  const pct = cell.variancePct;
  return [
    cell.budget,
    cell.actual,
    cell.variance,
    ...(pct === null ? [] : [pct, Number(pct.toFixed(BUDGET_PERCENT_DECIMALS))]),
  ];
}

/**
 * Every figure the narrative may quote: the confirmed rows, every cell of every line and roll-up,
 * the counts, the two limits, and the one-decimal reading each percentage is printed as.
 */
export function budgetAllowedNumbers(input: BudgetTaskInput, computed: BudgetComputed): readonly number[] {
  const cells = [
    ...computed.lines.flatMap((line) => [line.total, ...line.periods]),
    ...computed.aggregates.flatMap((aggregate) => [aggregate.total, ...aggregate.periods]),
  ];
  const result = budgetAggregate(computed, "result");
  return [
    ...new Set(
      withMagnitudes(
        [
          ...input.items.map((item) => item.amount),
          ...cells.flatMap(cellNumbers),
          ...(result ? cellNumbers(result.total) : []),
          computed.lines.length,
          computed.flagCounts.total,
          computed.budgetOnly.length,
          computed.actualOnly.length,
          computed.budgetOnly.length + computed.actualOnly.length,
          ...computed.flagCounts.byPeriod.map((entry) => entry.count),
          computed.thresholds.pct,
          computed.thresholds.abs,
        ].filter((value) => Number.isFinite(value)),
      ),
    ),
  ];
}

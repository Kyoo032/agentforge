/**
 * Cash flow and runway, as a task module.
 *
 * The whole of the core half of this task is the wiring below: a schema for the rows the reader
 * confirmed, `computeCashflow` for every number, `cashflowReport` for the object the renderers read,
 * and the facts/allowed pair the guard rests on. The arithmetic lives in `../cashflow/**`, one module
 * per question, so nothing here does anything but hold them together.
 *
 * Input: monthly cash in and out over an opening balance
 * Code math: burn on every basis, runway, breakeven, and one typed what-if
 * Sections: position, burn-and-runway, scenario, flags
 */
import { computeCashflow, cashflowInputSchema, type CashflowComputed, type CashflowInput } from "../cashflow/compute";
import { cashflowAllowedNumbers, cashflowPromptFacts } from "../cashflow/facts";
import { cashflowReport } from "../cashflow/report";
import type { FinanceReport, ReportLocale } from "../report";
import type { FinanceTaskModule, FinanceTaskProse, FinanceTaskReportOptions, FinanceTaskSection } from "./types";

/** The four sections the narration is asked for, in order. Matches `sections` in `../tasks.ts`. */
const SECTIONS: readonly FinanceTaskSection[] = Object.freeze([
  { id: "position", title: { id: "Posisi kas", en: "Where the cash stands" } },
  { id: "burn-and-runway", title: { id: "Burn dan runway", en: "Burn and runway" } },
  { id: "scenario", title: { id: "Skenario what-if", en: "The what-if" } },
  { id: "flags", title: { id: "Yang perlu diperhatikan", en: "What to watch" } },
]);

export const cashflowTaskModule: FinanceTaskModule<CashflowInput, CashflowComputed> = {
  id: "cashflow",
  inputSchema: cashflowInputSchema,
  compute(input: CashflowInput): CashflowComputed {
    return computeCashflow(input);
  },
  buildReport(
    computed: CashflowComputed,
    prose: FinanceTaskProse,
    options: FinanceTaskReportOptions = {},
  ): FinanceReport {
    return cashflowReport(computed, prose, options);
  },
  promptFacts(computed: CashflowComputed, locale: ReportLocale): string {
    return cashflowPromptFacts(computed, locale);
  },
  allowedNumbers(input: CashflowInput, computed: CashflowComputed): readonly number[] {
    return cashflowAllowedNumbers(input, computed);
  },
  sections: SECTIONS,
};

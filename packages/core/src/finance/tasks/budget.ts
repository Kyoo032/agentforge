/**
 * Budget versus actual as a task module.
 *
 * Seven lines of wiring over `../budget/**`, which is where the arithmetic lives. The shape of this
 * file is the contract: `compute` is the only place a number is made, `promptFacts` is the only thing
 * the model is shown, and `allowedNumbers` is the only thing the guard will take back — so a line's
 * variance can be narrated, and a variance nobody computed cannot.
 */
import {
  budgetAllowedNumbers,
  budgetInputSchema,
  budgetPromptFacts,
  budgetReport,
  computeBudget,
  type BudgetComputed,
  type BudgetTaskInput,
} from "../budget";
import type { FinanceReport, ReportLocale } from "../report";
import type { FinanceTaskModule, FinanceTaskProse, FinanceTaskReportOptions } from "./types";

export { budgetInputSchema, budgetParamsSchema } from "../budget";
export type { BudgetTaskInput } from "../budget";

/** The three sections this task always ends in, matching its row in `../tasks.ts`. */
const SECTIONS = Object.freeze([
  Object.freeze({ id: "variance-table", title: Object.freeze({ id: "Bacaan selisih", en: "The variance read" }) }),
  Object.freeze({ id: "flagged-lines", title: Object.freeze({ id: "Baris yang ditandai", en: "The flagged lines" }) }),
  Object.freeze({ id: "notes", title: Object.freeze({ id: "Catatan", en: "Notes" }) }),
]);

export const budgetTaskModule: FinanceTaskModule<BudgetTaskInput, BudgetComputed> = {
  id: "budget",
  inputSchema: budgetInputSchema,
  compute(input: BudgetTaskInput): BudgetComputed {
    return computeBudget(input);
  },
  buildReport(
    computed: BudgetComputed,
    prose: FinanceTaskProse,
    options: FinanceTaskReportOptions = {},
  ): FinanceReport {
    return budgetReport(computed, prose, options);
  },
  promptFacts(computed: BudgetComputed, locale: ReportLocale): string {
    return budgetPromptFacts(computed, locale);
  },
  allowedNumbers(input: BudgetTaskInput, computed: BudgetComputed): readonly number[] {
    return budgetAllowedNumbers(input, computed);
  },
  sections: SECTIONS,
};

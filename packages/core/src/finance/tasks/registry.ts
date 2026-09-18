/**
 * Every Finance task module, behind one frozen map.
 *
 * One import per task file and nothing else: a worker building a task replaces exactly one file and
 * flips one `available` flag, and never edits a switch this file would otherwise grow. A `null` here
 * is the honest answer for a task whose flow is not built — the host refuses it at the boundary and
 * the studio says so in one line, rather than half a pipeline running.
 */
import { FINANCE_TASKS, isFinanceTask, type FinanceTask } from "../task-ids";
import { appraisalTaskModule } from "./appraisal";
import { briefTaskModule } from "./brief";
import { budgetTaskModule } from "./budget";
import { cashflowTaskModule } from "./cashflow";
import { ratiosTaskModule } from "./ratios";
import type { AnyFinanceTaskModule } from "./types";

const MODULES: Readonly<Record<FinanceTask, AnyFinanceTaskModule | null>> = Object.freeze({
  brief: briefTaskModule,
  cashflow: cashflowTaskModule,
  budget: budgetTaskModule,
  appraisal: appraisalTaskModule,
  ratios: ratiosTaskModule,
});

export const FINANCE_TASK_MODULES = MODULES;

/** The module for this task, or null while its flow is still being built. */
export function getFinanceTaskModule(task: unknown): AnyFinanceTaskModule | null {
  return isFinanceTask(task) ? MODULES[task] : null;
}

/** True when the task has a module behind it. Pairs with `financeTaskAvailable` in the meta. */
export function hasFinanceTaskModule(task: unknown): boolean {
  return getFinanceTaskModule(task) !== null;
}

/** The task ids that have a module today, in the catalog's own order. */
export function implementedFinanceTasks(): readonly FinanceTask[] {
  return FINANCE_TASKS.filter((task) => MODULES[task] !== null);
}

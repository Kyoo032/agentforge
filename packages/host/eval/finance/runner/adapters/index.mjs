/**
 * One adapter per Finance task, behind one frozen map — the same shape the product
 * keeps its own task registry in, and for the same reason: a new task is a new
 * file, never a new branch in a switch.
 *
 * A task with no adapter falls back to the brief's, which is what an older case
 * that names no task already means.
 */
import { appraisalAdapter } from "./appraisal.mjs";
import { briefAdapter } from "./brief.mjs";
import { budgetAdapter } from "./budget.mjs";
import { cashflowAdapter } from "./cashflow.mjs";
import { ratiosAdapter } from "./ratios.mjs";

export const TASK_ADAPTERS = Object.freeze({
  brief: briefAdapter,
  cashflow: cashflowAdapter,
  budget: budgetAdapter,
  appraisal: appraisalAdapter,
  ratios: ratiosAdapter,
});

export const TASK_IDS = Object.freeze(Object.keys(TASK_ADAPTERS));

export function adapterFor(task) {
  return TASK_ADAPTERS[task] ?? briefAdapter;
}

export { appraisalAdapter, briefAdapter, budgetAdapter, cashflowAdapter, ratiosAdapter };

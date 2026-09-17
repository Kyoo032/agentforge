"use client";

/**
 * Which step components the studio renders for a task.
 *
 * One import per task folder and nothing else. A task worker replaces exactly one
 * `finance-steps/<task>/index.tsx` and flips that task's `available` in the core meta; this file
 * never grows a branch, and two workers never edit the same line.
 */
import { DEFAULT_FINANCE_TASK, type FinanceTask } from "@/lib/finance-task";
import { APPRAISAL_STEPS } from "./appraisal";
import { BRIEF_STEPS } from "./brief";
import { BUDGET_STEPS } from "./budget";
import { CASHFLOW_STEPS } from "./cashflow";
import { RATIOS_STEPS } from "./ratios";
import type { FinanceStepEntry } from "./types";

const STEPS: Readonly<Record<FinanceTask, FinanceStepEntry>> = Object.freeze({
  brief: BRIEF_STEPS,
  cashflow: CASHFLOW_STEPS,
  budget: BUDGET_STEPS,
  appraisal: APPRAISAL_STEPS,
  ratios: RATIOS_STEPS,
});

export const FINANCE_STEPS = STEPS;

/** This task's steps, with the brief's behind an id that is somehow not ours. */
export function financeStepsFor(task: FinanceTask): FinanceStepEntry {
  return STEPS[task] ?? STEPS[DEFAULT_FINANCE_TASK];
}

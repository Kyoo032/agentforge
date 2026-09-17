/**
 * Finance ships one route and several named tasks, each with its own phases.
 * The rail picks the task, the URL carries it, and this module is the one place
 * the renderer reads the catalog from: labels and hints in the reader's
 * language, the task's phase list, and whether the task runs yet.
 *
 * The logic lives here rather than in the components so it can be unit tested;
 * `apps/web` runs vitest without a DOM.
 */
import {
  DEFAULT_FINANCE_TASK,
  FINANCE_PHASES,
  FINANCE_PHASE_KINDS,
  FINANCE_TASKS,
  FINANCE_TASK_META,
  availableFinanceTasks,
  defaultFinancePrompt,
  financeTaskAvailable,
  financeTaskMeta,
  financeTaskPhases,
  isFinancePhase,
  isFinanceTask,
  type FinancePhaseId,
  type FinancePhaseKind,
  type FinanceTask,
} from "@agentforge/core/finance";

export {
  DEFAULT_FINANCE_TASK,
  FINANCE_PHASES,
  FINANCE_PHASE_KINDS,
  FINANCE_TASKS,
  FINANCE_TASK_META,
  availableFinanceTasks,
  defaultFinancePrompt,
  financeTaskAvailable,
  financeTaskMeta,
  financeTaskPhases,
  isFinancePhase,
  isFinanceTask,
};
export type { FinancePhaseId, FinancePhaseKind, FinanceTask };

/** Same two values the rest of the app calls a language. */
export type FinanceTaskLanguage = "id" | "en";

export const FINANCE_PATH = "/finance";

/** The task the URL names, with the brief behind an absent or unknown value. */
export function taskFromParam(value: string | null | undefined): FinanceTask {
  return isFinanceTask(value) ? value : DEFAULT_FINANCE_TASK;
}

/** `/finance?task=<id>` — the one place the rail links a task. */
export function financeTaskHref(id: FinanceTask): string {
  return `${FINANCE_PATH}?task=${encodeURIComponent(id)}`;
}

export function financeTaskLabel(id: FinanceTask, locale: FinanceTaskLanguage): string {
  const { label } = financeTaskMeta(id);
  return locale === "en" ? label.en : label.id;
}

export function financeTaskHint(id: FinanceTask, locale: FinanceTaskLanguage): string {
  const { hint } = financeTaskMeta(id);
  return locale === "en" ? hint.en : hint.id;
}

export function financeTaskSampleFigures(id: FinanceTask, locale: FinanceTaskLanguage): string {
  const { sampleFigures } = financeTaskMeta(id);
  return locale === "en" ? sampleFigures.en : sampleFigures.id;
}

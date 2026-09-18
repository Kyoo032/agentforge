/**
 * `task` on a Finance request body, read and validated at the boundary.
 *
 * Finance is one route per verb and many tasks behind it, the way Market is one
 * route and many desks: the studio puts the task on the body, the host decides
 * whether it is one of ours. An absent or unknown value is the brief — the task
 * Finance has always done — so an old client and a hand-written request both
 * keep working. A task that exists but is not built yet is a 400 that says so,
 * rather than a half-run pipeline.
 */
import { ApiError, type AppLocale } from "@agentforge/core";
import {
  DEFAULT_FINANCE_TASK,
  financeTaskAvailable,
  financeTaskMeta,
  financeTaskSystemRules,
  isFinanceTask,
  type FinanceTask,
} from "@agentforge/core/finance";
import { localeForRun } from "./run-context";

/** The task the body names, with the brief behind an absent or unknown value. */
export function readFinanceTask(body: unknown): FinanceTask {
  if (!body || typeof body !== "object") {
    return DEFAULT_FINANCE_TASK;
  }
  const task = (body as { task?: unknown }).task;
  return isFinanceTask(task) ? task : DEFAULT_FINANCE_TASK;
}

/** Why a task that is not built yet cannot run, naming it in the reader's language. */
export function financeTaskUnavailableMessage(task: FinanceTask, locale: AppLocale): string {
  const meta = financeTaskMeta(task);
  return locale === "en"
    ? `The "${meta.label.en}" finance task is not built yet. Pick "${financeTaskMeta(DEFAULT_FINANCE_TASK).label.en}" in the rail.`
    : `Tugas keuangan "${meta.label.id}" belum tersedia. Pilih "${financeTaskMeta(DEFAULT_FINANCE_TASK).label.id}" di rail.`;
}

/**
 * The task's own bullet rules under the shared Finance system prompt.
 *
 * The brief has none, so its prompt comes back byte-identical to the one that
 * ships today: the whole point of the catalog is that adding tasks cannot move
 * the task Finance already does.
 */
export function withFinanceTaskRules(base: string, task: FinanceTask, locale: AppLocale): string {
  const rules = financeTaskSystemRules(task, locale === "en" ? "en" : "id");
  return rules.length === 0 ? base : `${base}\n${rules.join("\n")}`;
}

/**
 * The task this request runs as. Throws when the body names a task that ships
 * later, so the studio's unavailable line and the host agree on one answer.
 */
export function requireFinanceTask(body: unknown): FinanceTask {
  const task = readFinanceTask(body);
  if (!financeTaskAvailable(task)) {
    throw new ApiError("finance_task_unavailable", financeTaskUnavailableMessage(task, localeForRun()), 400);
  }
  return task;
}

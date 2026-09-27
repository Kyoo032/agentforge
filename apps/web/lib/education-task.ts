/**
 * Education ships one route and four named tasks. The rail picks the task, the
 * URL carries it, and an empty query is the chooser. An unknown value resolves
 * to the lesson, the same way Finance resolves an unknown task to the brief.
 */
export const EDUCATION_TASKS = ["lesson", "quiz", "page", "show"] as const;

export type EducationTask = (typeof EDUCATION_TASKS)[number];

export const DEFAULT_EDUCATION_TASK: EducationTask = "lesson";

export const EDUCATION_PATH = "/education";

export function isEducationTask(value: string | null | undefined): value is EducationTask {
  return EDUCATION_TASKS.includes(value as EducationTask);
}

/** The task the URL names. An absent or unknown value is the lesson. */
export function taskFromParam(value: string | null | undefined): EducationTask {
  return isEducationTask(value) ? value : DEFAULT_EDUCATION_TASK;
}

/** `/education?task=<id>` — the one place the rail links a task. */
export function educationTaskHref(id: EducationTask): string {
  return `${EDUCATION_PATH}?task=${encodeURIComponent(id)}`;
}

/**
 * What happens when the number guard blanks a figure in a *task's* narration.
 *
 * The brief already answers that question — one rewrite of the marked section with the offending
 * sentence quoted back, then a clean sentence removal and a flag that says a sentence went — and a
 * task must not grow a second, slightly different copy of it. So this file is an adapter and nothing
 * else: task prose in, `finance-section-repair.ts` in the middle, task prose out. The logic that
 * decides what to quote, what to keep and what to take out lives there, once.
 *
 * The rule this enforces: "[unverified figure]" is a message to us, never to the reader. It may not
 * reach a report note, the markdown, or any export.
 */
import {
  REMOVED_SENTENCE_FLAG,
  UNVERIFIED_MARKER,
  type ComputedFinance,
  type FinanceReport,
  type FinanceTaskProse,
  type ReportLocale,
} from "@agentforge/core/finance";
import type { FinanceBrief } from "@agentforge/core/artifacts";
import type { GuardReport } from "../finance-brief-build";
import { repairUnverifiedSections, stripMarkedSentences, type RepairPrompt } from "../finance-section-repair";

/**
 * The rewrite is asked for in the brief's section shape because `parseBriefSection` reads the answer:
 * one module, one contract. The task's own facts are the only figures on offer.
 */
export const FINANCE_TASK_REPAIR_SYSTEM = `You rewrite one section of a DPSBuddy finance report.
Return ONLY valid JSON (no markdown fences) with this exact shape: { "heading": string, "body": string, "metrics": [] }
Rules:
- Every number in the body must be one of the facts listed above, written with the same value. Add none.
- Leave "metrics" as an empty list.
- Keep the section on its own topic: 2 to 4 short paragraphs, "\\n\\n" between them.
- Never write the marker "[unverified figure]" yourself.`;

export type TaskRepairResult = {
  readonly prose: FinanceTaskProse;
  readonly guard: GuardReport;
  /** True only when a section really was sent back, so the runner can emit a step for it. */
  readonly repaired: boolean;
};

/** Whether any section still carries the guard's marker. Nothing is asked of the model otherwise. */
export function hasUnverifiedFigure(prose: FinanceTaskProse): boolean {
  return prose.sections.some((section) => section.body.includes(UNVERIFIED_MARKER));
}

/** Task prose in the brief's section shape. Tables and metric keys are the brief's, so they stay empty. */
function asBrief(prose: FinanceTaskProse): FinanceBrief {
  return {
    title: prose.title,
    sections: prose.sections.map((section) => ({
      heading: section.heading,
      body: section.body,
      tables: [],
      metrics: [],
    })),
    assumptions: [...prose.assumptions],
    computed: { metrics: [], tables: [] },
  };
}

/**
 * The task's allowed figures dressed as the brief's computed shape. The repair reads `allowed` (the
 * guard) and `metrics` (which keys a section may cite); a task cites no keys, so that list is empty.
 */
function asComputed(allowed: readonly number[]): ComputedFinance {
  return { metrics: [], tables: [], allowed: [...allowed], checks: [] };
}

/**
 * One rewrite per marked section using only the task's own facts, then a clean removal.
 *
 * Section ids are the task's, not the model's: the rewrite may rename a heading, but the id the
 * report builder keys on is carried straight through.
 */
export async function repairTaskProse(
  prose: FinanceTaskProse,
  allowed: readonly number[],
  prompt: RepairPrompt,
): Promise<TaskRepairResult> {
  if (!hasUnverifiedFigure(prose)) {
    return { prose, guard: { flagged: [], total: 0, removed: 0 }, repaired: false };
  }
  const result = await repairUnverifiedSections(asBrief(prose), asComputed(allowed), prompt);
  const sections = prose.sections.map((section, index) => {
    const rewritten = result.brief.sections[index];
    return rewritten ? { ...section, heading: rewritten.heading, body: rewritten.body } : section;
  });
  return { prose: { ...prose, sections }, guard: result.guard, repaired: true };
}

/** Every note body with its marked sentences taken out, and how many sentences that cost. */
function scrubNotes(report: FinanceReport): { notes: FinanceReport["notes"]; removed: number } {
  let removed = 0;
  const notes = report.notes.map((note) => {
    if (!note.body.includes(UNVERIFIED_MARKER)) {
      return note;
    }
    const stripped = stripMarkedSentences(note.body);
    removed += stripped.removed.length;
    return { ...note, body: stripped.body };
  });
  return { notes, removed };
}

/** Chart captions come from the same prose, so they are swept on the same terms. */
function scrubCharts(report: FinanceReport): { charts: FinanceReport["charts"]; removed: number } {
  let removed = 0;
  const charts = report.charts.map((chart) => {
    if (!chart.note?.includes(UNVERIFIED_MARKER)) {
      return chart;
    }
    const stripped = stripMarkedSentences(chart.note);
    removed += stripped.removed.length;
    return stripped.body ? { ...chart, note: stripped.body } : { ...chart, note: undefined };
  });
  return { charts, removed };
}

/**
 * The last gate before a report is saved, rendered or exported.
 *
 * The repair above already takes the marker out of every section, but a builder is free to write a
 * note or a chart caption of its own, so the finished report is swept once more. Nothing is rewritten
 * here and no model is asked: a marked sentence is simply gone.
 */
export function scrubReportMarkers(report: FinanceReport): { report: FinanceReport; removed: number } {
  const notes = scrubNotes(report);
  const charts = scrubCharts(report);
  const removed = notes.removed + charts.removed;
  if (removed === 0) {
    return { report, removed };
  }
  return { report: { ...report, notes: notes.notes, charts: charts.charts }, removed };
}

/**
 * The reader is told, once, that the report is short by a sentence — the same words the brief uses,
 * so the two paths cannot describe the same event differently. A builder that already said it keeps
 * its own flag.
 */
export function withRemovedFlag(report: FinanceReport, removed: number, locale: ReportLocale): FinanceReport {
  const text = REMOVED_SENTENCE_FLAG[locale] ?? REMOVED_SENTENCE_FLAG.en;
  if (removed <= 0 || report.flags.some((flag) => flag.text === text)) {
    return report;
  }
  return { ...report, flags: [...report.flags, { level: "watch", text }] };
}

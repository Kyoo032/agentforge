/**
 * One pipeline, every Finance task.
 *
 * validate → compute → facts → narrate → guard → report → save. The task module supplies the four
 * pieces that differ (schema, maths, facts, allowed figures) and nothing else; a task worker writes
 * no pipeline, so a task cannot quietly skip the guard or narrate a number it never computed.
 *
 * The brief keeps the path it has always run (`finance-generate.ts`) — this runner is what the four
 * task flows land on.
 */
import { ApiError, withOutputLanguage } from "@agentforge/core";
import {
  FINANCE_PHASE_KINDS,
  financeTaskPhases,
  type FinancePhaseId,
  type FinanceTask,
  type FinanceTaskModule,
  type FinanceTaskProse,
  type ReportLocale,
} from "@agentforge/core/finance";
import type { JobEmitter } from "@agentforge/core/jobs";
import { collectJobAssistantRun, type JobAssistantRun } from "../job-regen";
import { throwIfJobAborted } from "../job-stream";
import { readSourceText } from "../job-source";
import type { GuardReport } from "../finance-brief-build";
import { guardFinanceInput } from "../finance-privacy";
import { readFinanceLocale } from "../finance-locale";
import { withFinanceTaskRules } from "../finance-task";
import { renderMd } from "../renderers/md";
import { upsertWorkSource } from "../knowledge-ingest";
import { artifactWorkCard } from "../work-cards";
import { readModelPinned, readPrompt, requireLive, resolveModel } from "./live";
import { FINANCE_TASK_SYSTEM, guardNarration, parseNarration, sectionRequest, type NarrationDraft } from "./narrate";
import { FINANCE_TASK_REPAIR_SYSTEM, repairTaskProse, scrubReportMarkers, withRemovedFlag } from "./repair";
import { financeTaskArtifactMeta, financeTaskProvenance, persistFinanceTaskReport } from "./persist";
import type { FinanceTaskRunContext, FinanceTaskRunResult } from "./types";

/**
 * The code-math steps THIS run performs, in the order the task's own flow graph draws them.
 *
 * The studio maps a phase id to a localized label, so a run has to report under the ids its own
 * task declares rather than under one pipeline's shared names. A run does not perform the whole
 * graph, though: everything up to and including the task's last shared step — pasting, parsing,
 * confirming — already happened on the parse route, and announcing it again here would tell the
 * reader that work is being redone. So the run announces the math steps after that point, which is
 * exactly what the compute step does. A task with none (the brief) falls back to its last math step, and
 * one with no math step at all to its first phase, so a run is never silent.
 */
export function runnerMathPhases(task: FinanceTask): readonly FinancePhaseId[] {
  const phases = financeTaskPhases(task);
  const isMath = (phase: FinancePhaseId): boolean => FINANCE_PHASE_KINDS[phase] === "math";
  const head = phases.slice(0, -1);
  const lastShared = Math.max(
    -1,
    ...head.map((phase, index) => (FINANCE_PHASE_KINDS[phase] === "shared" ? index : -1)),
  );
  const own = phases.slice(lastShared + 1).filter(isMath);
  if (own.length > 0) {
    return own;
  }
  const math = phases.filter(isMath);
  return math.length > 0 ? math.slice(-1) : phases.slice(0, 1);
}

/**
 * The two phase ids this runner ends on, taken from the same graph: its last code math step, then
 * its last step — which every graph draws as "narrate, guard, export".
 */
export function runnerPhases(task: FinanceTask): { readonly compute: FinancePhaseId; readonly finish: FinancePhaseId } {
  const phases = financeTaskPhases(task);
  const math = runnerMathPhases(task);
  const finish = phases[phases.length - 1];
  const compute = math[math.length - 1] ?? finish;
  if (!finish || !compute) {
    throw new ApiError("internal_error", `finance task ${task} declares no phases`, 500);
  }
  return { compute, finish };
}

/**
 * The language this run answers in. The studio sends it on the request because the owner can be
 * reading an Indonesian statement in an English app; taking it from the run context instead is how
 * an Indonesian cash-flow file came back narrated in English. Same reader the brief path uses, so
 * the two can never disagree, and the whole run — prompt, narration and report — gets this one value.
 */
export function runnerLocale(body: unknown): ReportLocale {
  return readFinanceLocale(body) === "en" ? "en" : "id";
}

function readInput<I>(module: FinanceTaskModule<I, unknown>, body: unknown): I {
  const parsed = module.inputSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(
      "invalid_request",
      `The ${module.id} task needs its confirmed inputs. Parse the figures first and confirm them.`,
      400,
    );
  }
  return parsed.data;
}

async function narrate<I, C>(
  module: FinanceTaskModule<I, C>,
  computed: C,
  options: {
    tenant: FinanceTaskRunContext["tenant"];
    model: string;
    /** The person changed the picker for this request, so a stand-in model must not be used. */
    modelExplicit: boolean;
    locale: ReportLocale;
    question: string;
    extra: string;
  },
): Promise<JobAssistantRun> {
  const run = await collectJobAssistantRun({
    tenant: options.tenant,
    model: options.model,
    modelExplicit: options.modelExplicit,
    systemPrompt: withOutputLanguage(
      withFinanceTaskRules(FINANCE_TASK_SYSTEM, module.id, options.locale),
      "finance",
      options.locale,
    ),
    runPrefix: `finance-${module.id}`,
    agentId: "finance",
    jobMode: "finance",
    versionId: `finance-${module.id}`,
    prompt: [
      module.promptFacts(computed, options.locale),
      sectionRequest(module.sections, options.locale),
      options.extra ? `Extra context:\n${options.extra}` : null,
      `Requested:\n${options.question}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  if (!run.text.trim()) {
    throw new ApiError("generation_failed", `The ${module.id} task came back empty`, 502);
  }
  return run;
}

type VerifyOptions = {
  readonly tenant: FinanceTaskRunContext["tenant"];
  /** The model that actually answered the narration; the rewrite goes back to the same one. */
  readonly model: string;
  readonly locale: ReportLocale;
  /** The task's own `promptFacts` — the only figures a rewrite may use. */
  readonly factsBlock: string;
  readonly emit: JobEmitter;
  readonly phase: FinancePhaseId;
};

/**
 * Guard every body, then repair whatever the guard blanked.
 *
 * The repair is the brief's, reached through `finance-tasks/repair.ts`: one rewrite of the marked
 * section with the offending sentence quoted back, then a clean sentence removal. The marker is a
 * message to us and never to the reader, so it may not survive this function.
 */
async function verifyNarration(
  draft: NarrationDraft,
  allowed: readonly number[],
  options: VerifyOptions,
): Promise<{ prose: FinanceTaskProse; guard: GuardReport }> {
  const { prose, guard } = guardNarration(draft, allowed);
  options.emit({
    type: "job.step",
    phase: options.phase,
    label: guard.total === 0 ? "All figures trace to inputs" : `${guard.total} unverified figure(s) removed`,
  });
  const repair = await repairTaskProse(prose, allowed, {
    tenant: options.tenant,
    model: options.model,
    systemPrompt: withOutputLanguage(FINANCE_TASK_REPAIR_SYSTEM, "finance", options.locale),
    factsBlock: options.factsBlock,
    locale: options.locale,
  });
  if (repair.repaired) {
    options.emit({
      type: "job.step",
      phase: options.phase,
      label: `${repair.guard.removed ?? 0} sentence(s) removed after one rewrite`,
    });
  }
  return {
    prose: repair.prose,
    guard: {
      flagged: [...guard.flagged, ...repair.guard.flagged],
      total: guard.total + repair.guard.total,
      removed: repair.guard.removed ?? 0,
    },
  };
}

/** What the desk should be told about this run beyond the report itself. */
function runWarnings(flagged: number, removed: number): string[] {
  return [
    ...(flagged > 0 ? [`${flagged} figure(s) did not trace to the computed facts and were taken out`] : []),
    ...(removed > 0 ? [`${removed} sentence(s) were removed because their figure could not be traced`] : []),
  ];
}

export async function runFinanceTask<I, C>(
  module: FinanceTaskModule<I, C>,
  ctx: FinanceTaskRunContext,
): Promise<FinanceTaskRunResult> {
  const { tenant, body, emit, abortSignal } = ctx;
  const question = readPrompt(body);
  const settings = requireLive(tenant.workspaceId);
  const model = resolveModel(body, settings);
  // Source material reaches the same prompt as the task's figures, so it is redacted on the same
  // terms. The task's OWN rows are redacted where they are read: see `parse-<task>.ts`.
  const source = guardFinanceInput({
    figuresText: readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true }),
  });
  const extra = source.figuresText;
  const locale: ReportLocale = runnerLocale(body);
  const phases = runnerPhases(module.id);

  throwIfJobAborted(abortSignal);
  // Every math step the task's graph draws, in its own order. The arithmetic itself is one
  // synchronous call, so the figure count lands on the last of those steps.
  for (const phase of runnerMathPhases(module.id)) {
    emit({ type: "job.phase", phase, label: phase });
  }
  const input = readInput(module, body);
  const computed = module.compute(input);
  const allowed = module.allowedNumbers(input, computed);
  emit({ type: "job.step", phase: phases.compute, label: `${allowed.length} figure(s) computed in code` });

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: phases.finish, label: phases.finish });
  const run = await narrate(module, computed, {
    tenant,
    model,
    modelExplicit: readModelPinned(body),
    locale,
    question,
    extra,
  });

  throwIfJobAborted(abortSignal);
  const { prose, guard } = await verifyNarration(parseNarration(run.text, module.sections, question), allowed, {
    tenant,
    model: run.model,
    locale,
    factsBlock: module.promptFacts(computed, locale),
    emit,
    phase: phases.finish,
  });

  // Swept once more after the builder has had the prose: a note or a caption it wrote itself is
  // held to the same rule, so no export can carry the marker.
  const swept = scrubReportMarkers(module.buildReport(computed, prose, { locale, guard }));
  const removed = (guard.removed ?? 0) + swept.removed;
  const report = withRemovedFlag(swept.report, removed, locale);
  const markdown = Buffer.from((await renderMd(report)).bytes).toString("utf8");
  const artifactId = persistFinanceTaskReport(
    tenant,
    report,
    markdown,
    financeTaskArtifactMeta(
      financeTaskProvenance({
        task: module.id,
        model: run.model,
        locale,
        question,
        flagged: guard.total,
        removed,
      }),
      report,
      guard,
    ),
  );
  if (artifactId) {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({
        type: "Finance",
        artifactId,
        title: report.title,
        prompt: question,
        markdown,
        model: run.model,
      }),
    );
  }
  const warnings = runWarnings(guard.total, removed);
  return {
    task: module.id,
    report,
    artifactId,
    markdown,
    guard,
    pii: source.pii,
    model: run.model,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(run.notice ? { notice: run.notice } : {}),
  };
}

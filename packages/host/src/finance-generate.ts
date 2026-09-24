import { ApiError, modeMessage, withOutputLanguage, type AppLocale, type TenantContext } from "@agentforge/core";
import { financeBriefSchema, financeBriefToMarkdown, type FinanceBrief } from "@agentforge/core/artifacts";
import {
  DEFAULT_FINANCE_TASK,
  getFinanceTaskModule,
  lineItemsFromTable,
  type LineItem,
} from "@agentforge/core/finance";
import type { JobEmitter } from "@agentforge/core/jobs";
import { artifactStore } from "./artifacts";
import { financeArtifactMeta } from "./finance-artifact";
import { upsertWorkSource } from "./knowledge-ingest";
import { artifactWorkCard } from "./work-cards";
import { requireDataset } from "./datasets";
import {
  buildFinanceBrief,
  computeFinance,
  financePromptBlock,
  guardSection,
  parseBriefDraft,
  parseBriefSection,
  readFinanceInputs,
  type FinanceInputs,
  type GuardReport,
} from "./finance-brief-build";
import { readFinanceLocale } from "./finance-locale";
import { readStatedFacts, statedFactsBlock, withStatedFacts } from "./finance-stated";
import { parseFiguresText, type ParsedFigures } from "./finance-parse-figures";
import { repairUnverifiedSections } from "./finance-section-repair";
import { guardFinanceInput, mergeFinancePii, type FinancePiiSummary } from "./finance-privacy";
import { readFinanceTask, withFinanceTaskRules } from "./finance-task";
import {
  appendRegenInstruction,
  collectJobAssistantRun,
  readOptionalInstruction,
  type JobAssistantRun,
} from "./job-regen";
import { readSourceText } from "./job-source";
import { throwIfJobAborted } from "./job-stream";
import { readModelPinned, readPrompt, requireLive, resolveModel } from "./finance-tasks/live";
import { runFinanceTask } from "./finance-tasks/runner";
import type { FinanceTaskRunResult } from "./finance-tasks/types";
import { log } from "./log";

export { FIGURES_TEXT_MAX } from "./finance-parse-figures";
export type { ParsedFigures } from "./finance-parse-figures";

const BRIEF_SYSTEM = `You write a finished finance brief for DPSBuddy from line items and metrics that were computed in code.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "title": string,
  "sections": [{ "heading": string, "body": string, "metrics": [string] }],
  "assumptions": [string]
}
Rules:
- Every number in a body must be copied from a "Write as" cell, character for character. Anything else is stripped by a guard, so do not estimate, reformat or re-round.
- metrics lists the keys of the computed metrics the section relies on.
- If the metrics you need are missing, say what input is missing instead of inventing it.
- 3 to 6 sections, each 2 to 4 short paragraphs (\\n\\n between paragraphs). Headings are claims or jobs, not labels.
- assumptions: what the reader must accept for the brief to hold (periods, currency, what is excluded).
- No campus / student / course nouns unless the topic itself requires them.`;

const SECTION_SYSTEM = `You rewrite one section of an DPSBuddy finance brief.
Return ONLY valid JSON: { "heading": string, "body": string, "metrics": [string] }
Rules: same as the brief. Every number is copied from a "Write as" cell; metrics lists the keys used. Stay on the same topic as the rest of the brief.`;

/**
 * What a section says when the repair took every sentence out of it. A section may not be empty
 * (`financeBriefSchema`), and dropping it would take away the slot the owner regenerates it from —
 * the same reason a regenerate keeps the section it was asked to replace. So the heading stays and
 * the body says why the section is short, in the voice of the removed-sentence flag and with no
 * figure in it for a guard to find.
 */
export const EMPTIED_SECTION_BODY: Readonly<Record<AppLocale, string>> = Object.freeze({
  en: "The text of this section was removed because its figures could not be traced.",
  id: "Teks bagian ini dihapus karena angkanya tidak bisa ditelusuri.",
});

/** The repaired brief with no section left empty: an emptied body says why instead. */
function withEmptiedSectionsNoted(brief: FinanceBrief, locale: AppLocale): FinanceBrief {
  const note = EMPTIED_SECTION_BODY[locale] ?? EMPTIED_SECTION_BODY.en;
  return {
    ...brief,
    sections: brief.sections.map((section) => (section.body.trim() ? section : { ...section, body: note })),
  };
}

export type FinanceResult = {
  brief: FinanceBrief;
  artifactId: string | null;
  markdown: string;
  guard: GuardReport;
  items: LineItem[];
  /** What the privacy guard hid before the prompt was built. The studio shows the count. */
  pii: FinancePiiSummary;
  /** The model that actually answered, and the notice when it was not the one asked for. */
  model?: string;
  notice?: JobAssistantRun["notice"];
};

const NO_EMIT: JobEmitter = () => {};

/**
 * Figures text → line items. An imported table is read in code; only free prose reaches the model,
 * and even then only after the privacy guard has rewritten it.
 */
export async function parseFinanceFigures(tenant: TenantContext, body: unknown): Promise<ParsedFigures> {
  const figures = (body as { figures?: unknown } | null)?.figures;
  if (typeof figures !== "string" || !figures.trim()) {
    throw new ApiError("invalid_request", "figures text is required", 400);
  }
  const settings = requireLive(tenant);
  const model = resolveModel(body, settings);
  const locale = readFinanceLocale(body);
  // Redacted first: the guard reads the owner's own text, and only the redacted copy ever leaves.
  const guarded = guardFinanceInput({ figuresText: figures.trim() });
  // A document's prose reaches the same reader, so it is redacted on the same terms first.
  const raw = (body as { proseText?: unknown } | null)?.proseText;
  const prose = typeof raw === "string" && raw.trim() ? guardFinanceInput({ figuresText: raw.trim() }) : null;
  const parsed = await parseFiguresText({ tenant, model }, guarded.figuresText, locale, {
    proseText: prose?.figuresText ?? "",
  });
  return { ...parsed, pii: prose ? mergeFinancePii(guarded.pii, prose.pii) : guarded.pii };
}

/** Confirmed items, or a dataset's rows mapped to items. Free text must go through parseFinanceFigures first. */
function resolveInputs(tenant: TenantContext, body: unknown, locale: AppLocale): FinanceInputs {
  const direct = readFinanceInputs(body);
  if (direct) {
    return direct;
  }
  const datasetId = (body as { datasetId?: unknown }).datasetId;
  if (typeof datasetId === "string" && datasetId.trim()) {
    const items = lineItemsFromTable(requireDataset(tenant, datasetId.trim()).table);
    if (items.length === 0) {
      throw new ApiError("invalid_request", modeMessage("datasetNoNumericColumn", locale), 400);
    }
    return { items, params: readFinanceInputs({ items, params: (body as { params?: unknown }).params })?.params ?? {} };
  }
  throw new ApiError("invalid_request", "items are required. Parse the pasted figures first and confirm them.", 400);
}

function persistBrief(
  tenant: TenantContext,
  brief: FinanceBrief,
  markdown: string,
  meta: Record<string, unknown>,
): string | null {
  try {
    return artifactStore().create(tenant, {
      mode: "finance",
      kind: "brief",
      title: brief.title,
      mime: "text/markdown",
      body: markdown,
      meta,
    }).id;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("finance_brief_not_saved", { code });
    return null;
  }
}

export async function generateFinanceBrief(
  tenant: TenantContext,
  body: unknown,
  emit: JobEmitter = NO_EMIT,
  abortSignal?: AbortSignal,
): Promise<FinanceResult | FinanceTaskRunResult> {
  // The rail chooses the task and the studio puts it on the body. `brief` adds no
  // rules and is stamped on the artifact the way Market stamps its specialist.
  const task = readFinanceTask(body);
  // Every other task owns its own phases, its own maths and its own report, so it runs the generic
  // runner instead of a second copy of this function. The brief keeps the path below, untouched.
  const taskModule = task === DEFAULT_FINANCE_TASK ? null : getFinanceTaskModule(task);
  if (taskModule) {
    return runFinanceTask(taskModule, { tenant, body, emit, abortSignal });
  }
  const question = readPrompt(body);
  const settings = requireLive(tenant);
  const model = resolveModel(body, settings);
  const locale = readFinanceLocale(body);
  // Source material reaches the same prompt as the line items, so it is redacted on the same terms.
  const source = guardFinanceInput({
    figuresText: readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true }),
  });
  const extra = source.figuresText;

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "computing", label: "Computing metrics" });
  const supplied = resolveInputs(tenant, body, locale);
  // Labels and periods are redacted before `financePromptBlock` writes them into the prompt table.
  const guarded = guardFinanceInput({ lineItems: supplied.items });
  const inputs: FinanceInputs = { items: guarded.lineItems, params: supplied.params };
  const pii = mergeFinancePii(source.pii, guarded.pii);
  // Facts the document stated in a sentence are quotations, not inputs: they may be cited and
  // verified, and they never enter a sum.
  const stated = readStatedFacts(body);
  const computed = withStatedFacts(computeFinance(inputs.items, inputs.params, { locale }), stated, locale);
  emit({
    type: "job.step",
    phase: "computing",
    label: `${computed.metrics.length} metrics from ${inputs.items.length} line items`,
  });

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "drafting", label: "Drafting the brief" });
  const systemPrompt = withOutputLanguage(withFinanceTaskRules(BRIEF_SYSTEM, task, locale), "finance", locale);
  const factsBlock = [financePromptBlock(inputs, computed, locale), statedFactsBlock(stated, locale)]
    .filter(Boolean)
    .join("\n\n");
  const run = await collectJobAssistantRun({
    tenant,
    model,
    modelExplicit: readModelPinned(body),
    systemPrompt,
    runPrefix: "finance",
    agentId: "finance",
    jobMode: "finance",
    versionId: "finance-brief",
    prompt: [factsBlock, extra ? `Extra context:\n${extra}` : null, `Brief requested:\n${question}`]
      .filter(Boolean)
      .join("\n\n"),
  });
  if (!run.text.trim()) {
    throw new ApiError("generation_failed", modeMessage("emptyFinanceBrief", locale), 502);
  }

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "verifying", label: "Checking every figure" });
  const built = buildFinanceBrief(parseBriefDraft(run.text), computed);
  // One rewrite for whatever the guard blanked, then a clean removal: the marker never ships.
  const repaired = await repairUnverifiedSections(built.brief, computed, {
    tenant,
    model: run.model,
    systemPrompt: withOutputLanguage(SECTION_SYSTEM, "finance", locale),
    factsBlock,
    locale,
  });
  const brief = financeBriefSchema.parse(withEmptiedSectionsNoted(repaired.brief, locale));
  const guard: GuardReport = {
    flagged: [...built.guard.flagged, ...repaired.guard.flagged],
    total: built.guard.total + repaired.guard.total,
    // An assumption the guard dropped is a removed sentence too, and the reader is told the same way.
    removed: (built.guard.removed ?? 0) + (repaired.guard.removed ?? 0),
  };
  emit({
    type: "job.step",
    phase: "verifying",
    label: guard.total === 0 ? "All figures trace to inputs" : `${guard.total} unverified figure(s) removed`,
  });

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "saving", label: "Saving brief" });
  const markdown = financeBriefToMarkdown(brief);
  // The structured brief rides along with the provenance: markdown alone cannot give an export
  // back its computed tables or its chart series, and this brief is saved once and read for years.
  const artifactId = persistBrief(
    tenant,
    brief,
    markdown,
    financeArtifactMeta(
      { question, model: run.model, task, itemCount: inputs.items.length, flagged: guard.total },
      brief,
      guard,
    ),
  );
  if (artifactId) {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({
        type: "Finance",
        artifactId,
        title: brief.title,
        prompt: question,
        markdown,
        model: run.model,
      }),
    );
  }
  return {
    brief,
    artifactId,
    markdown,
    guard,
    items: inputs.items,
    pii,
    model: run.model,
    ...(run.notice ? { notice: run.notice } : {}),
  };
}

/**
 * The artifact the brief being rewritten was saved as, when the studio sends it.
 *
 * Regenerate used to answer `artifactId: null`, so "Send to Knowledge Base" after a rewrite took
 * the no-artifact branch and pasted a second, near-identical row next to the card the original
 * generate had already indexed. Carrying the id back makes that send idempotent.
 */
export function readRegenArtifactId(body: unknown): string | null {
  const id = (body as { artifactId?: unknown } | null)?.artifactId;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function readSectionIndex(body: unknown, length: number): number {
  const index = (body as { sectionIndex?: unknown }).sectionIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= length) {
    throw new ApiError("invalid_request", "sectionIndex is out of range", 400);
  }
  return index;
}

/** Rewrite one section with the same inputs, metrics, and guard. */
export async function regenerateFinanceSection(tenant: TenantContext, body: unknown): Promise<FinanceResult> {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const parsedBrief = financeBriefSchema.safeParse((body as { brief?: unknown }).brief);
  if (!parsedBrief.success) {
    throw new ApiError("invalid_request", "brief is missing or malformed", 400);
  }
  const brief = parsedBrief.data;
  const index = readSectionIndex(body, brief.sections.length);
  const current = brief.sections[index];
  if (!current) {
    throw new ApiError("invalid_request", "sectionIndex is out of range", 400);
  }
  const settings = requireLive(tenant);
  const model = resolveModel(body, settings);
  const locale = readFinanceLocale(body);
  const supplied = resolveInputs(tenant, body, locale);
  const guarded = guardFinanceInput({ lineItems: supplied.items });
  const inputs: FinanceInputs = { items: guarded.lineItems, params: supplied.params };
  const computed = computeFinance(inputs.items, inputs.params, { locale });
  const factsBlock = financePromptBlock(inputs, computed, locale);
  const topic =
    typeof (body as { prompt?: unknown }).prompt === "string" ? (body as { prompt: string }).prompt.trim() : "";
  const prompt = appendRegenInstruction(
    [
      factsBlock,
      topic ? `Original brief request: ${topic}` : null,
      `Brief title: ${brief.title}`,
      `Other sections:\n${brief.sections
        .map((section, at) => (at === index ? null : `- ${section.heading}`))
        .filter(Boolean)
        .join("\n")}`,
      `Rewrite this section only.\nHeading: ${current.heading}\nBody:\n${current.body}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    readOptionalInstruction(body),
  );
  const run = await collectJobAssistantRun({
    tenant,
    model,
    modelExplicit: readModelPinned(body),
    systemPrompt: withOutputLanguage(SECTION_SYSTEM, "finance", locale),
    runPrefix: "finance-section",
    agentId: "finance",
    jobMode: "finance",
    versionId: "finance-section",
    prompt,
  });
  const knownKeys = new Set(computed.metrics.map((entry) => entry.key));
  const rewritten = guardSection(parseBriefSection(run.text), computed, knownKeys);
  // The same repair a generate runs: one rewrite for whatever the guard blanked, then the sentence
  // goes. The marker never ships. A section may not be empty, so a rewrite with nothing traceable
  // left keeps the section it was asked to replace, and the guard says why.
  const repaired = await repairUnverifiedSections({ ...brief, sections: [rewritten.section] }, computed, {
    tenant,
    model: run.model,
    systemPrompt: withOutputLanguage(SECTION_SYSTEM, "finance", locale),
    factsBlock,
    locale,
  });
  const candidate = repaired.brief.sections[0];
  const replacement = candidate?.body ? candidate : current;
  const next = financeBriefSchema.parse({
    ...brief,
    sections: brief.sections.map((section, at) => (at === index ? replacement : section)),
    computed: { metrics: computed.metrics, tables: computed.tables },
  });
  const flagged = [...rewritten.flagged, ...repaired.guard.flagged.map((entry) => entry.text)];
  const guard: GuardReport = {
    flagged: flagged.map((text) => ({ section: index, text })),
    total: flagged.length,
    removed: repaired.guard.removed ?? 0,
  };
  const markdown = financeBriefToMarkdown(next);
  // Same origin as the generate that created the artifact, so the loop rewrites that one card
  // with the rewritten brief instead of the Knowledge Base ending up a version behind.
  const artifactId = readRegenArtifactId(body);
  if (artifactId) {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({
        type: "Finance",
        artifactId,
        title: next.title,
        prompt: topic || undefined,
        markdown,
        model: run.model,
      }),
    );
  }
  return {
    brief: next,
    artifactId,
    markdown,
    guard,
    items: inputs.items,
    pii: guarded.pii,
    model: run.model,
    ...(run.notice ? { notice: run.notice } : {}),
  };
}

import { ApiError, hasLiveProvider, resolveChatModel, resolveRuntimeMode, type TenantContext } from "@agentforge/core";
import { financeBriefSchema, financeBriefToMarkdown, type FinanceBrief } from "@agentforge/core/artifacts";
import { lineItemsFromTable, parseLineItems, type LineItem } from "@agentforge/core/finance";
import type { JobEmitter } from "@agentforge/core/jobs";
import { artifactStore } from "./artifacts";
import { upsertWorkSource } from "./knowledge-ingest";
import { artifactWorkCard } from "./work-cards";
import { requireDataset } from "./datasets";
import {
  buildFinanceBrief,
  computeFinance,
  financeMarkdownLabels,
  financePromptBlock,
  guardSection,
  localizeComputedFinance,
  parseBriefDraft,
  parseBriefSection,
  readFinanceInputs,
  stubFinanceDraft,
  type FinanceInputs,
  type GuardReport,
} from "./finance-brief-build";
import { type AppLocale, financeBootLocale, financeCopy, financeFill } from "./finance-locale";
import { appendRegenInstruction, collectJobAssistantText, readOptionalInstruction } from "./job-regen";
import { readSourceText } from "./job-source";
import { throwIfJobAborted } from "./job-stream";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";

export const FIGURES_TEXT_MAX = 12_000;

const PARSE_SYSTEM = `You turn pasted financial figures into line items. Return ONLY JSON:
{"items": [{"label": string, "period": string, "amount": number, "currency": string, "category": "revenue"|"cogs"|"opex"|"cash"|"debt"|"equity"|"asset"|"liability"|"other"}]}
Rules:
- One item per figure in the text. amount is a plain number (no separators, no symbols); keep the sign the text implies.
- period is the text's own label ("2025", "Q1", "Sep", "monthly") or "" when none is given.
- currency is the ISO code when stated or clearly implied (Rp → IDR, $ → USD), else "".
- Never add figures that are not in the text. Do not compute totals or averages.`;

const BRIEF_SYSTEM = `You write a finished finance brief for DPSBuddy from line items and metrics that were computed in code.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "title": string,
  "sections": [{ "heading": string, "body": string, "metrics": [string] }],
  "assumptions": [string]
}
Rules:
- Every number in a body must be one of the line-item amounts or a computed metric value, written with the same value (rounding to one decimal is fine). Anything else is stripped by a guard and shown as "[unverified figure]", so do not estimate.
- metrics lists the keys of the computed metrics the section relies on.
- If the metrics you need are missing, say what input is missing instead of inventing it.
- 3 to 6 sections, each 2 to 4 short paragraphs (\\n\\n between paragraphs). Headings are claims or jobs, not labels.
- assumptions: what the reader must accept for the brief to hold (periods, currency, what is excluded).
- No campus / student / course nouns unless the topic itself requires them.`;

const SECTION_SYSTEM = `You rewrite one section of an DPSBuddy finance brief.
Return ONLY valid JSON: { "heading": string, "body": string, "metrics": [string] }
Rules: same as the brief. Only line-item amounts and computed metric values may appear as numbers; metrics lists the keys used. Stay on the same topic as the rest of the brief.`;

function withLanguageRule(system: string, locale: AppLocale): string {
  return `${system}\n${financeCopy(locale).pipeline.languageInstruction}`;
}

export function financeParseSystemPrompt(locale: AppLocale = financeBootLocale()): string {
  return withLanguageRule(PARSE_SYSTEM, locale);
}

export function financeBriefSystemPrompt(locale: AppLocale = financeBootLocale()): string {
  return withLanguageRule(BRIEF_SYSTEM, locale);
}

export function financeSectionSystemPrompt(locale: AppLocale = financeBootLocale()): string {
  return withLanguageRule(SECTION_SYSTEM, locale);
}

export type FinanceResult = {
  brief: FinanceBrief;
  artifactId: string | null;
  markdown: string;
  guard: GuardReport;
  items: LineItem[];
};

export type ParsedFigures = { items: LineItem[]; needsConfirmation: true };

const NO_EMIT: JobEmitter = () => {};

function readPrompt(body: unknown, locale: AppLocale): string {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", financeCopy(locale).errors.bodyRequired, 400);
  }
  const prompt = (body as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new ApiError("invalid_request", financeCopy(locale).errors.promptRequired, 400);
  }
  return prompt.trim();
}

function readOptionalModel(body: unknown): string | undefined {
  const model = (body as { model?: unknown }).model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

function requireLive(locale: AppLocale = financeBootLocale()): ReturnType<typeof loadSettings> {
  const settings = loadSettings();
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", financeCopy(locale).errors.stub, 503);
  }
  return settings;
}

function resolveModel(body: unknown, settings: ReturnType<typeof loadSettings>): string {
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(
    readOptionalModel(body),
    settings.documentGenModel || defaults.finance,
    listSelectableModels(),
  );
}

/** Free text → line items via the model. Nothing is computed until the user confirms these. */
export async function parseFinanceFigures(tenant: TenantContext, body: unknown): Promise<ParsedFigures> {
  const locale = financeBootLocale();
  const copy = financeCopy(locale);
  const figures = (body as { figures?: unknown } | null)?.figures;
  if (typeof figures !== "string" || !figures.trim()) {
    throw new ApiError("invalid_request", copy.errors.parseRequired, 400);
  }
  const settings = requireLive(locale);
  const model = resolveModel(body, settings);
  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: financeParseSystemPrompt(locale),
    runPrefix: "finance-parse",
    agentId: "finance",
    versionId: "finance-parse",
    prompt: `Figures:\n${figures.trim().slice(0, FIGURES_TEXT_MAX)}`,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ApiError("invalid_finance", copy.errors.parseInvalidJson, 502);
  }
  const items = parseLineItems(parsed);
  if (items.length === 0) {
    throw new ApiError("invalid_finance", copy.errors.parseEmpty, 422);
  }
  return { items, needsConfirmation: true };
}

/** Confirmed items, or a dataset's rows mapped to items. Free text must go through parseFinanceFigures first. */
function resolveInputs(tenant: TenantContext, body: unknown, locale: AppLocale): FinanceInputs {
  const copy = financeCopy(locale);
  const direct = readFinanceInputs(body);
  if (direct) {
    return direct;
  }
  const datasetId = (body as { datasetId?: unknown }).datasetId;
  if (typeof datasetId === "string" && datasetId.trim()) {
    const items = lineItemsFromTable(requireDataset(tenant, datasetId.trim()).table);
    if (items.length === 0) {
      throw new ApiError("invalid_request", copy.errors.datasetNoAmounts, 400);
    }
    return { items, params: readFinanceInputs({ items, params: (body as { params?: unknown }).params })?.params ?? {} };
  }
  throw new ApiError("invalid_request", copy.errors.itemsRequired, 400);
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
    console.warn(`finance: could not save brief (${code})`);
    return null;
  }
}

export async function generateFinanceBrief(
  tenant: TenantContext,
  body: unknown,
  emit: JobEmitter = NO_EMIT,
  abortSignal?: AbortSignal,
): Promise<FinanceResult> {
  const locale = financeBootLocale();
  const copy = financeCopy(locale);
  const labels = financeMarkdownLabels(locale);
  const question = readPrompt(body, locale);
  const settings = loadSettings();
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  const extra = readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true });

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "computing", label: copy.pipeline.computing });
  const inputs = resolveInputs(tenant, body, locale);
  const computed = localizeComputedFinance(computeFinance(inputs.items, inputs.params), locale);
  emit({
    type: "job.step",
    phase: "computing",
    label: financeFill(copy.pipeline.computingStep, {
      metrics: computed.metrics.length,
      items: inputs.items.length,
    }),
  });

  if (mode === "stub") {
    throwIfJobAborted(abortSignal);
    emit({ type: "job.phase", phase: "drafting", label: copy.pipeline.drafting });
    emit({ type: "job.phase", phase: "verifying", label: copy.pipeline.verifying });
    const { brief, guard } = buildFinanceBrief(stubFinanceDraft(question, computed, locale), computed);
    emit({ type: "job.step", phase: "verifying", label: copy.pipeline.verifyingOk });
    emit({ type: "job.phase", phase: "saving", label: copy.pipeline.saving });
    const markdown = financeBriefToMarkdown(brief, labels);
    const artifactId = persistBrief(tenant, brief, markdown, {
      question,
      model: "stub",
      itemCount: inputs.items.length,
      flagged: guard.total,
    });
    if (artifactId) {
      await upsertWorkSource(
        tenant,
        artifactWorkCard({
          type: "Finance",
          artifactId,
          title: brief.title,
          prompt: question,
          markdown,
          model: "stub",
        }),
      );
    }
    return { brief, artifactId, markdown, guard, items: inputs.items };
  }

  const model = resolveModel(body, settings);
  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "drafting", label: copy.pipeline.drafting });
  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: financeBriefSystemPrompt(locale),
    runPrefix: "finance",
    agentId: "finance",
    versionId: "finance-brief",
    prompt: [
      financePromptBlock(inputs, computed, locale),
      extra ? `${copy.pipeline.extraContext}\n${extra}` : null,
      `${copy.pipeline.briefRequested}\n${question}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  if (!raw.trim()) {
    throw new ApiError("generation_failed", copy.errors.emptyBrief, 502);
  }

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "verifying", label: copy.pipeline.verifying });
  const { brief, guard } = buildFinanceBrief(parseBriefDraft(raw, locale), computed);
  emit({
    type: "job.step",
    phase: "verifying",
    label:
      guard.total === 0
        ? copy.pipeline.verifyingOk
        : financeFill(copy.pipeline.verifyingFlagged, { count: guard.total }),
  });

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "saving", label: copy.pipeline.saving });
  const markdown = financeBriefToMarkdown(brief, labels);
  const artifactId = persistBrief(tenant, brief, markdown, {
    question,
    model,
    itemCount: inputs.items.length,
    flagged: guard.total,
  });
  if (artifactId) {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({ type: "Finance", artifactId, title: brief.title, prompt: question, markdown, model }),
    );
  }
  return { brief, artifactId, markdown, guard, items: inputs.items };
}

function readSectionIndex(body: unknown, length: number, locale: AppLocale): number {
  const index = (body as { sectionIndex?: unknown }).sectionIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= length) {
    throw new ApiError("invalid_request", financeCopy(locale).errors.sectionIndex, 400);
  }
  return index;
}

/** Rewrite one section with the same inputs, metrics, and guard. */
export async function regenerateFinanceSection(tenant: TenantContext, body: unknown): Promise<FinanceResult> {
  const locale = financeBootLocale();
  const copy = financeCopy(locale);
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", copy.errors.bodyRequired, 400);
  }
  const parsedBrief = financeBriefSchema.safeParse((body as { brief?: unknown }).brief);
  if (!parsedBrief.success) {
    throw new ApiError("invalid_request", copy.errors.briefMalformed, 400);
  }
  const brief = parsedBrief.data;
  const index = readSectionIndex(body, brief.sections.length, locale);
  const current = brief.sections[index];
  if (!current) {
    throw new ApiError("invalid_request", copy.errors.sectionIndex, 400);
  }
  const settings = requireLive(locale);
  const model = resolveModel(body, settings);
  const inputs = resolveInputs(tenant, body, locale);
  const computed = localizeComputedFinance(computeFinance(inputs.items, inputs.params), locale);
  const topic =
    typeof (body as { prompt?: unknown }).prompt === "string" ? (body as { prompt: string }).prompt.trim() : "";
  const prompt = appendRegenInstruction(
    [
      financePromptBlock(inputs, computed, locale),
      topic ? `${copy.pipeline.originalRequest} ${topic}` : null,
      `${copy.pipeline.briefTitle} ${brief.title}`,
      `${copy.pipeline.otherSections}\n${brief.sections
        .map((section, at) => (at === index ? null : `- ${section.heading}`))
        .filter(Boolean)
        .join("\n")}`,
      `${copy.pipeline.rewriteSection}\n${copy.pipeline.heading} ${current.heading}\n${copy.pipeline.body}\n${current.body}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    readOptionalInstruction(body),
  );
  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: financeSectionSystemPrompt(locale),
    runPrefix: "finance-section",
    agentId: "finance",
    versionId: "finance-section",
    prompt,
  });
  const knownKeys = new Set(computed.metrics.map((entry) => entry.key));
  const rewritten = guardSection(parseBriefSection(raw, locale), computed, knownKeys);
  const next = financeBriefSchema.parse({
    ...brief,
    sections: brief.sections.map((section, at) => (at === index ? rewritten.section : section)),
    computed: { metrics: computed.metrics, tables: computed.tables },
  });
  const guard: GuardReport = {
    flagged: rewritten.flagged.map((text) => ({ section: index, text })),
    total: rewritten.flagged.length,
  };
  return {
    brief: next,
    artifactId: null,
    markdown: financeBriefToMarkdown(next, financeMarkdownLabels(locale)),
    guard,
    items: inputs.items,
  };
}

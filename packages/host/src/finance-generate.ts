import { ApiError, hasLiveProvider, resolveChatModel, resolveRuntimeMode, withOutputLanguage, type TenantContext } from "@agentforge/core";
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
  financePromptBlock,
  guardSection,
  parseBriefDraft,
  parseBriefSection,
  readFinanceInputs,
  type FinanceInputs,
  type GuardReport,
} from "./finance-brief-build";
import { appendRegenInstruction, collectJobAssistantText, readOptionalInstruction } from "./job-regen";
import { readSourceText } from "./job-source";
import { throwIfJobAborted } from "./job-stream";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";
import { localeForRun } from "./run-context";

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

export type FinanceResult = {
  brief: FinanceBrief;
  artifactId: string | null;
  markdown: string;
  guard: GuardReport;
  items: LineItem[];
};

export type ParsedFigures = { items: LineItem[]; needsConfirmation: true };

const NO_EMIT: JobEmitter = () => {};

function readPrompt(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const prompt = (body as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new ApiError("invalid_request", "prompt is required", 400);
  }
  return prompt.trim();
}

function readOptionalModel(body: unknown): string | undefined {
  const model = (body as { model?: unknown }).model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

function requireLive(): ReturnType<typeof loadSettings> {
  const settings = loadSettings();
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError(
      "runtime_stub",
      "Finance needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
      503,
    );
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
  const figures = (body as { figures?: unknown } | null)?.figures;
  if (typeof figures !== "string" || !figures.trim()) {
    throw new ApiError("invalid_request", "figures text is required", 400);
  }
  const settings = requireLive();
  const model = resolveModel(body, settings);
  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: PARSE_SYSTEM,
    runPrefix: "finance-parse",
    agentId: "finance",
    versionId: "finance-parse",
    prompt: `Figures:\n${figures.trim().slice(0, FIGURES_TEXT_MAX)}`,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ApiError("invalid_finance", "Model returned invalid JSON for the figures", 502);
  }
  const items = parseLineItems(parsed);
  if (items.length === 0) {
    throw new ApiError("invalid_finance", "No figures could be read from that text", 422);
  }
  return { items, needsConfirmation: true };
}

/** Confirmed items, or a dataset's rows mapped to items. Free text must go through parseFinanceFigures first. */
function resolveInputs(tenant: TenantContext, body: unknown): FinanceInputs {
  const direct = readFinanceInputs(body);
  if (direct) {
    return direct;
  }
  const datasetId = (body as { datasetId?: unknown }).datasetId;
  if (typeof datasetId === "string" && datasetId.trim()) {
    const items = lineItemsFromTable(requireDataset(tenant, datasetId.trim()).table);
    if (items.length === 0) {
      throw new ApiError("invalid_request", "That dataset has no numeric column to use as amounts", 400);
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
  const question = readPrompt(body);
  const settings = requireLive();
  const model = resolveModel(body, settings);
  const extra = readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true });

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "computing", label: "Computing metrics" });
  const inputs = resolveInputs(tenant, body);
  const computed = computeFinance(inputs.items, inputs.params);
  emit({
    type: "job.step",
    phase: "computing",
    label: `${computed.metrics.length} metrics from ${inputs.items.length} line items`,
  });

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "drafting", label: "Drafting the brief" });
  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: withOutputLanguage(BRIEF_SYSTEM, "finance", localeForRun()),
    runPrefix: "finance",
    agentId: "finance",
    versionId: "finance-brief",
    prompt: [
      financePromptBlock(inputs, computed),
      extra ? `Extra context:\n${extra}` : null,
      `Brief requested:\n${question}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned an empty finance brief", 502);
  }

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "verifying", label: "Checking every figure" });
  const { brief, guard } = buildFinanceBrief(parseBriefDraft(raw), computed);
  emit({
    type: "job.step",
    phase: "verifying",
    label: guard.total === 0 ? "All figures trace to inputs" : `${guard.total} unverified figure(s) removed`,
  });

  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "saving", label: "Saving brief" });
  const markdown = financeBriefToMarkdown(brief);
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
  const settings = requireLive();
  const model = resolveModel(body, settings);
  const inputs = resolveInputs(tenant, body);
  const computed = computeFinance(inputs.items, inputs.params);
  const topic =
    typeof (body as { prompt?: unknown }).prompt === "string" ? (body as { prompt: string }).prompt.trim() : "";
  const prompt = appendRegenInstruction(
    [
      financePromptBlock(inputs, computed),
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
  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: withOutputLanguage(SECTION_SYSTEM, "finance", localeForRun()),
    runPrefix: "finance-section",
    agentId: "finance",
    versionId: "finance-section",
    prompt,
  });
  const knownKeys = new Set(computed.metrics.map((entry) => entry.key));
  const rewritten = guardSection(parseBriefSection(raw), computed, knownKeys);
  const next = financeBriefSchema.parse({
    ...brief,
    sections: brief.sections.map((section, at) => (at === index ? rewritten.section : section)),
    computed: { metrics: computed.metrics, tables: computed.tables },
  });
  const guard: GuardReport = {
    flagged: rewritten.flagged.map((text) => ({ section: index, text })),
    total: rewritten.flagged.length,
  };
  return { brief: next, artifactId: null, markdown: financeBriefToMarkdown(next), guard, items: inputs.items };
}

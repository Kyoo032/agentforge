import {
  ApiError,
  gatewayRequiredMessage,
  hasLiveProvider,
  modeMessage,
  resolveChatModel,
  resolveRuntimeMode,
  withOutputLanguage,
  type AppLocale,
  type TenantContext,
} from "@agentforge/core";
import { loadSettings } from "./settings-store";
import { modeCatalogPayload, listSelectableModels } from "./selectable-models";
import {
  mergeDocumentSection,
  parseDocumentDraft,
  parseDocumentDraftBody,
  parseDocumentSection,
  type DocumentDraft,
} from "./document-outline";
import {
  appendRegenInstruction,
  collectJobAssistantText,
  readJobRegenAttachments,
  readOptionalInstruction,
} from "./job-regen";
import { readSourceText, withSourceMaterial, withSourceRule } from "./job-source";
import { localeForRun } from "./run-context";
import { artifactStore } from "./artifacts";
import { upsertWorkSource } from "./knowledge-ingest";
import { artifactWorkCard, documentDraftMarkdown } from "./work-cards";

const FINANCE_SYSTEM = `You draft finished finance documents for DPSBuddy — not skeletons.
Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "title": string,
  "sections": [
    { "heading": string, "body": string }
  ]
}
Rules:
- Use only figures the user pasted. Never invent numbers, rates, or balances.
- If a figure is missing, say it is missing. Do not fill it in.
- Each section is finished writing: 2–4 short paragraphs. Use \\n\\n between paragraphs.
- Headings are claims or jobs, not labels.
- No campus / student / course nouns unless the topic itself requires them.`;

const DOCUMENT_SYSTEM = `You draft finished professional documents for DPSBuddy — not skeletons.
Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "title": string,
  "sections": [
    { "heading": string, "body": string }
  ]
}
Rules:
- Honor the user's requested section list and length. Default 5–8 sections (max 12).
- Each section is finished writing: 2–4 short paragraphs, or a tight list. Use \\n\\n between paragraphs. No markdown headings.
- Headings are claims or jobs ("What I need from you"), not labels ("Introduction").
- Use the sample scenario in the prompt. Keep bracketed fields if the user left them. Tag invented figures [sample].
- No TBD, "lorem", "replace this paragraph", "we should consider exploring", or "in today's landscape".
- Do not invent citations, customers, statutes, or quotes.
- No campus / student / course nouns unless the topic itself requires them.`;

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
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const model = (body as { model?: unknown }).model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

export function isFinanceJob(body: unknown): boolean {
  return Boolean(body && typeof body === "object" && (body as { job?: unknown }).job === "finance");
}

export function documentJobSystemPrompt(finance: boolean, locale: AppLocale = localeForRun()): string {
  const base = finance ? FINANCE_SYSTEM : DOCUMENT_SYSTEM;
  return withOutputLanguage(base, finance ? "finance" : "documents", locale);
}

async function collectAssistantText(
  tenant: TenantContext,
  model: string,
  prompt: string,
  finance: boolean,
  sourceText: string,
): Promise<string> {
  return collectJobAssistantText({
    tenant,
    model,
    systemPrompt: withSourceRule(documentJobSystemPrompt(finance), sourceText),
    runPrefix: finance ? "finance" : "document",
    agentId: finance ? "finance" : "document",
    jobMode: finance ? "finance" : "documents",
    versionId: finance ? "finance-draft" : "document-draft",
    prompt: withSourceMaterial(prompt, sourceText),
  });
}

function requireLiveDocumentRuntime(workspaceId: string): ReturnType<typeof loadSettings> {
  const settings = loadSettings(workspaceId);
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", gatewayRequiredMessage("documents", localeForRun()), 503);
  }
  return settings;
}

function resolveDocumentModel(body: unknown, settings: ReturnType<typeof loadSettings>): string {
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(
    readOptionalModel(body),
    settings.documentGenModel || (isFinanceJob(body) ? defaults.finance : defaults.documents),
    catalog,
  );
}

/** Save the draft as a `documents / draft` artifact. Never fails the job; returns null when it cannot save. */
function persistDraft(tenant: TenantContext, draft: DocumentDraft, markdown: string, meta: Record<string, unknown>): string | null {
  try {
    return artifactStore().create(tenant, {
      mode: "documents",
      kind: "draft",
      title: draft.title,
      mime: "text/markdown",
      body: markdown,
      meta,
    }).id;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    console.warn(`documents: could not save draft (${code})`);
    return null;
  }
}

export async function generateDocumentDraft(tenant: TenantContext, body: unknown): Promise<DocumentDraft> {
  const prompt = readPrompt(body);
  const settings = requireLiveDocumentRuntime(tenant.workspaceId);
  const sourceText = readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true });
  const model = resolveDocumentModel(body, settings);
  const raw = await collectAssistantText(tenant, model, prompt, isFinanceJob(body), sourceText);
  if (!raw.trim()) {
    throw new ApiError("generation_failed", modeMessage("emptyDocumentDraft", localeForRun()), 502);
  }
  const draft = parseDocumentDraft(raw);
  const markdown = documentDraftMarkdown(draft);
  const artifactId = persistDraft(tenant, draft, markdown, { question: prompt, model, finance: isFinanceJob(body) });
  if (artifactId) {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({ type: "Documents", artifactId, title: draft.title, prompt, markdown, model }),
    );
  }
  return draft;
}

const SECTION_SYSTEM = `You rewrite one section of an DPSBuddy document.
Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{ "heading": string, "body": string }
Rules:
- body is plain paragraphs. Use \\n\\n between paragraphs. No markdown headings.
- Stay on the same topic as the rest of the document.
- No campus / student / course nouns unless the topic itself requires them.`;

function readSectionIndex(body: unknown, length: number): number {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const index = (body as { sectionIndex?: unknown }).sectionIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= length) {
    throw new ApiError("invalid_request", "sectionIndex is out of range", 400);
  }
  return index;
}

export async function regenerateDocumentSection(tenant: TenantContext, body: unknown): Promise<DocumentDraft> {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const draft = parseDocumentDraftBody((body as { draft?: unknown }).draft);
  const index = readSectionIndex(body, draft.sections.length);
  const topic =
    typeof (body as { prompt?: unknown }).prompt === "string" ? (body as { prompt: string }).prompt.trim() : "";
  const current = draft.sections[index];
  if (!current) {
    throw new ApiError("invalid_request", "sectionIndex is out of range", 400);
  }
  const settings = requireLiveDocumentRuntime(tenant.workspaceId);
  const model = resolveDocumentModel(body, settings);
  const attachments = readJobRegenAttachments(body);
  const sourceText = readSourceText(body, { injectionGuardBypass: settings.injectionGuardBypass === true });
  const others = draft.sections
    .map((section, itemIndex) => (itemIndex === index ? null : `- ${section.heading}`))
    .filter(Boolean)
    .join("\n");
  const prompt = appendRegenInstruction(
    [
      topic ? `Original topic: ${topic}` : null,
      `Document title: ${draft.title}`,
      others ? `Other sections:\n${others}` : null,
      `Rewrite this section only.\nHeading: ${current.heading}\nBody:\n${current.body}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    readOptionalInstruction(body),
  );

  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: withSourceRule(withOutputLanguage(SECTION_SYSTEM, "documents", localeForRun()), sourceText),
    runPrefix: "document-section",
    agentId: "document",
    jobMode: "documents",
    versionId: "document-section",
    prompt: withSourceMaterial(prompt, sourceText),
    attachments,
  });
  if (!raw.trim()) {
    throw new ApiError("generation_failed", modeMessage("emptyDocumentSection", localeForRun()), 502);
  }
  return mergeDocumentSection(draft, index, parseDocumentSection(raw));
}

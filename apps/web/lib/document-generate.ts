import {
  ApiError,
  hasLiveProvider,
  resolveChatModel,
  resolveRuntimeMode,
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

const DOCUMENT_SYSTEM = `You draft finished professional documents for Agentforge — not skeletons.
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

async function collectAssistantText(tenant: TenantContext, model: string, prompt: string): Promise<string> {
  return collectJobAssistantText({
    tenant,
    model,
    systemPrompt: DOCUMENT_SYSTEM,
    runPrefix: "document",
    agentId: "document",
    versionId: "document-draft",
    prompt,
  });
}

function requireLiveDocumentRuntime(): ReturnType<typeof loadSettings> {
  const settings = loadSettings();
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError(
      "runtime_stub",
      "Document generation needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
      503,
    );
  }
  return settings;
}

function resolveDocumentModel(body: unknown, settings: ReturnType<typeof loadSettings>): string {
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(
    readOptionalModel(body),
    settings.documentGenModel || defaults.documents,
    catalog,
  );
}

export async function generateDocumentDraft(tenant: TenantContext, body: unknown): Promise<DocumentDraft> {
  const prompt = readPrompt(body);
  const settings = requireLiveDocumentRuntime();
  const model = resolveDocumentModel(body, settings);
  const raw = await collectAssistantText(tenant, model, prompt);
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned an empty document draft", 502);
  }
  return parseDocumentDraft(raw);
}

const SECTION_SYSTEM = `You rewrite one section of an Agentforge document.
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
  const topic = typeof (body as { prompt?: unknown }).prompt === "string" ? (body as { prompt: string }).prompt.trim() : "";
  const current = draft.sections[index];
  if (!current) {
    throw new ApiError("invalid_request", "sectionIndex is out of range", 400);
  }
  const settings = requireLiveDocumentRuntime();
  const model = resolveDocumentModel(body, settings);
  const attachments = readJobRegenAttachments(body);
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
    systemPrompt: SECTION_SYSTEM,
    runPrefix: "document-section",
    agentId: "document",
    versionId: "document-section",
    prompt,
    attachments,
  });
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned an empty document section", 502);
  }
  return mergeDocumentSection(draft, index, parseDocumentSection(raw));
}

import {
  ApiError,
  createRuntime,
  hasLiveProvider,
  resolveChatModel,
  resolveRuntimeMode,
  type AgentVersionRecord,
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
import { rememberJobUsage } from "./job-usage";

const DOCUMENT_SYSTEM = `You draft professional documents for Agentforge.
Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "title": string,
  "sections": [
    { "heading": string, "body": string }
  ]
}
Rules:
- 3 to 8 sections unless the topic clearly needs fewer or more (max 12).
- body is plain paragraphs. Use \\n\\n between paragraphs. No markdown headings.
- Keep the writing specific to the prompt. Do not invent citations.
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

async function collectAssistantTextWithSystem(
  tenant: TenantContext,
  model: string,
  systemPrompt: string,
  prompt: string,
): Promise<string> {
  const settings = loadSettings();
  const runtime = createRuntime(settings);
  const version: AgentVersionRecord = {
    id: "document-draft",
    agentId: "document",
    organizationId: tenant.organizationId,
    version: 1,
    systemPrompt,
    model,
    inputModalities: ["text"],
    config: {},
    createdAt: new Date(),
  };

  let assistantText = "";
  let failedMessage = "";

  await runtime.execute({
    tenant,
    runId: `document-${Date.now()}`,
    modality: "text",
    version,
    bindings: [],
    history: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    onEvent: (event) => {
      if (event.type === "assistant.delta") {
        assistantText += event.text;
      }
      if (event.type === "run.failed") {
        failedMessage = event.message;
      }
      rememberJobUsage(event);
    },
  });

  if (failedMessage) {
    throw new ApiError("generation_failed", failedMessage, 502);
  }
  return assistantText;
}

async function collectAssistantText(tenant: TenantContext, model: string, prompt: string): Promise<string> {
  return collectAssistantTextWithSystem(tenant, model, DOCUMENT_SYSTEM, prompt);
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
  const others = draft.sections
    .map((section, itemIndex) => (itemIndex === index ? null : `- ${section.heading}`))
    .filter(Boolean)
    .join("\n");
  const prompt = [
    topic ? `Original topic: ${topic}` : null,
    `Document title: ${draft.title}`,
    others ? `Other sections:\n${others}` : null,
    `Rewrite this section only.\nHeading: ${current.heading}\nBody:\n${current.body}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await collectAssistantTextWithSystem(tenant, model, SECTION_SYSTEM, prompt);
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned an empty document section", 502);
  }
  return mergeDocumentSection(draft, index, parseDocumentSection(raw));
}

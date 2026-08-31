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
import { parseDocumentDraft, type DocumentDraft } from "./document-outline";

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

async function collectAssistantText(tenant: TenantContext, model: string, prompt: string): Promise<string> {
  const settings = loadSettings();
  const runtime = createRuntime(settings);
  const version: AgentVersionRecord = {
    id: "document-draft",
    agentId: "document",
    organizationId: tenant.organizationId,
    version: 1,
    systemPrompt: DOCUMENT_SYSTEM,
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
    },
  });

  if (failedMessage) {
    throw new ApiError("generation_failed", failedMessage, 502);
  }
  return assistantText;
}

export async function generateDocumentDraft(tenant: TenantContext, body: unknown): Promise<DocumentDraft> {
  const prompt = readPrompt(body);
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

  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  const model = resolveChatModel(
    readOptionalModel(body),
    settings.documentGenModel || defaults.documents,
    catalog,
  );
  const raw = await collectAssistantText(tenant, model, prompt);
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned an empty document draft", 502);
  }
  return parseDocumentDraft(raw);
}

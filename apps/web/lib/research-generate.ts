import {
  ApiError,
  buildToolSecretScope,
  createRuntime,
  hasLiveProvider,
  listToolRoutes,
  resolveChatModel,
  resolveRuntimeMode,
  runWithToolSecrets,
  webSearchTool,
  type AgentVersionRecord,
  type TenantContext,
} from "@agentforge/core";
import { loadSettings } from "./settings-store";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { ensureToolsRegistered } from "./register-tools";
import { parseResearchNotes, type ResearchNotes } from "./research-parse";

const RESEARCH_SYSTEM = `You write sourced research notes for Agentforge.
You are given a question and web search hits. Return ONLY valid JSON (no markdown fences) with this shape:
{
  "title": string,
  "summary": string,
  "notes": [
    { "heading": string, "body": string, "sources": [{ "title": string, "url": string }] }
  ]
}
Rules:
- 3 to 8 notes.
- Only cite URLs that appear in the search hits. If hits are thin, say so in the summary.
- Do not invent cases, statutes, or quotations.
- No campus / student / course nouns unless the question itself requires them.`;

type SearchHit = { title?: string; url?: string; description?: string; position?: number };

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

function hitsFromSearch(output: unknown): SearchHit[] {
  if (!output || typeof output !== "object") {
    return [];
  }
  const record = output as { success?: unknown; error?: unknown; data?: { web?: SearchHit[] } };
  if (record.success !== true) {
    const error = typeof record.error === "string" && record.error.trim() ? record.error.trim() : "Web search failed";
    throw new ApiError("tool_failed", error, 503);
  }
  return Array.isArray(record.data?.web) ? record.data.web : [];
}

async function collectAssistantText(
  tenant: TenantContext,
  model: string,
  prompt: string,
): Promise<string> {
  const settings = loadSettings();
  const runtime = createRuntime(settings);
  const version: AgentVersionRecord = {
    id: "research-notes",
    agentId: "research",
    organizationId: tenant.organizationId,
    version: 1,
    systemPrompt: RESEARCH_SYSTEM,
    model,
    inputModalities: ["text"],
    config: {},
    createdAt: new Date(),
  };

  let assistantText = "";
  let failedMessage = "";

  await runtime.execute({
    tenant,
    runId: `research-${Date.now()}`,
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

export async function generateResearchNotes(tenant: TenantContext, body: unknown): Promise<ResearchNotes> {
  ensureToolsRegistered();
  const prompt = readPrompt(body);
  const settings = loadSettings();
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });

  if (mode === "stub") {
    throw new ApiError(
      "runtime_stub",
      "Research needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
      503,
    );
  }

  const routes = listToolRoutes(settings);
  if (!routes.web?.ready) {
    throw new ApiError(
      "tool_failed",
      "Research needs a Tavily or Brave Search API key. Add it in Settings, then try again.",
      503,
    );
  }

  const scope = buildToolSecretScope(settings);
  const searchOutput = await runWithToolSecrets(scope, () => webSearchTool.execute({ query: prompt }, tenant));
  const hits = hitsFromSearch(searchOutput);
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  const model = resolveChatModel(
    readOptionalModel(body),
    settings.researchGenModel || defaults.research,
    catalog,
  );
  const userPrompt = `Question:\n${prompt}\n\nSearch hits:\n${JSON.stringify(hits, null, 2)}`;
  const raw = await collectAssistantText(tenant, model, userPrompt);
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned empty research notes", 502);
  }
  return parseResearchNotes(raw);
}

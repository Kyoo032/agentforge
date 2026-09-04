import {
  ApiError,
  hasLiveProvider,
  resolveChatModel,
  resolveRuntimeMode,
  type TenantContext,
} from "@agentforge/core";
import { loadSettings } from "./settings-store";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { collectJobAssistantText } from "./job-regen";
import { parseResearchNotes, type ResearchNotes } from "./research-parse";

const DATA_SYSTEM = `You analyze a table the user attached. Do not search the web. Do not invent rows.
Return ONLY valid JSON (no markdown fences) with this shape:
{
  "title": string,
  "summary": string,
  "notes": [
    { "heading": string, "body": string, "sources": [{ "title": string, "url": string }] }
  ]
}
Rules:
- Use only numbers and labels present in the attached CSV sample.
- If a column is inferred, say so.
- sources may cite "attached table" with url "".
- No campus / student / course nouns unless the table itself requires them.`;

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

function readCsv(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "csv is required", 400);
  }
  const csv = (body as { csv?: unknown }).csv;
  if (typeof csv !== "string" || !csv.trim()) {
    throw new ApiError("invalid_request", "A parseable CSV table is required", 400);
  }
  return csv.trim();
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
      "Data analysis needs a live gateway. Paste a Toko Token API key in Settings, then try again.",
      503,
    );
  }
  return settings;
}

export async function generateDataNotes(tenant: TenantContext, body: unknown): Promise<ResearchNotes> {
  const prompt = readPrompt(body);
  const csv = readCsv(body);
  const settings = requireLive();
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  const requested =
    body && typeof body === "object" && typeof (body as { model?: unknown }).model === "string"
      ? (body as { model: string }).model
      : undefined;
  const model = resolveChatModel(requested, settings.researchGenModel || defaults.data, catalog);
  const raw = await collectJobAssistantText({
    tenant,
    model,
    systemPrompt: DATA_SYSTEM,
    runPrefix: "data",
    agentId: "data",
    versionId: "data-notes",
    prompt: `${prompt}\n\nAttached dataset (CSV):\n${csv.slice(0, 4000)}`,
  });
  if (!raw.trim()) {
    throw new ApiError("generation_failed", "Model returned empty analysis notes", 502);
  }
  return parseResearchNotes(raw);
}

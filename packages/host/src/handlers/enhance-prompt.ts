import {
  ApiError,
  enhanceSystemPrompt,
  enhanceUserPrompt,
  hasLiveProvider,
  isEnhanceSurface,
  resolveChatModel,
  resolveRuntimeMode,
  stubEnhancePrompt,
  stripWrappingQuotes,
} from "@agentforge/core";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { loadSettings } from "../settings-store";
import { collectJobAssistantText } from "../job-regen";
import { listSelectableModels, modeCatalogPayload } from "../selectable-models";

function readText(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new ApiError("empty_input", "text is required", 400);
  }
  const text = (body as { text?: unknown }).text;
  if (typeof text !== "string" || !text.trim()) {
    throw new ApiError("empty_input", "text is required", 400);
  }
  return text.trim();
}

export async function handlePostEnhancePrompt(request: HostRequest): Promise<HostResult> {
  try {
    const text = readText(request.body ?? null);
    const rawSurface = request.body && typeof request.body === "object" ? (request.body as { surface?: unknown }).surface : "chat";
    const surface = isEnhanceSurface(rawSurface) ? rawSurface : "chat";
    const settings = loadSettings();
    const mode = resolveRuntimeMode({
      settingsHasKey: hasLiveProvider(settings),
      envRuntime: process.env.AGENTFORGE_RUNTIME,
    });
    if (mode === "stub") {
      return jsonOk({ text: stubEnhancePrompt(text, surface), source: "stub" });
    }
    const tenant = await getTenant(request.workspaceId);
    const catalog = listSelectableModels();
    const { defaults } = modeCatalogPayload();
    const requested =
      request.body && typeof request.body === "object" && typeof (request.body as { model?: unknown }).model === "string"
        ? (request.body as { model: string }).model
        : undefined;
    const model = resolveChatModel(requested, defaults.chat, catalog);
    const raw = await collectJobAssistantText({
      tenant,
      model,
      systemPrompt: enhanceSystemPrompt(surface),
      runPrefix: "enhance",
      agentId: "enhance-prompt",
      versionId: "enhance-prompt",
      prompt: enhanceUserPrompt(text),
    });
    const next = stripWrappingQuotes(raw);
    if (!next) {
      throw new ApiError("llm_error", "Enhance returned an empty prompt", 502);
    }
    return jsonOk({ text: next.length > 800 ? `${next.slice(0, 797)}…` : next, source: "live" });
  } catch (error) {
    return jsonError(error);
  }
}

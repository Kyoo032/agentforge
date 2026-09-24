/**
 * The four boundary reads every Finance route makes before it reaches the gateway: the question, the
 * model, and the gate. They lived inside `finance-generate.ts` while Finance was one task; the task
 * runner needs exactly the same answers, and a second copy of a gateway check is how two paths end
 * up disagreeing about whether a workspace is live.
 *
 * Nothing here is new behaviour — the brief calls the same functions it always did, from here.
 */
import {
  ApiError,
  gatewayRequiredMessage,
  hasLiveProvider,
  resolveChatModel,
  resolveRuntimeMode,
  type TenantContext,
} from "@agentforge/core";
import { localeForRun } from "../run-context";
import { listSelectableModels, modeCatalogPayload } from "../selectable-models";
import { loadSettings } from "../settings-store";

export type FinanceSettings = ReturnType<typeof loadSettings>;

export function readPrompt(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new ApiError("invalid_request", "Request body must be a JSON object", 400);
  }
  const prompt = (body as { prompt?: unknown }).prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new ApiError("invalid_request", "prompt is required", 400);
  }
  return prompt.trim();
}

export function readOptionalModel(body: unknown): string | undefined {
  const model = (body as { model?: unknown }).model;
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

/**
 * Did the person pick this model, or is it the seeded default the studio always sends? Every job
 * reads the pin the same way, so Finance takes the one reader rather than keeping a copy of its own:
 * a Finance copy is how a pin that names no model came to hold a job to the host default. It maps
 * straight onto `modelExplicit` in the job fallback options.
 */
export { readModelPinned } from "../job-regen";

export function requireLive(tenant: TenantContext): FinanceSettings {
  const settings = loadSettings(tenant);
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", gatewayRequiredMessage("finance", localeForRun()), 503);
  }
  return settings;
}

export function resolveModel(body: unknown, settings: FinanceSettings): string {
  const { defaults } = modeCatalogPayload();
  return resolveChatModel(
    readOptionalModel(body),
    settings.documentGenModel || defaults.finance,
    listSelectableModels(),
  );
}

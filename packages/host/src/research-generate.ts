import {
  ApiError,
  buildToolSecretScope,
  fetchPageText,
  gatewayRequiredMessage,
  hasLiveProvider,
  maskPii,
  modeMessage,
  resolveChatModel,
  resolveRuntimeMode,
  runWithToolSecrets,
  scanInjection,
  webSearchTool,
  withOutputLanguage,
  type TenantContext,
} from "@agentforge/core";
import { dossierToMarkdown, type Dossier, type ResearchNotes } from "@agentforge/core/artifacts";
import type { JobEmitter } from "@agentforge/core/jobs";
import { loadSettings } from "./settings-store";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { ensureToolsRegistered } from "./register-tools";
import { artifactStore } from "./artifacts";
import { upsertWorkSource } from "./knowledge-ingest";
import { artifactWorkCard } from "./work-cards";
import { collectJobAssistantRun, readModelPinned } from "./job-regen";
import { throwIfJobAborted } from "./job-stream";
import { RESEARCH_CAPS, runResearchDossier, type SearchHit } from "./research-dossier";
import { localeForRun } from "./run-context";
import { log } from "./log";

/** Notes (existing preview shape) plus the saved dossier. `artifactId` mirrors `dossierId` for older callers. */
export type ResearchResult = ResearchNotes & {
  artifactId: string | null;
  dossierId: string | null;
  dossier: { title: string; markdown: string };
};

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
    const error =
      typeof record.error === "string" && record.error.trim()
        ? record.error.trim()
        : modeMessage("webSearchFailed", localeForRun());
    throw new ApiError("tool_failed", error, 503);
  }
  return Array.isArray(record.data?.web) ? record.data.web : [];
}

function requireLiveResearch(settings: ReturnType<typeof loadSettings>): void {
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", gatewayRequiredMessage("research", localeForRun()), 503);
  }
}

function persistDossier(tenant: TenantContext, dossier: Dossier, markdown: string, model: string): string | null {
  try {
    return artifactStore().create(tenant, {
      mode: "research",
      kind: "dossier",
      title: dossier.title,
      mime: "text/markdown",
      body: markdown,
      meta: {
        question: dossier.question,
        queries: dossier.queries,
        sourceCount: dossier.sources.length,
        model,
        models: dossier.models,
      },
    }).id;
  } catch (error) {
    // Persistence must never fail the job; the notes are still returned. Log the code only, never the body.
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("research_dossier_not_saved", { code });
    return null;
  }
}

export async function generateResearchNotes(
  tenant: TenantContext,
  body: unknown,
  emit: JobEmitter = NO_EMIT,
  abortSignal?: AbortSignal,
): Promise<ResearchResult> {
  ensureToolsRegistered();
  const question = readPrompt(body);
  const settings = loadSettings(tenant);
  requireLiveResearch(settings);
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  const model = resolveChatModel(readOptionalModel(body), settings.researchGenModel || defaults.research, catalog);
  // A model the person picked is never swapped by the fallback; a seeded default can be.
  const modelExplicit = readModelPinned(body);
  const scope = buildToolSecretScope(settings);
  const guardBypass = settings.injectionGuardBypass === true;
  // Every model that answered one of this run's calls, in the order it first did, and the last one
  // to answer (the one that wrote the dossier). After a fallback neither is the requested id alone.
  let answered: string[] = [];
  let writtenBy = model;

  const { dossier: planned, notes } = await runResearchDossier(
    { question, models: [model] },
    {
      emit,
      abortSignal,
      caps: RESEARCH_CAPS,
      ask: async (system, prompt) => {
        const run = await collectJobAssistantRun({
          tenant,
          model,
          modelExplicit,
          systemPrompt: withOutputLanguage(system, "research", localeForRun()),
          runPrefix: "research",
          agentId: "research",
          jobMode: "research",
          versionId: "research-dossier",
          prompt,
        });
        answered = answered.includes(run.model) ? answered : [...answered, run.model];
        writtenBy = run.model;
        return run.text;
      },
      search: async (query) =>
        hitsFromSearch(await runWithToolSecrets(scope, () => webSearchTool.execute({ query: maskPii(query) }, tenant))),
      readPage: async (url) => {
        const page = await fetchPageText(url, { maxChars: RESEARCH_CAPS.pageChars, signal: abortSignal });
        const hit = guardBypass ? null : scanInjection(page.text);
        if (hit) {
          throw new ApiError("injection_blocked", `blocked by injection guard (rule: ${hit.rule})`, 400);
        }
        return page;
      },
    },
  );

  // A cancelled run is not saved: the user asked for it to stop.
  throwIfJobAborted(abortSignal);
  emit({ type: "job.phase", phase: "saving", label: "Saving dossier" });
  const dossier: Dossier = answered.length > 0 ? { ...planned, models: answered } : planned;
  const markdown = dossierToMarkdown(dossier);
  const dossierId = persistDossier(tenant, dossier, markdown, writtenBy);
  if (dossierId) {
    await upsertWorkSource(
      tenant,
      artifactWorkCard({
        type: "Research",
        artifactId: dossierId,
        title: dossier.title,
        prompt: question,
        markdown,
        model: writtenBy,
      }),
    );
  }
  return { ...notes, artifactId: dossierId, dossierId, dossier: { title: dossier.title, markdown } };
}

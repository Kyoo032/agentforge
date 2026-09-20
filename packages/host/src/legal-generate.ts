import { ApiError, hasLiveProvider, resolveChatModel, resolveRuntimeMode, type TenantContext } from "@agentforge/core";
import {
  DOCX_MIME,
  XLSX_MIME,
  isArtifactMime,
  isBinaryArtifactMime,
  type ArtifactKind,
  type ArtifactMime,
} from "@agentforge/core/artifacts";
import type { DocxDocument } from "@agentforge/core/docx";
import type { JobEmitter } from "@agentforge/core/jobs";
import {
  findPlaybook,
  LEGAL_CAPS,
  legalOutputCopy,
  type DeliverableKind,
  type Finding,
  type LegalManifest,
  type VerifyReport,
} from "@agentforge/core/legal";
import { artifactStore } from "./artifacts";
import { collectJobAssistantText } from "./job-regen";
import { throwIfJobAborted } from "./job-stream";
import { upsertWorkSource } from "./knowledge-ingest";
import type { LegalRunBody } from "./legal/input";
import type { LegalMatterRecord, LegalRunArtifact, LegalRunRecord } from "./legal/records";
import { runLegalMatter } from "./legal/run";
import { legalStore, requireLegalMatter } from "./legal/store";
import { listSelectableModels, modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";
import { localeForRun } from "./run-context";
import { artifactWorkCard } from "./work-cards";
import { log } from "./log";

export type LegalRunSummary = {
  runId: string;
  manifest: LegalManifest;
  findings: Finding[];
  verify: VerifyReport | null;
  artifacts: LegalRunArtifact[];
};

const ARTIFACT_KIND: Record<DeliverableKind, ArtifactKind> = {
  "issues-memo": "memo",
  redline: "redline",
  "deviation-report": "report",
  "executive-summary": "summary",
  "red-flags": "red-flags",
};

export function artifactKindForDeliverable(kind: DeliverableKind): ArtifactKind {
  return ARTIFACT_KIND[kind];
}

export function encodeArtifactBody(mime: ArtifactMime, bytes: Uint8Array, text: string): string {
  if (isBinaryArtifactMime(mime)) {
    return Buffer.from(bytes).toString("base64");
  }
  return text.trim() || new TextDecoder().decode(bytes);
}

function requireLive(tenant: TenantContext): ReturnType<typeof loadSettings> {
  const settings = loadSettings(tenant);
  const mode = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  });
  if (mode === "stub") {
    throw new ApiError("runtime_stub", legalOutputCopy(localeForRun()).stubError, 503);
  }
  return settings;
}

function readRunBody(body: unknown): LegalRunBody {
  if (!body || typeof body !== "object") {
    return {};
  }
  const record = body as { model?: unknown; verifierModel?: unknown };
  const model = typeof record.model === "string" ? record.model.trim() : "";
  const verifierModel = typeof record.verifierModel === "string" ? record.verifierModel.trim() : "";
  return {
    ...(model ? { model } : {}),
    ...(verifierModel ? { verifierModel } : {}),
  };
}

function resolveModels(body: LegalRunBody): { drafting: string; verifier: string } {
  const catalog = listSelectableModels();
  const { defaults } = modeCatalogPayload();
  return {
    drafting: resolveChatModel(body.model, defaults.legal, catalog),
    verifier: resolveChatModel(body.verifierModel, defaults.legalVerifier, catalog),
  };
}

function coerceMime(mime: string): ArtifactMime {
  if (isArtifactMime(mime)) {
    return mime;
  }
  if (mime.includes("spreadsheetml")) {
    return XLSX_MIME;
  }
  if (mime.includes("wordprocessingml")) {
    return DOCX_MIME;
  }
  return "text/markdown";
}

async function loadDocMaps(
  tenant: TenantContext,
  matter: LegalMatterRecord,
): Promise<{ docs: Map<string, DocxDocument>; bytes: Map<string, Uint8Array> }> {
  const store = legalStore();
  const docs = new Map<string, DocxDocument>();
  const bytes = new Map<string, Uint8Array>();
  for (const card of matter.docs) {
    const parsed = await store.readDoc(tenant, matter.id, card.id);
    const raw = store.readBytes(tenant, matter.id, card.id);
    if (!parsed || !raw) {
      throw new ApiError("internal_error", `Document ${card.id} could not be loaded`, 500);
    }
    docs.set(card.id, parsed);
    bytes.set(card.id, raw);
  }
  if (docs.size === 0) {
    throw new ApiError("invalid_request", "Upload at least one .docx before running", 400);
  }
  return { docs, bytes };
}

function persistDeliverable(
  tenant: TenantContext,
  matter: LegalMatterRecord,
  item: { kind: DeliverableKind; filename: string; mime: string; bytes: Uint8Array; text: string },
  meta: Record<string, unknown>,
): LegalRunArtifact | null {
  const mime = coerceMime(item.mime);
  const body = encodeArtifactBody(mime, item.bytes, item.text);
  if (!body.trim()) {
    return null;
  }
  try {
    const record = artifactStore().create(tenant, {
      mode: "legal",
      kind: artifactKindForDeliverable(item.kind),
      title: `${matter.title} ${item.filename}`.trim(),
      mime,
      body,
      meta: { ...meta, deliverable: item.kind, filename: item.filename },
    });
    return { kind: item.kind, artifactId: record.id, filename: item.filename };
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("legal_deliverable_not_saved", { kind: item.kind, code });
    return null;
  }
}

function persistManifest(
  tenant: TenantContext,
  matter: LegalMatterRecord,
  manifest: LegalManifest,
  meta: Record<string, unknown>,
): void {
  try {
    artifactStore().create(tenant, {
      mode: "legal",
      kind: "matter",
      title: `${matter.title} manifest`,
      mime: "application/json",
      body: JSON.stringify(manifest),
      meta,
    });
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    log.warn("legal_manifest_not_saved", { code });
  }
}

function knowledgeCard(
  matter: LegalMatterRecord,
  artifacts: LegalRunArtifact[],
  deliverables: { kind: DeliverableKind; text: string }[],
  model: string,
): Parameters<typeof artifactWorkCard>[0] | null {
  const redFlags = deliverables.find((item) => item.kind === "red-flags" && item.text.trim());
  const memo = deliverables.find((item) => item.kind === "issues-memo" && item.text.trim());
  const markdown = (redFlags?.text ?? memo?.text ?? "").trim();
  const pointerKind: DeliverableKind | null = redFlags ? "red-flags" : memo ? "issues-memo" : null;
  const artifactId = artifacts.find((item) => item.kind === pointerKind)?.artifactId;
  if (!markdown || !artifactId) {
    return null;
  }
  return {
    type: "Legal",
    artifactId,
    title: matter.title,
    prompt: matter.instructions || matter.title,
    markdown,
    model,
  };
}

export async function generateLegalRun(
  tenant: TenantContext,
  matterId: string,
  body: unknown,
  emit: JobEmitter,
  abortSignal?: AbortSignal,
): Promise<LegalRunSummary> {
  requireLive(tenant);
  const matter = requireLegalMatter(tenant, matterId);
  const runBody = readRunBody(body);
  const models = resolveModels(runBody);
  const { docs, bytes } = await loadDocMaps(tenant, matter);
  const runId = crypto.randomUUID();
  const startedAt = Date.now();

  throwIfJobAborted(abortSignal);
  const result = await runLegalMatter(
    {
      matter,
      docs,
      bytes,
      playbook: matter.playbookId ? findPlaybook(matter.playbookId) : null,
      models,
      maxRounds: LEGAL_CAPS.maxRounds,
      runId,
      now: () => new Date(),
      locale: localeForRun(),
    },
    {
      ask: ({ model, system, prompt }) =>
        collectJobAssistantText({
          tenant,
          model,
          systemPrompt: system,
          runPrefix: "legal",
          agentId: "legal",
          jobMode: "legal",
          versionId: runId,
          prompt,
        }),
      emit,
      abortSignal,
    },
  );

  throwIfJobAborted(abortSignal);
  const meta = { model: models.drafting, models: [models.drafting, models.verifier], matterId: matter.id, runId };
  const artifacts = result.deliverables
    .map((item) => persistDeliverable(tenant, matter, item, meta))
    .filter((item): item is LegalRunArtifact => item !== null);
  persistManifest(tenant, matter, result.manifest, meta);

  const record: LegalRunRecord = {
    id: runId,
    matterId: matter.id,
    startedAt,
    finishedAt: Date.now(),
    manifest: result.manifest,
    findings: result.findings,
    verify: result.verify,
    artifacts,
    error: null,
  };
  legalStore().saveRun(tenant, matter.id, record);

  throwIfJobAborted(abortSignal);
  const card = knowledgeCard(matter, artifacts, result.deliverables, models.drafting);
  if (card) {
    await upsertWorkSource(tenant, artifactWorkCard(card));
  }

  return {
    runId,
    manifest: result.manifest,
    findings: result.findings,
    verify: result.verify,
    artifacts,
  };
}

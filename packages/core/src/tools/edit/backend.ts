import type { TenantContext } from "../../tenancy/types";
import type { Clip, EditProject, Ingredient } from "../../edit/document";
import type { ApplyableOp } from "../../edit/ops";

export type EditSilenceRange = { startFrame: number; endFrame: number };

export type EditJobKind = "generate_image" | "generate_video" | "ffmpeg_op" | "render" | "asr";

export type EditStartJobInput = {
  kind: EditJobKind;
  request: unknown;
  targetClipIds?: string[];
  cardId?: string;
  tier?: string;
};

export type EditStartGenerateJobInput = {
  kind: "generate_image" | "generate_video";
  prompt: string;
  aspect?: string;
  tier?: "draft" | "standard" | "cinematic";
  model?: string;
  seconds?: number;
  imageUrl?: string;
  imageAssetId?: string;
  count?: number;
  placeAt?: { trackId: string; timelineStartFrame: number };
  clipId?: string;
  addSeconds?: number;
  toolKey?: string;
  ingredientIds?: string[];
};

export type EditStartGenerateJobResult = {
  job: unknown;
  clips: Clip[];
  estimateUsd: number | null;
  card: unknown;
};

export type EditPlanInput = {
  steps: Array<{ tool: string; args: Record<string, unknown>; estimateUsd?: number }>;
  totalUsd: number;
};

export type ApplyAgentOpsResult = {
  ops: unknown[];
  card: unknown;
};

/**
 * Host-registered seam. Core tools never talk to SQLite, ffmpeg, or the gateway directly.
 * Mutating tools MUST funnel through `applyAgentOps` so actor/cardId stamping stays host-side (G-01).
 */
export type EditToolBackend = {
  getProject(tenant: TenantContext): Promise<EditProject>;
  listClips(tenant: TenantContext, trackId?: string): Promise<Clip[]>;
  probeAsset(tenant: TenantContext, assetId: string): Promise<unknown>;
  listIngredients(tenant: TenantContext): Promise<Ingredient[]>;
  detectSilence(
    tenant: TenantContext,
    args: { assetId: string; noiseDb?: number; minSeconds?: number },
  ): Promise<{ ranges: EditSilenceRange[] }>;
  detectScenes(tenant: TenantContext, args: { assetId: string; threshold?: number }): Promise<{ frames: number[] }>;
  asrAvailable(tenant: TenantContext): Promise<boolean>;
  reviewGateOpen(projectId: string): Promise<boolean>;
  applyAgentOps(tenant: TenantContext, ops: ApplyableOp[]): Promise<ApplyAgentOpsResult>;
  startJob(tenant: TenantContext, job: EditStartJobInput): Promise<{ job: unknown }>;
  startGenerateJob(tenant: TenantContext, job: EditStartGenerateJobInput): Promise<EditStartGenerateJobResult>;
  proposePlan(tenant: TenantContext, plan: EditPlanInput): Promise<{ card: unknown }>;
  cancelJob(tenant: TenantContext, jobId: string): Promise<unknown>;
};

let backend: EditToolBackend | null = null;

export function setEditToolBackend(next: EditToolBackend | null): void {
  backend = next;
}

export function getEditToolBackend(): EditToolBackend | null {
  return backend;
}

export function requireEditToolBackend(): EditToolBackend {
  if (!backend) {
    throw new Error("edit_backend_unconfigured");
  }
  return backend;
}

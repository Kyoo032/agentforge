import { and, eq } from "drizzle-orm";
import type {
  ApplyableOp,
  Clip,
  EditProject,
  Ingredient,
  TenantContext,
  EditStartJobInput,
  EditStartGenerateJobInput,
  EditPlanInput,
  EditToolBackend,
} from "@agentforge/core";
import { db, editCards } from "@agentforge/db";
import { requireEditToolContext } from "./context";
import { appendOps, foldProject, writeSnapshot } from "./ops";
import { cancelEditJob, enqueueEditJob } from "./jobs";
import { startGenerateJob } from "./start-generate";
import { reviewGateOpen } from "./review";
import { resolveAsrCapability } from "./asr";
import { assetAbsPath, probe as probeFile, sceneDetect, silenceDetect } from "./ffmpeg/recipes";
import { mapCard } from "./projects";
import { editEvents } from "./events";

function touchingClipIds(ops: ApplyableOp[]): string[] {
  const ids: string[] = [];
  for (const op of ops) {
    const payload = op.payload as Record<string, unknown>;
    if (typeof payload.clipId === "string") {
      ids.push(payload.clipId);
    }
    if (Array.isArray(payload.clipIds)) {
      ids.push(...payload.clipIds.filter((id): id is string => typeof id === "string"));
    }
    if (payload.clip && typeof payload.clip === "object" && typeof (payload.clip as Clip).id === "string") {
      ids.push((payload.clip as Clip).id);
    }
  }
  return [...new Set(ids)];
}

function stampBadges(doc: EditProject, cardId: string, clipIds: string[]): EditProject {
  const next = structuredClone(doc);
  for (const clip of next.clips) {
    if (clipIds.includes(clip.id)) {
      clip.badge = { cardId };
    }
  }
  return next;
}

function verbFor(ops: ApplyableOp[]): { verb: string; object: string } {
  const first = ops[0];
  if (!first) {
    return { verb: "Edit", object: "timeline" };
  }
  return { verb: first.type.replaceAll("_", " "), object: touchingClipIds(ops)[0] ?? "timeline" };
}

export const hostEditBackend: EditToolBackend = {
  async getProject(tenant) {
    const ctx = requireEditToolContext();
    if (tenant.workspaceId !== ctx.tenant.workspaceId) {
      throw new Error("edit_workspace_mismatch");
    }
    return foldProject(ctx.projectId, tenant.workspaceId);
  },
  async listClips(tenant, trackId) {
    const project = await hostEditBackend.getProject(tenant);
    return trackId ? project.clips.filter((clip) => clip.trackId === trackId) : project.clips;
  },
  async probeAsset(tenant, assetId) {
    const project = await hostEditBackend.getProject(tenant);
    const asset = project.assets[assetId];
    if (!asset) {
      return { error: "asset_not_found" };
    }
    return probeFile(await assetAbsPath(tenant.tenantId, asset), { tenantId: tenant.tenantId, projectId: project.id });
  },
  async listIngredients(tenant): Promise<Ingredient[]> {
    const project = await hostEditBackend.getProject(tenant);
    return project.ingredients;
  },
  async detectSilence(tenant, args) {
    const project = await hostEditBackend.getProject(tenant);
    const asset = project.assets[args.assetId];
    if (!asset) {
      return { ranges: [] };
    }
    return silenceDetect(
      await assetAbsPath(tenant.tenantId, asset),
      { tenantId: tenant.tenantId, projectId: project.id },
      project.fps,
      args.noiseDb,
      args.minSeconds,
    );
  },
  async detectScenes(tenant, args) {
    const project = await hostEditBackend.getProject(tenant);
    const asset = project.assets[args.assetId];
    if (!asset) {
      return { frames: [] };
    }
    return sceneDetect(
      await assetAbsPath(tenant.tenantId, asset),
      { tenantId: tenant.tenantId, projectId: project.id },
      project.fps,
      args.threshold,
    );
  },
  async asrAvailable() {
    return resolveAsrCapability().available;
  },
  async reviewGateOpen(projectId) {
    // The tool contract passes only an id. The run's own context is the scope: a tool cannot ask
    // about a project its run was not opened on.
    const ctx = requireEditToolContext();
    if (projectId !== ctx.projectId) {
      throw new Error("edit_project_mismatch");
    }
    const project = await foldProject(ctx.projectId, ctx.tenant.workspaceId);
    return reviewGateOpen(project.review);
  },
  async applyAgentOps(tenant, ops) {
    const ctx = requireEditToolContext();
    const cardId = crypto.randomUUID();
    const { verb, object } = verbFor(ops);
    const [cardRow] = await db
      .insert(editCards)
      .values({
        id: cardId,
        projectId: ctx.projectId,
        runId: ctx.runId,
        toolKey: ops[0]?.type ?? "edit",
        verb,
        object,
        opIdsJson: [],
        status: "proposed",
        thumbsJson: [],
      })
      .returning();
    const applied = await appendOps(
      ctx.projectId,
      ops.map((op) => ({ ...op, cardId })),
      {
        actor: `agent:${ctx.runId}`,
        cardId,
        workspaceId: ctx.tenant.workspaceId,
      },
    );
    await db
      .update(editCards)
      .set({ opIdsJson: applied.applied.map((op) => op.id) })
      .where(and(eq(editCards.id, cardId), eq(editCards.projectId, ctx.projectId)));
    const badged = stampBadges(applied.doc, cardId, touchingClipIds(ops));
    await writeSnapshot(ctx.projectId, applied.seq, badged);
    const card = mapCard({ ...cardRow, opIdsJson: applied.applied.map((op) => op.id) });
    editEvents.emitEvent({ type: "card.updated", projectId: ctx.projectId, card });
    void tenant;
    return { ops: applied.applied, card };
  },
  async startJob(tenant, job: EditStartJobInput) {
    const ctx = requireEditToolContext();
    const row = await enqueueEditJob(ctx.projectId, {
      kind: job.kind,
      // Tools put `tenant` in their requests; `enqueueEditJob` drops it. The requester is the run's
      // own user, from the context the host set from the verified request.
      request: job.request,
      targetClipIds: job.targetClipIds ?? [],
      cardId: job.cardId,
      tier: job.tier,
      requestedBy: ctx.tenant.userId,
    });
    void tenant;
    return { job: row };
  },
  async startGenerateJob(tenant, job: EditStartGenerateJobInput) {
    const ctx = requireEditToolContext();
    return startGenerateJob(tenant, ctx.projectId, job, { runId: ctx.runId });
  },
  async proposePlan(tenant, plan: EditPlanInput) {
    const ctx = requireEditToolContext();
    const [cardRow] = await db
      .insert(editCards)
      .values({
        id: crypto.randomUUID(),
        projectId: ctx.projectId,
        runId: ctx.runId,
        toolKey: "propose_plan",
        verb: "Plan",
        object: `${plan.steps.length} steps`,
        opIdsJson: [],
        status: "proposed",
        thumbsJson: [],
        estimateUsd: plan.totalUsd,
      })
      .returning();
    const card = mapCard(cardRow);
    editEvents.emitEvent({ type: "card.updated", projectId: ctx.projectId, card });
    void tenant;
    return { card };
  },
  async cancelJob(tenant, jobId) {
    const ctx = requireEditToolContext();
    if (tenant.workspaceId !== ctx.tenant.workspaceId) {
      throw new Error("edit_workspace_mismatch");
    }
    // Pins the job to the run's project, so a job id alone cannot cancel another desk's work.
    return cancelEditJob(jobId, ctx.projectId);
  },
};

export function createHostEditBackend(): EditToolBackend {
  return hostEditBackend;
}

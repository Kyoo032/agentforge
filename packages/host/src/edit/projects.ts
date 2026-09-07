import { and, desc, eq } from "drizzle-orm";
import {
  ApiError,
  ASPECT_SIZE,
  applyOp,
  emptyProject,
  DEFAULT_TITLE_STYLE,
  type AspectRatio,
  type TenantContext,
} from "@agentforge/core";
import { STARTER_PROJECTS } from "@agentforge/core/edit";
import { db, editCards, editJobs, editProjects, editUnplaced } from "@agentforge/db";
import { foldProject, writeSnapshot } from "./ops";
import { seedStarterMedia } from "./starter-media";

const ASPECTS = new Set(["16:9", "9:16", "1:1"]);

export async function createEditProject(
  tenant: TenantContext,
  input: { name?: string; aspect?: string; fps?: number; starterId?: string },
) {
  const starter = STARTER_PROJECTS.find((item) => item.id === input.starterId);
  const aspect = (starter?.aspect ??
    (ASPECTS.has(input.aspect ?? "") ? input.aspect : "16:9")) as AspectRatio;
  const fps = input.fps === 24 || input.fps === 25 || input.fps === 30 || input.fps === 60 ? input.fps : 30;
  const id = crypto.randomUUID();
  const name = input.name?.trim() || "Untitled";
  const now = new Date();
  const size = ASPECT_SIZE[aspect];
  const review = { lastAgentSeq: 0, ackSeq: 0 };
  await db.insert(editProjects).values({
    id,
    organizationId: tenant.organizationId,
    workspaceId: tenant.workspaceId,
    name,
    fps,
    width: size.width,
    height: size.height,
    seq: 0,
    reviewJson: review,
    createdAt: now,
    updatedAt: now,
  });
  const seeded = seedStarterProject(
    emptyProject({ id, workspaceId: tenant.workspaceId, name, aspect, fps }),
    starter,
  );
  let doc: typeof seeded;
  let missing: string[];
  try {
    ({ doc, missing } = await seedStarterMedia(tenant, seeded, starter));
  } catch (error) {
    await db.delete(editProjects).where(eq(editProjects.id, id));
    console.warn(`[edit] starter "${starter?.id}" seeding failed for project ${id}; project row removed: ${String(error)}`);
    throw error;
  }
  if (missing.length > 0) {
    console.warn(
      `[edit] starter "${starter?.id}" skipped ${missing.length} bundled file(s) not found in the starter media dir: ${missing.join(", ")}`,
    );
  }
  await writeSnapshot(id, 0, doc);
  return doc;
}

function seedStarterProject(
  doc: ReturnType<typeof emptyProject>,
  starter: (typeof STARTER_PROJECTS)[number] | undefined,
) {
  if (!starter) {
    return doc;
  }
  let next = doc;
  if (starter.seedTitle) {
    next = applyOp(next, {
      type: "add_clip",
      payload: {
        clip: {
          id: crypto.randomUUID(),
          trackId: "v1",
          timelineStartFrame: 0,
          durationFrames: next.fps * 3,
          status: "ready",
          title: { text: "Title", style: DEFAULT_TITLE_STYLE },
        },
      },
    });
  }
  if (starter.seedCaption) {
    next = applyOp(next, {
      type: "add_clip",
      payload: {
        clip: {
          id: crypto.randomUUID(),
          trackId: "c1",
          timelineStartFrame: 0,
          durationFrames: next.fps * 5,
          status: "ready",
          caption: { text: "Sample caption" },
        },
      },
    });
  }
  if (starter.seedMusic) {
    next = applyOp(next, {
      type: "add_ingredient",
      payload: {
        ingredient: {
          id: crypto.randomUUID(),
          name: "@music-bed",
          text: "Drop a music track here",
        },
      },
    });
  }
  return next;
}

export async function listEditProjects(tenant: TenantContext) {
  const rows = await db
    .select()
    .from(editProjects)
    .where(and(eq(editProjects.organizationId, tenant.organizationId), eq(editProjects.workspaceId, tenant.workspaceId)))
    .orderBy(desc(editProjects.updatedAt));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    fps: row.fps,
    width: row.width,
    height: row.height,
    seq: row.seq,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getEditProjectBundle(tenant: TenantContext, projectId: string) {
  const project = await foldProject(projectId, tenant.workspaceId);
  const [cards, jobs, unplaced] = await Promise.all([
    db.select().from(editCards).where(eq(editCards.projectId, projectId)).orderBy(desc(editCards.createdAt)),
    db.select().from(editJobs).where(eq(editJobs.projectId, projectId)).orderBy(desc(editJobs.createdAt)),
    db.select().from(editUnplaced).where(eq(editUnplaced.projectId, projectId)).orderBy(desc(editUnplaced.createdAt)),
  ]);
  return {
    project,
    cards: cards.map(mapCard),
    jobs: jobs.map(mapJob),
    unplaced: unplaced.map(mapUnplaced),
    seq: project.seq,
  };
}

export function mapCard(row: typeof editCards.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    runId: row.runId,
    toolKey: row.toolKey,
    verb: row.verb,
    object: row.object,
    opIds: row.opIdsJson,
    jobId: row.jobId,
    status: row.status,
    thumbs: row.thumbsJson,
    estimateUsd: row.estimateUsd,
    tier: row.tier,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export function mapJob(row: typeof editJobs.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    status: row.status,
    targetClipIds: row.targetClipIdsJson,
    cardId: row.cardId,
    request: row.requestJson,
    model: row.model,
    tier: row.tier,
    estimateUsd: row.estimateUsd,
    actualUsd: row.actualUsd,
    progress: row.progress,
    outputAssetIds: row.outputAssetIdsJson,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    cancelRequestedAt: row.cancelRequestedAt,
  };
}

export function mapUnplaced(row: typeof editUnplaced.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    jobId: row.jobId,
    assetId: row.assetId,
    prompt: row.prompt,
    createdAt: row.createdAt,
    placedClipId: row.placedClipId,
    discardedAt: row.discardedAt,
  };
}

export function requireAspect(value: unknown): AspectRatio {
  if (value === "16:9" || value === "9:16" || value === "1:1") {
    return value;
  }
  throw new ApiError("invalid_request", "aspect must be 16:9, 9:16, or 1:1", 400);
}

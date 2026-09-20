import { and, eq } from "drizzle-orm";
import { ApiError, computeInverse, emptyProject, foldOps, type ApplyableOp, type EditProject } from "@agentforge/core";
import { db, editCards, editOps } from "@agentforge/db";
import { appendOps, foldProject, rowToEditOp, writeSnapshot } from "./ops";
import { cancelEditJob } from "./jobs";
import { editEvents } from "./events";
import { appendEditMetric } from "./metrics";
import { mapCard } from "./projects";

function seedFrom(doc: EditProject): EditProject {
  const aspect = doc.width === doc.height ? "1:1" : doc.width > doc.height ? "16:9" : "9:16";
  const seed = emptyProject({
    id: doc.id,
    workspaceId: doc.workspaceId,
    name: doc.name,
    aspect,
    fps: doc.fps,
  });
  seed.width = doc.width;
  seed.height = doc.height;
  seed.createdAt = doc.createdAt;
  return seed;
}

function stripBadge(doc: EditProject, cardId: string) {
  const next = structuredClone(doc);
  for (const clip of next.clips) {
    if (clip.badge?.cardId === cardId) {
      delete clip.badge;
    }
  }
  return next;
}

/**
 * Rewind a card's ops.
 *
 * The card is pinned to its project and the project to the caller's desk, both in the WHERE clause:
 * a bare card id from another desk finds no row and 404s before anything is rewound.
 */
export async function undoCard(projectId: string, cardId: string, workspaceId: string) {
  const cardScope = and(eq(editCards.id, cardId), eq(editCards.projectId, projectId));
  const cards = await db.select().from(editCards).where(cardScope).limit(1);
  const card = cards[0];
  if (!card) {
    throw new ApiError("not_found", "Card not found", 404);
  }
  if (card.jobId) {
    await cancelEditJob(card.jobId, projectId, "undo");
    appendEditMetric({ projectId, cardId, jobId: card.jobId, event: "card_undo_cancels_job" });
  }
  const opRows = await db.select().from(editOps).where(eq(editOps.projectId, projectId));
  const allOps = opRows.map(rowToEditOp).sort((a, b) => a.seq - b.seq);
  const cardOps = allOps.filter((op) => op.cardId === cardId).sort((a, b) => b.seq - a.seq);
  const inverses: ApplyableOp[] = [];
  const seed = await foldProject(projectId, workspaceId);
  for (const op of cardOps) {
    const prefix = allOps.filter((item) => item.seq < op.seq);
    const base = foldOps(seedFrom(seed), prefix);
    const inverse = computeInverse(base, { type: op.type, payload: op.payload });
    if (inverse) {
      inverses.push(inverse);
    }
  }
  const applied = await appendOps(
    projectId,
    inverses.map((op) => ({ type: op.type, payload: op.payload, undoOf: cardId })),
    { actor: "owner", undoOf: cardId, workspaceId },
  );
  const stripped = stripBadge(applied.doc, cardId);
  await writeSnapshot(projectId, applied.seq, stripped);
  const [updated] = await db
    .update(editCards)
    .set({ status: "undone", decidedAt: new Date() })
    .where(cardScope)
    .returning();
  editEvents.emitEvent({ type: "card.updated", projectId, card: mapCard(updated) });
  appendEditMetric({ projectId, cardId, event: "card.decided", data: { status: "undone" } });
  return { applied: applied.applied, card: mapCard(updated), seq: applied.seq };
}

/** Accept a card. Scoped exactly as {@link undoCard}. */
export async function keepCard(projectId: string, cardId: string, workspaceId: string) {
  const cardScope = and(eq(editCards.id, cardId), eq(editCards.projectId, projectId));
  const cards = await db.select().from(editCards).where(cardScope).limit(1);
  const card = cards[0];
  if (!card) {
    throw new ApiError("not_found", "Card not found", 404);
  }
  const doc = stripBadge(await foldProject(projectId, workspaceId), cardId);
  await writeSnapshot(projectId, doc.seq, doc);
  const [updated] = await db
    .update(editCards)
    .set({ status: "kept", decidedAt: new Date() })
    .where(cardScope)
    .returning();
  editEvents.emitEvent({ type: "card.updated", projectId, card: mapCard(updated) });
  appendEditMetric({ projectId, cardId, event: "card.decided", data: { status: "kept" } });
  return mapCard(updated);
}

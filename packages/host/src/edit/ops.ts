import { and, desc, eq, gt } from "drizzle-orm";
import {
  ApiError,
  applyOp,
  assertAgentOpHasCard,
  computeInverse,
  emptyProject,
  foldOps,
  parseOpPayload,
  type ApplyableOp,
  type EditOp,
  type EditProject,
  type OpType,
} from "@agentforge/core";
import { db, editOps, editProjects, editSnapshots, organizations } from "@agentforge/db";
import { editEvents } from "./events";

export const SNAPSHOT_EVERY = 200;

export type AppendOpInput = {
  type: OpType | string;
  payload: unknown;
  cardId?: string;
  undoOf?: string;
};

export type AppendOpsOptions = {
  actor: "owner" | `agent:${string}`;
  /** The desk the ops are written on behalf of. Required so no caller can append by project id alone. */
  workspaceId: string;
  parent?: string | null;
  clock?: number;
  cardId?: string;
  undoOf?: string;
};

function iso(date: Date | string | number | null | undefined): string {
  if (!date) {
    return new Date().toISOString();
  }
  if (typeof date === "string") {
    return date;
  }
  return new Date(date).toISOString();
}

function asOpType(type: string): OpType {
  return type as OpType;
}

export function rowToEditOp(row: typeof editOps.$inferSelect): EditOp {
  return {
    id: row.id,
    projectId: row.projectId,
    seq: row.seq,
    parent: row.parent,
    clock: row.clock,
    actor: row.actor as EditOp["actor"],
    type: row.type as EditOp["type"],
    payload: row.payloadJson,
    inverse: row.inverseJson ?? null,
    ...(row.cardId ? { cardId: row.cardId } : {}),
    ...(row.undoOf ? { undoOf: row.undoOf } : {}),
    createdAt: iso(row.createdAt),
  };
}

/**
 * Load a project, scoped to the desk that asked for it.
 *
 * The workspace is part of the WHERE clause, not an afterthought: a caller that holds only an id
 * cannot reach another desk's project, and "wrong desk" is indistinguishable from "no such project"
 * so the 404 leaks nothing about what exists elsewhere.
 */
export async function loadProjectRow(projectId: string, workspaceId: string) {
  const rows = await db
    .select()
    .from(editProjects)
    .where(and(eq(editProjects.id, projectId), eq(editProjects.workspaceId, workspaceId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ApiError("not_found", "Edit project not found", 404);
  }
  return row;
}

/**
 * The workspace a project belongs to, for a background worker that has no request to scope by.
 *
 * The job runner reaches a project through a job row that a handler already proved belonged to the
 * caller's desk, so there is no session left to check against; this turns that job row back into a
 * scope the rest of the store can enforce. Request handlers must never call it — they hold a tenant
 * and pass `tenant.workspaceId`, which puts the check in the WHERE clause instead of trusting the
 * caller. `edit-scope.test.ts` asserts no handler imports it.
 */
export async function workerWorkspaceId(projectId: string): Promise<string> {
  const rows = await db
    .select({ workspaceId: editProjects.workspaceId })
    .from(editProjects)
    .where(eq(editProjects.id, projectId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ApiError("not_found", "Edit project not found", 404);
  }
  return row.workspaceId;
}

/**
 * The tenant a project belongs to, for a background worker that has no request to scope by.
 *
 * Twin of `workerWorkspaceId`, and subject to the same rule: request handlers hold a tenant and
 * must pass `tenant.tenantId`. The job runner needs it to place scratch files and to build the
 * ffmpeg allowlist, so an `ffmpeg` argument cannot reach another tenant's tree.
 * `edit-scope.test.ts` asserts no handler imports it.
 */
export async function workerTenantId(projectId: string): Promise<string> {
  const rows = await db
    .select({ tenantId: organizations.tenantId })
    .from(editProjects)
    .innerJoin(organizations, eq(organizations.id, editProjects.organizationId))
    .where(eq(editProjects.id, projectId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new ApiError("not_found", "Edit project not found", 404);
  }
  return row.tenantId;
}

function seedDocFromRow(row: typeof editProjects.$inferSelect): EditProject {
  const aspect = row.width === row.height ? "1:1" : row.width > row.height ? "16:9" : "9:16";
  const doc = emptyProject({
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    aspect,
    fps: row.fps as 24 | 25 | 30 | 60,
  });
  doc.width = row.width;
  doc.height = row.height;
  doc.review = row.reviewJson;
  doc.seq = 0;
  doc.createdAt = iso(row.createdAt);
  doc.updatedAt = iso(row.updatedAt);
  return doc;
}

export async function foldProject(projectId: string, workspaceId: string): Promise<EditProject> {
  const row = await loadProjectRow(projectId, workspaceId);
  const snaps = await db
    .select()
    .from(editSnapshots)
    .where(eq(editSnapshots.projectId, projectId))
    .orderBy(desc(editSnapshots.upToSeq))
    .limit(1);
  const snap = snaps[0];
  const base = (snap?.docJson as EditProject | undefined) ?? seedDocFromRow(row);
  const afterSeq = snap?.upToSeq ?? 0;
  const opRows = await db
    .select()
    .from(editOps)
    .where(and(eq(editOps.projectId, projectId), gt(editOps.seq, afterSeq)))
    .orderBy(editOps.seq);
  if (opRows.length === 0) {
    base.seq = row.seq;
    base.review = row.reviewJson;
    return base;
  }
  return foldOps(base, opRows.map(rowToEditOp));
}

export async function writeSnapshot(projectId: string, upToSeq: number, doc: EditProject): Promise<void> {
  await db.insert(editSnapshots).values({
    id: crypto.randomUUID(),
    projectId,
    upToSeq,
    docJson: doc,
  });
}

export async function appendOps(
  projectId: string,
  inputs: AppendOpInput[],
  options: AppendOpsOptions,
): Promise<{ applied: EditOp[]; seq: number; doc: EditProject }> {
  if (inputs.length === 0) {
    const doc = await foldProject(projectId, options.workspaceId);
    return { applied: [], seq: doc.seq, doc };
  }

  const project = await loadProjectRow(projectId, options.workspaceId);

  const lastOps = await db
    .select()
    .from(editOps)
    .where(eq(editOps.projectId, projectId))
    .orderBy(desc(editOps.seq))
    .limit(1);
  const last = lastOps[0];
  let seq = project.seq;
  let parent = options.parent ?? last?.id ?? null;
  let clock = Math.max(options.clock ?? 0, last?.clock ?? 0);
  let doc = await foldProject(projectId, options.workspaceId);

  for (const input of inputs) {
    parseOpPayload(input.type as OpType, input.payload);
    const staged: EditOp = {
      id: "validate",
      projectId,
      seq: seq + 1,
      parent,
      clock: clock + 1,
      actor: options.actor,
      type: input.type as OpType,
      payload: input.payload,
      inverse: null,
      createdAt: new Date().toISOString(),
      ...((input.cardId ?? options.cardId) ? { cardId: input.cardId ?? options.cardId } : {}),
    };
    assertAgentOpHasCard(staged);
  }

  const applied: EditOp[] = [];
  for (const input of inputs) {
    const type = input.type as OpType;
    const applyable: ApplyableOp = { type, payload: input.payload };
    const inverse = computeInverse(doc, applyable);
    seq += 1;
    clock += 1;
    const op: EditOp = {
      id: crypto.randomUUID(),
      projectId,
      seq,
      parent,
      clock,
      actor: options.actor,
      type,
      payload: input.payload,
      inverse,
      createdAt: new Date().toISOString(),
    };
    const cardId = input.cardId ?? options.cardId;
    const undoOf = input.undoOf ?? options.undoOf;
    if (cardId) {
      op.cardId = cardId;
    }
    if (undoOf) {
      op.undoOf = undoOf;
    }
    assertAgentOpHasCard(op);
    doc = applyOp(doc, applyable);
    doc.seq = seq;
    if (op.actor.startsWith("agent:")) {
      doc.review.lastAgentSeq = seq;
    }
    doc.updatedAt = op.createdAt;
    await db.insert(editOps).values({
      id: op.id,
      projectId,
      seq: op.seq,
      parent: op.parent,
      clock: op.clock,
      actor: op.actor,
      type: op.type,
      payloadJson: op.payload,
      inverseJson: op.inverse,
      cardId: op.cardId,
      undoOf: op.undoOf,
      createdAt: new Date(op.createdAt),
    });
    applied.push(op);
    parent = op.id;
    if (seq % SNAPSHOT_EVERY === 0) {
      await db.insert(editSnapshots).values({
        id: crypto.randomUUID(),
        projectId,
        upToSeq: seq,
        docJson: structuredClone(doc),
      });
    }
  }

  await db
    .update(editProjects)
    .set({
      seq,
      reviewJson: doc.review,
      name: doc.name,
      fps: doc.fps,
      width: doc.width,
      height: doc.height,
      updatedAt: new Date(),
    })
    .where(and(eq(editProjects.id, projectId), eq(editProjects.workspaceId, options.workspaceId)));

  editEvents.emitEvent({ type: "ops.appended", projectId, ops: applied, seq });
  return { applied, seq, doc };
}

export { asOpType };

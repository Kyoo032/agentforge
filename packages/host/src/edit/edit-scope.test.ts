import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createLocalWorkspace, db, editCards, editJobs, editUnplaced } from "@agentforge/db";
import { getTenant } from "../tenant";
import { dispatch } from "../router";
import { seedEditProject } from "./harness";
import { appendOps, foldProject, loadProjectRow } from "./ops";
import { cancelEditJob, getEditJob } from "./jobs";
import { keepCard, undoCard } from "./undo";

/**
 * Lane A of the Phase 3 tenancy spec: every edit-store function that takes an id also takes and
 * uses a scope, so one desk's id can never reach another desk's row.
 *
 * Today the desk (`workspaces.id`) is the boundary these tests exercise; Lane B adds the tenant
 * column above it. Nothing here depends on that, because a foreign desk is already a foreign
 * caller as far as the edit store is concerned.
 */

/** A second desk in the same organization, with a project of its own. */
async function twoDesks() {
  const a = await seedEditProject("desk-a");
  const other = await createLocalWorkspace(db, a.tenant.organizationId, `desk-b-${crypto.randomUUID().slice(0, 8)}`);
  const tenantB = await getTenant(other.id);
  expect(tenantB.workspaceId).not.toBe(a.tenant.workspaceId);
  return { tenantA: a.tenant, projectA: a.project, tenantB };
}

async function seedUnplaced(projectId: string) {
  const [item] = await db
    .insert(editUnplaced)
    .values({
      id: crypto.randomUUID(),
      projectId,
      jobId: crypto.randomUUID(),
      assetId: crypto.randomUUID(),
      prompt: "desk-a-secret-marker",
    })
    .returning();
  return item;
}

describe("edit store scoping (Phase 3 lane A)", () => {
  it("discard 404s on a foreign desk and leaves the row untouched", async () => {
    const { projectA, tenantB } = await twoDesks();
    const item = await seedUnplaced(projectA.id);

    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${projectA.id}/unplaced/${item.id}/discard`,
      query: {},
      params: {},
      headers: {},
      workspaceId: tenantB.workspaceId,
    });

    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(404);
      // The 404 body must not carry any of desk A's record back to desk B.
      const body = JSON.stringify(result.body);
      expect(body).not.toContain(item.id);
      expect(body).not.toContain("desk-a-secret-marker");
    }

    const [after] = await db.select().from(editUnplaced).where(eq(editUnplaced.id, item.id)).limit(1);
    expect(after?.discardedAt).toBeNull();
  });

  it("discard still works for the desk that owns the item", async () => {
    const { tenantA, projectA } = await twoDesks();
    const item = await seedUnplaced(projectA.id);

    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${projectA.id}/unplaced/${item.id}/discard`,
      query: {},
      params: {},
      headers: {},
      workspaceId: tenantA.workspaceId,
    });

    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(200);
    }
    const [after] = await db.select().from(editUnplaced).where(eq(editUnplaced.id, item.id)).limit(1);
    expect(after?.discardedAt).not.toBeNull();
  });

  it("discard 404s when the item belongs to another project on the same desk", async () => {
    const { tenantA, projectA } = await twoDesks();
    const second = await seedEditProject("desk-a-second");
    const item = await seedUnplaced(second.project.id);

    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${projectA.id}/unplaced/${item.id}/discard`,
      query: {},
      params: {},
      headers: {},
      workspaceId: tenantA.workspaceId,
    });

    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(404);
    }
    const [after] = await db.select().from(editUnplaced).where(eq(editUnplaced.id, item.id)).limit(1);
    expect(after?.discardedAt).toBeNull();
  });

  it("place 404s on a foreign desk and leaves the row unplaced", async () => {
    const { projectA, tenantB } = await twoDesks();
    const item = await seedUnplaced(projectA.id);

    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${projectA.id}/unplaced/${item.id}/place`,
      query: {},
      params: {},
      headers: {},
      body: { trackId: "v1", timelineStartFrame: 0 },
      workspaceId: tenantB.workspaceId,
    });

    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(404);
    }
    const [after] = await db.select().from(editUnplaced).where(eq(editUnplaced.id, item.id)).limit(1);
    expect(after?.placedClipId).toBeNull();
  });

  it("loadProjectRow 404s for a foreign desk", async () => {
    const { tenantA, projectA, tenantB } = await twoDesks();
    await expect(loadProjectRow(projectA.id, tenantA.workspaceId)).resolves.toMatchObject({ id: projectA.id });
    await expect(loadProjectRow(projectA.id, tenantB.workspaceId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("foldProject 404s for a foreign desk", async () => {
    const { projectA, tenantB } = await twoDesks();
    await expect(foldProject(projectA.id, tenantB.workspaceId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("appendOps 404s for a foreign desk and writes nothing", async () => {
    const { tenantA, projectA, tenantB } = await twoDesks();
    const before = await foldProject(projectA.id, tenantA.workspaceId);

    await expect(
      appendOps(projectA.id, [{ type: "set_project_name", payload: { name: "hijacked" } }], {
        actor: "owner",
        workspaceId: tenantB.workspaceId,
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });

    const after = await foldProject(projectA.id, tenantA.workspaceId);
    expect(after.seq).toBe(before.seq);
    expect(after.name).toBe(before.name);
  });

  it("getEditJob 404s when the job belongs to another project", async () => {
    const { projectA } = await twoDesks();
    const other = await seedEditProject("job-owner");
    const [job] = await db
      .insert(editJobs)
      .values({
        id: crypto.randomUUID(),
        projectId: other.project.id,
        kind: "ffmpeg_op",
        status: "queued",
        targetClipIdsJson: [],
        requestJson: { recipe: "thumbnail" },
        progress: 0,
      })
      .returning();

    await expect(getEditJob(job.id, other.project.id)).resolves.toMatchObject({ id: job.id });
    await expect(getEditJob(job.id, projectA.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("cancelEditJob 404s when the job belongs to another project and does not patch it", async () => {
    const { projectA } = await twoDesks();
    const other = await seedEditProject("cancel-owner");
    const [job] = await db
      .insert(editJobs)
      .values({
        id: crypto.randomUUID(),
        projectId: other.project.id,
        kind: "ffmpeg_op",
        status: "queued",
        targetClipIdsJson: [],
        requestJson: { recipe: "thumbnail" },
        progress: 0,
      })
      .returning();

    await expect(cancelEditJob(job.id, projectA.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    const [after] = await db.select().from(editJobs).where(eq(editJobs.id, job.id)).limit(1);
    expect(after?.status).toBe("queued");
    expect(after?.cancelRequestedAt).toBeNull();
  });

  it("undoCard 404s for a card in another project and leaves it undecided", async () => {
    const { tenantA, projectA } = await twoDesks();
    const other = await seedEditProject("card-owner");
    const cardId = crypto.randomUUID();
    await db.insert(editCards).values({
      id: cardId,
      projectId: other.project.id,
      runId: "run-scope",
      toolKey: "edit",
      verb: "Set",
      object: "timeline",
      opIdsJson: [],
      status: "proposed",
      thumbsJson: [],
    });

    await expect(undoCard(projectA.id, cardId, tenantA.workspaceId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    const [after] = await db.select().from(editCards).where(eq(editCards.id, cardId)).limit(1);
    expect(after?.status).toBe("proposed");
    expect(after?.decidedAt).toBeNull();
  });

  it("keepCard 404s for a card in another project and leaves it undecided", async () => {
    const { tenantA, projectA } = await twoDesks();
    const other = await seedEditProject("keep-owner");
    const cardId = crypto.randomUUID();
    await db.insert(editCards).values({
      id: cardId,
      projectId: other.project.id,
      runId: "run-scope",
      toolKey: "edit",
      verb: "Set",
      object: "timeline",
      opIdsJson: [],
      status: "proposed",
      thumbsJson: [],
    });

    await expect(keepCard(projectA.id, cardId, tenantA.workspaceId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    const [after] = await db
      .select()
      .from(editCards)
      .where(and(eq(editCards.id, cardId), eq(editCards.projectId, other.project.id)))
      .limit(1);
    expect(after?.status).toBe("proposed");
    expect(after?.decidedAt).toBeNull();
  });

  it("keeps the unscoped worker reads out of the request path", () => {
    // workerWorkspaceId, workerTenantId and workerJob deliberately read by id alone. They exist for
    // the job runner, which holds no session; a handler reaching for one would be reintroducing the
    // hole lane A closed. `workerTenantId` was added by lane D for the per-tenant scratch dir and
    // ffmpeg allowlist, and is covered by the same rule.
    const handlers = path.join(__dirname, "..", "handlers");
    const files = readFileSync(path.join(handlers, "edit.ts"), "utf8");
    expect(files).not.toContain("workerWorkspaceId");
    expect(files).not.toContain("workerTenantId");
    expect(files).not.toContain("workerJob");
  });
});

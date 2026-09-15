import { afterEach, describe, expect, it } from "vitest";
import { createLocalWorkspace, db } from "@agentforge/db";
import { dispatch } from "../router";
import { getTenant } from "../tenant";
import { createEditProject } from "./projects";
import { enqueueEditJob, resetEditJobsForTests, setEditJobRunnerForTests } from "./jobs";

/**
 * Desk A's project (and the jobs under it) must be invisible to desk B even when B knows the ids:
 * the edit routes take a project id straight off the path, so every one of them has to fold the
 * project against the caller's workspace before it touches anything.
 */

function call(method: string, path: string, workspaceId?: string, body?: unknown) {
  return dispatch({ method, path, query: {}, params: {}, headers: {}, body, workspaceId });
}

async function seedTwoDesks() {
  const owner = await getTenant();
  const deskB = await createLocalWorkspace(db, owner.organizationId, `edit-idor-${crypto.randomUUID().slice(0, 8)}`);
  const project = await createEditProject(owner, { name: "Desk A timeline", aspect: "16:9", fps: 30 });
  const job = await enqueueEditJob(project.id, {
    kind: "ffmpeg_op",
    request: { recipe: "thumbnail" },
    targetClipIds: [],
  });
  return { project, job, deskBId: deskB.id };
}

function expectNotFound(result: Awaited<ReturnType<typeof call>>): void {
  expect(result.type).toBe("json");
  if (result.type === "json") {
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: { code: "not_found" } });
  }
}

describe("edit routes are scoped to the caller's desk", () => {
  afterEach(() => {
    resetEditJobsForTests();
    setEditJobRunnerForTests(null);
  });

  it("404s undo for another desk's project", async () => {
    const { project, deskBId } = await seedTwoDesks();
    expectNotFound(await call("POST", `/api/v1/edit/projects/${project.id}/undo`, deskBId, { cardId: "c1" }));
  });

  it("404s keep for another desk's project", async () => {
    const { project, deskBId } = await seedTwoDesks();
    expectNotFound(await call("POST", `/api/v1/edit/projects/${project.id}/cards/c1/keep`, deskBId));
  });

  it("404s a job read for another desk's project", async () => {
    const { project, job, deskBId } = await seedTwoDesks();
    expectNotFound(await call("GET", `/api/v1/edit/projects/${project.id}/jobs/${job.id}`, deskBId));
  });

  it("404s a job cancel for another desk's project", async () => {
    const { project, job, deskBId } = await seedTwoDesks();
    expectNotFound(await call("POST", `/api/v1/edit/projects/${project.id}/jobs/${job.id}/cancel`, deskBId));
  });

  it("404s an export download for another desk's project", async () => {
    const { project, job, deskBId } = await seedTwoDesks();
    expectNotFound(await call("GET", `/api/v1/edit/projects/${project.id}/export/${job.id}/file`, deskBId));
  });

  it("404s the event stream for another desk's project instead of opening it", async () => {
    const { project, deskBId } = await seedTwoDesks();
    const result = await call("GET", `/api/v1/edit/projects/${project.id}/events`, deskBId);
    expect(result.type).toBe("json");
    expectNotFound(result);
  });

  it("still serves the owning desk", async () => {
    const { project, job } = await seedTwoDesks();
    const owner = await getTenant();
    const result = await call("GET", `/api/v1/edit/projects/${project.id}/jobs/${job.id}`, owner.workspaceId);
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ id: job.id });
    }
  });

  it("404s a job that belongs to another project on the same desk", async () => {
    const { job } = await seedTwoDesks();
    const owner = await getTenant();
    const other = await createEditProject(owner, { name: "Second timeline", aspect: "16:9", fps: 30 });
    expectNotFound(await call("GET", `/api/v1/edit/projects/${other.id}/jobs/${job.id}`, owner.workspaceId));
  });
});

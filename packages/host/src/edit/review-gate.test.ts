import { afterEach, describe, expect, it } from "vitest";
import { dispatch } from "../router";
import { addReadyClip, seedEditProject } from "./harness";
import { appendOps, foldProject } from "./ops";
import { resetEditJobsForTests, setEditJobRunnerForTests } from "./jobs";

describe("review gate (G-10)", () => {
  afterEach(() => {
    resetEditJobsForTests();
    setEditJobRunnerForTests(null);
  });

  it("blocks export until ackSeq catches lastAgentSeq", async () => {
    setEditJobRunnerForTests(async () => ({ outputAssetIds: ["/tmp/export.mp4"] }));
    const { project } = await seedEditProject("review");
    await addReadyClip(project.id, "clip-rev");
    await appendOps(
      project.id,
      [{ type: "set_volume", payload: { clipId: "clip-rev", volume: 0.7 }, cardId: "card-rev" }],
      { actor: "agent:run-rev", cardId: "card-rev" },
    );
    const blocked = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/export`,
      query: {},
      params: {},
      headers: {},
      body: { preset: "h264-1080p" },
    });
    expect(blocked.type).toBe("json");
    if (blocked.type === "json") {
      expect(blocked.status).toBe(400);
      expect(blocked.body).toMatchObject({ error: { code: "review_required" } });
    }
    const current = await foldProject(project.id);
    await appendOps(project.id, [{ type: "review_ack", payload: { seq: current.review.lastAgentSeq } }], { actor: "owner" });
    const allowed = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/export`,
      query: {},
      params: {},
      headers: {},
      body: { preset: "h264-1080p" },
    });
    expect(allowed.type).toBe("json");
    if (allowed.type === "json") {
      expect(allowed.status).not.toBe(400);
    }
  });
});

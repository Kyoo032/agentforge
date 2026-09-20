import { afterEach, describe, expect, it } from "vitest";
import { addReadyClip, seedEditProject } from "./harness";
import { appendOps, foldProject } from "./ops";
import { enqueueEditJob, resetEditJobsForTests, setEditJobRunnerForTests } from "./jobs";

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out");
}

describe("job completion (G-07)", () => {
  afterEach(() => {
    resetEditJobsForTests();
    setEditJobRunnerForTests(null);
  });

  it("set_source targets clip id so a moved placeholder keeps its placement", async () => {
    const { project } = await seedEditProject("complete");
    const { clipId, assetId } = await addReadyClip(project.id, project.workspaceId, "ph-1");
    await appendOps(
      project.id,
      [{ type: "set_clip_status", payload: { clipId, status: "pending" } }],
      { actor: "owner", workspaceId: project.workspaceId },
    );
    await appendOps(
      project.id,
      [{ type: "move_clip", payload: { clipId, trackId: "v1", timelineStartFrame: 90 } }],
      { actor: "owner", workspaceId: project.workspaceId },
    );
    setEditJobRunnerForTests(async () => ({ outputAssetIds: [assetId] }));
    const job = await enqueueEditJob(project.id, {
      kind: "ffmpeg_op",
      request: { recipe: "thumbnail" },
      targetClipIds: [clipId],
    });
    await waitFor(async () => {
      const doc = await foldProject(project.id, project.workspaceId);
      return doc.clips.find((item) => item.id === clipId)?.status === "ready";
    });
    const doc = await foldProject(project.id, project.workspaceId);
    const clip = doc.clips.find((item) => item.id === clipId);
    expect(clip?.timelineStartFrame).toBe(90);
    expect(clip?.source?.assetId).toBe(assetId);
    expect(clip?.status).toBe("ready");
    expect(job.id).toBeTruthy();
  });
});

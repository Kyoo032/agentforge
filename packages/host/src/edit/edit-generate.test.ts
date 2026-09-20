import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { db, media } from "@agentforge/db";
import { dispatch } from "../router";
import { parseVideoGenerateBody } from "../studio-generate";
import { addReadyClip, seedEditProject } from "./harness";
import { appendOps, foldProject } from "./ops";
import { enqueueEditJob, resetEditJobsForTests, setEditJobRunnerForTests } from "./jobs";
import { setGenerateSubmit } from "./generate";

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

describe("edit generate host (G-20 / G-23)", () => {
  afterEach(() => {
    resetEditJobsForTests();
    setEditJobRunnerForTests(null);
    setGenerateSubmit(null);
  });

  it("returns video_still_unsupported for t2v-only models", () => {
    expect(() =>
      parseVideoGenerateBody({
        prompt: "still",
        imageUrl: "https://cdn.example/a.png",
        model: "mj_video",
      }),
    ).toThrow(ApiError);
    try {
      parseVideoGenerateBody({
        prompt: "still",
        imageUrl: "https://cdn.example/a.png",
        model: "mj_video",
      });
    } catch (error) {
      expect((error as ApiError).code).toBe("video_still_unsupported");
    }
  });

  it("POST generate refuses a still on t2v-only models", async () => {
    const { project } = await seedEditProject("gen-still");
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/generate`,
      query: {},
      params: {},
      headers: {},
      body: {
        kind: "video",
        prompt: "still",
        imageUrl: "https://cdn.example/a.png",
        model: "mj_video",
      },
    });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(400);
      expect(result.body).toMatchObject({ error: { code: "video_still_unsupported" } });
    }
  });

  it("POST generate creates a job and pending placeholder clips", async () => {
    setEditJobRunnerForTests(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { outputAssetIds: [] };
    });
    const { project } = await seedEditProject("gen-path");
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/generate`,
      query: {},
      params: {},
      headers: {},
      body: { kind: "image", prompt: "a red cube", tier: "draft", model: "gpt-image-2" },
    });
    expect(result.type).toBe("json");
    if (result.type !== "json") {
      return;
    }
    expect(result.status).toBe(201);
    const body = result.body as { job?: { id?: string; kind?: string }; clips?: Array<{ status?: string }> };
    expect(body.job?.kind).toBe("generate_image");
    expect(body.clips?.length).toBeGreaterThan(0);
    expect(body.clips?.[0]?.status).toBe("pending");
    const doc = await foldProject(project.id, project.workspaceId);
    expect(doc.clips.some((clip) => clip.status === "pending")).toBe(true);
  });
});

describe("job completion media to asset", () => {
  afterEach(() => {
    resetEditJobsForTests();
    setEditJobRunnerForTests(null);
    setGenerateSubmit(null);
  });

  it("turns a media table id into an edit asset with mediaId and storagePath", async () => {
    const { tenant, project } = await seedEditProject("gen-media");
    const { clipId } = await addReadyClip(project.id, project.workspaceId, "ph-gen");
    await appendOps(project.id, [{ type: "set_clip_status", payload: { clipId, status: "pending" } }], { actor: "owner", workspaceId: project.workspaceId });
    const mediaId = crypto.randomUUID();
    const storagePath = `${tenant.organizationId}/${mediaId}.mp4`;
    await db.insert(media).values({
      id: mediaId,
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      kind: "video",
      mime: "video/mp4",
      sizeBytes: 12,
      storagePath,
      url: `/api/v1/media/${mediaId}/file`,
    });
    setEditJobRunnerForTests(async () => ({ outputAssetIds: [mediaId] }));
    await enqueueEditJob(project.id, {
      kind: "generate_video",
      request: { prompt: "cat" },
      targetClipIds: [clipId],
    });
    await waitFor(async () => {
      const doc = await foldProject(project.id, project.workspaceId);
      return doc.clips.find((item) => item.id === clipId)?.status === "ready";
    });
    const doc = await foldProject(project.id, project.workspaceId);
    const clip = doc.clips.find((item) => item.id === clipId);
    const asset = clip?.source?.assetId ? doc.assets[clip.source.assetId] : undefined;
    expect(asset?.mediaId).toBe(mediaId);
    expect(asset?.storagePath).toBe(storagePath);
    expect(asset?.storagePath.startsWith(`edit/${project.id}/`)).toBe(false);
  });
});

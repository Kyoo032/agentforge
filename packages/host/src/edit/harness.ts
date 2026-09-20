import { getTenant } from "../tenant";
import { createEditProject } from "./projects";
import { appendOps, foldProject } from "./ops";

export async function seedEditProject(name = "Edit test") {
  const tenant = await getTenant();
  const project = await createEditProject(tenant, { name, aspect: "16:9", fps: 30 });
  return { tenant, project };
}

export async function addReadyClip(projectId: string, workspaceId: string, clipId: string = crypto.randomUUID()) {
  const assetId = crypto.randomUUID();
  await appendOps(
    projectId,
    [
      {
        type: "add_asset",
        payload: {
          asset: { id: assetId, kind: "video", storagePath: `org/${assetId}.mp4`, durationFrames: 300 },
        },
      },
      {
        type: "add_clip",
        payload: {
          clip: {
            id: clipId,
            trackId: "v1",
            timelineStartFrame: 0,
            durationFrames: 300,
            source: { assetId, inFrame: 0 },
            status: "ready",
          },
        },
      },
    ],
    { actor: "owner", workspaceId },
  );
  return { clipId, assetId, doc: await foldProject(projectId, workspaceId) };
}

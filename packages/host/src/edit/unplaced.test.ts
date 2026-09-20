import { afterEach, describe, expect, it } from "vitest";
import { db, editUnplaced } from "@agentforge/db";
import { eq } from "drizzle-orm";
import { addReadyClip, seedEditProject } from "./harness";
import { appendOps } from "./ops";
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

describe("unplaced (G-09)", () => {
  afterEach(() => {
    resetEditJobsForTests();
    setEditJobRunnerForTests(null);
  });

  it("lands in the tray when every target clip was deleted", async () => {
    const { project } = await seedEditProject("unplaced");
    const { clipId, assetId } = await addReadyClip(project.id, project.workspaceId, "gone");
    await appendOps(project.id, [{ type: "delete_clip", payload: { clipId } }], { actor: "owner", workspaceId: project.workspaceId });
    setEditJobRunnerForTests(async () => ({ outputAssetIds: [assetId] }));
    await enqueueEditJob(project.id, {
      kind: "ffmpeg_op",
      request: { recipe: "thumbnail" },
      targetClipIds: [clipId],
    });
    await waitFor(async () => {
      const rows = await db.select().from(editUnplaced).where(eq(editUnplaced.projectId, project.id));
      return rows.length > 0;
    });
    const rows = await db.select().from(editUnplaced).where(eq(editUnplaced.projectId, project.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.assetId).toBe(assetId);
  });
});

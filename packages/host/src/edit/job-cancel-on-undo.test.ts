import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db, editCards } from "@agentforge/db";
import { addReadyClip, seedEditProject } from "./harness";
import { appendOps } from "./ops";
import { undoCard } from "./undo";
import { enqueueEditJob, getEditJob, resetEditJobsForTests, setEditJobRunnerForTests } from "./jobs";

describe("job cancel on undo (G-08)", () => {
  afterEach(() => {
    resetEditJobsForTests();
    setEditJobRunnerForTests(null);
  });

  it("cancels a pending job when the card is undone", async () => {
    const { project } = await seedEditProject("undo-job");
    await addReadyClip(project.id, project.workspaceId, "clip-job");
    const cardId = crypto.randomUUID();
    await db.insert(editCards).values({
      id: cardId,
      projectId: project.id,
      runId: "run-job",
      toolKey: "transcribe",
      verb: "Transcribe",
      object: "clip-job",
      opIdsJson: [],
      status: "pending",
      thumbsJson: [],
    });
    setEditJobRunnerForTests(async (_job, signal) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
      return { outputAssetIds: [] };
    });
    const job = await enqueueEditJob(project.id, {
      kind: "asr",
      request: { assetId: "x" },
      targetClipIds: ["clip-job"],
      cardId,
    });
    await db.update(editCards).set({ jobId: job.id }).where(eq(editCards.id, cardId));
    await appendOps(
      project.id,
      [{ type: "set_clip_status", payload: { clipId: "clip-job", status: "pending", jobId: job.id }, cardId }],
      { actor: "agent:run-job", cardId, workspaceId: project.workspaceId },
    );
    await undoCard(project.id, cardId, project.workspaceId);
    const cancelled = await getEditJob(job.id, project.id);
    expect(cancelled.status).toBe("cancelled");
  });
});

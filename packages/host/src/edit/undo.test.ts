import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, editCards } from "@agentforge/db";
import { addReadyClip, seedEditProject } from "./harness";
import { appendOps, foldProject } from "./ops";
import { undoCard } from "./undo";

describe("undo (G-05)", () => {
  it("restores clip volume after undoing an agent card", async () => {
    const { project } = await seedEditProject("undo");
    await addReadyClip(project.id, project.workspaceId, "clip-undo");
    const before = await foldProject(project.id, project.workspaceId);
    const original = before.clips.find((item) => item.id === "clip-undo")?.volume ?? 1;
    await db.insert(editCards).values({
      id: crypto.randomUUID(),
      projectId: project.id,
      runId: "run-1",
      toolKey: "set_clip_volume",
      verb: "Set volume",
      object: "clip-undo",
      opIdsJson: [],
      status: "proposed",
      thumbsJson: [],
    });
    const cards = await db.select().from(editCards).where(eq(editCards.projectId, project.id));
    const cardId = cards[0]!.id;
    await appendOps(
      project.id,
      [{ type: "set_volume", payload: { clipId: "clip-undo", volume: 0.1 }, cardId }],
      { actor: "agent:run-1", cardId, workspaceId: project.workspaceId },
    );
    await undoCard(project.id, cardId, project.workspaceId);
    const after = await foldProject(project.id, project.workspaceId);
    expect(after.clips.find((item) => item.id === "clip-undo")?.volume ?? 1).toBe(original);
  });
});

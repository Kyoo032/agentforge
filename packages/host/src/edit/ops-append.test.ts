import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { appendOps, SNAPSHOT_EVERY, foldProject } from "./ops";
import { addReadyClip, seedEditProject } from "./harness";
import { db, editSnapshots } from "@agentforge/db";
import { eq } from "drizzle-orm";

describe("ops append (G-01)", () => {
  it("rejects agent ops without cardId", async () => {
    const { project } = await seedEditProject("g01");
    await addReadyClip(project.id, "clip-g01");
    await expect(
      appendOps(project.id, [{ type: "set_volume", payload: { clipId: "clip-g01", volume: 0.5 } }], {
        actor: "agent:run-1",
      }),
    ).rejects.toMatchObject({ code: "card_required", status: 400 });
  });

  it("assigns monotonic seq", async () => {
    const { project } = await seedEditProject("seq");
    await addReadyClip(project.id, "clip-seq");
    const first = await appendOps(
      project.id,
      [{ type: "set_volume", payload: { clipId: "clip-seq", volume: 0.2 } }],
      { actor: "owner" },
    );
    const second = await appendOps(
      project.id,
      [{ type: "set_volume", payload: { clipId: "clip-seq", volume: 0.4 } }],
      { actor: "owner" },
    );
    expect(second.applied[0]?.seq).toBe((first.applied[0]?.seq ?? 0) + 1);
    expect(second.seq).toBeGreaterThan(first.seq);
  });

  it("snapshots every 200 ops", async () => {
    const { project } = await seedEditProject("snap200");
    await addReadyClip(project.id, "clip-snap");
    const start = (await foldProject(project.id)).seq;
    const batch = Array.from({ length: SNAPSHOT_EVERY }, (_, index) => ({
      type: "set_volume" as const,
      payload: { clipId: "clip-snap", volume: index % 2 === 0 ? 0.5 : 1 },
    }));
    const result = await appendOps(project.id, batch, { actor: "owner" });
    expect(result.seq).toBe(start + SNAPSHOT_EVERY);
    const snaps = await db.select().from(editSnapshots).where(eq(editSnapshots.projectId, project.id));
    expect(snaps.some((row) => row.upToSeq > 0 && row.upToSeq % SNAPSHOT_EVERY === 0)).toBe(true);
  });

  it("accepts agent ops when cardId is present", async () => {
    const { project } = await seedEditProject("agent-ok");
    await addReadyClip(project.id, "clip-agent");
    const result = await appendOps(
      project.id,
      [{ type: "set_volume", payload: { clipId: "clip-agent", volume: 1.2 }, cardId: "card-1" }],
      { actor: "agent:run-ok", cardId: "card-1" },
    );
    expect(result.applied[0]?.cardId).toBe("card-1");
    expect(result.doc.review.lastAgentSeq).toBe(result.seq);
  });
});

describe("ops append errors", () => {
  it("surfaces invalid payloads as ApiError", async () => {
    const { project } = await seedEditProject("bad-op");
    await expect(
      appendOps(project.id, [{ type: "set_volume", payload: { clipId: "missing", volume: 9 } }], { actor: "owner" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

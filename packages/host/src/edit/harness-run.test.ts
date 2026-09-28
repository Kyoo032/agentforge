import { afterAll, describe, expect, it } from "vitest";

async function framesOf(events: AsyncIterable<string>): Promise<string> {
  const frames: string[] = [];
  for await (const frame of events) {
    frames.push(frame);
  }
  return frames.join("\n");
}

async function settleJobs(projectId: string): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db, editJobs } = await import("@agentforge/db");
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const rows = await db.select().from(editJobs).where(eq(editJobs.projectId, projectId));
    const open = rows.some((row) => row.status === "queued" || row.status === "running");
    if (!open) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function seedClip(projectId: string, workspaceId: string, durationFrames: number): Promise<void> {
  const { appendOps } = await import("./ops");
  await appendOps(
    projectId,
    [
      {
        type: "add_clip",
        payload: {
          clip: {
            id: crypto.randomUUID(),
            trackId: "v1",
            timelineStartFrame: 0,
            durationFrames,
            status: "ready",
          },
        },
      },
    ],
    { actor: "owner", workspaceId },
  );
}

describe("edit harness skills", () => {
  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
  });

  it("lifts dead air on a long clip", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const { runEditAgent } = await import("./agent-run");
    const { foldProject } = await import("./ops");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Air", aspect: "16:9", fps: 30 });
    await seedClip(doc.id, tenant.workspaceId, 150);
    const body = await framesOf(await runEditAgent({ tenant, projectId: doc.id, text: "Lift the dead air" }));
    expect(body).toContain("Lifted the dead air.");
    const after = await foldProject(doc.id, tenant.workspaceId);
    expect(after.clips.length).toBeGreaterThan(1);
  }, 60_000);

  it("cuts where the picture changes", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const { runEditAgent } = await import("./agent-run");
    const { foldProject } = await import("./ops");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Shots", aspect: "16:9", fps: 30 });
    await seedClip(doc.id, tenant.workspaceId, 180);
    const body = await framesOf(
      await runEditAgent({ tenant, projectId: doc.id, text: "Cut where the picture changes" }),
    );
    expect(body).toContain("Cut where the picture changes.");
    const after = await foldProject(doc.id, tenant.workspaceId);
    expect(after.clips).toHaveLength(3);
  }, 60_000);

  it("puts words on the picture", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const { runEditAgent } = await import("./agent-run");
    const { foldProject } = await import("./ops");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Words", aspect: "16:9", fps: 30 });
    const body = await framesOf(
      await runEditAgent({ tenant, projectId: doc.id, text: "Put words on the picture: Hello" }),
    );
    expect(body).toContain("Put the words on the picture.");
    const after = await foldProject(doc.id, tenant.workspaceId);
    expect(after.clips.some((clip) => clip.title?.text === "Hello")).toBe(true);
  }, 60_000);

  it("places a made still", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const { runEditAgent } = await import("./agent-run");
    const { foldProject } = await import("./ops");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Shot", aspect: "16:9", fps: 30 });
    const body = await framesOf(await runEditAgent({ tenant, projectId: doc.id, text: "Make a still of a harbour" }));
    expect(body).toContain("Placed a made shot on the timeline.");
    const after = await foldProject(doc.id, tenant.workspaceId);
    expect(after.clips.some((clip) => clip.lineage?.prompt?.includes("harbour"))).toBe(true);
    await settleJobs(doc.id);
  }, 60_000);

  it("hands back a file from the folded timeline", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const { runEditAgent } = await import("./agent-run");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "File", aspect: "16:9", fps: 30 });
    const body = await framesOf(await runEditAgent({ tenant, projectId: doc.id, text: "Hand me the file" }));
    expect(body).toContain("Handing back the file.");
    expect(body).toContain("h264-1080p");
    await settleJobs(doc.id);
  }, 60_000);
});

import { afterEach, describe, expect, it } from "vitest";
import { db, editJobs } from "@agentforge/db";
import { seedEditProject } from "./harness";
import { interruptRunningJobsOnBoot, resetEditJobsForTests } from "./jobs";
import { eq } from "drizzle-orm";

describe("jobs boot (G-26)", () => {
  afterEach(() => {
    resetEditJobsForTests();
  });

  it("marks running jobs interrupted on boot", async () => {
    const { project } = await seedEditProject("boot");
    const id = crypto.randomUUID();
    await db.insert(editJobs).values({
      id,
      projectId: project.id,
      kind: "ffmpeg_op",
      status: "running",
      targetClipIdsJson: [],
      requestJson: {},
      progress: 0.4,
    });
    resetEditJobsForTests();
    await interruptRunningJobsOnBoot();
    const rows = await db.select().from(editJobs).where(eq(editJobs.id, id));
    expect(rows[0]?.status).toBe("interrupted");
  });
});

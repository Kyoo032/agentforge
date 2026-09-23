/**
 * The still of an Edit generate, looked up only inside the caller's organization.
 *
 * `startGenerateJob` confirms a local still exists before it queues anything. It used to look the
 * media row up by id alone, so the answer said whether ANY organization owned that id: another
 * tenant's media id queued a priced job, while an id that does not exist answered 400
 * `still_not_found`. That difference is an existence oracle across tenants. The worker already reads
 * the still through the organization (`readMediaDataUrl`), so a foreign id could never generate;
 * the check in front of it now asks the same question the worker does.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-edit-still-scope-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

import { eq } from "drizzle-orm";
import type { EditStartGenerateJobInput, TenantContext } from "@agentforge/core";
import { db, editCards, editJobs, ensurePortalOwner } from "@agentforge/db";
import { saveMedia } from "../media";
import { getEditJob, resetEditJobsForTests, setEditJobRunnerForTests } from "./jobs";
import { createEditProject } from "./projects";
import { startGenerateJob } from "./start-generate";

const ALPHA = { tenantId: "still-tenant-a", orgId: "still-org-a", userId: "still-user-a" };
const BETA = { tenantId: "still-tenant-b", orgId: "still-org-b", userId: "still-user-b" };

/** A 1×1 PNG, so each media row has real bytes behind it. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let tenantA: TenantContext;
let tenantB: TenantContext;

function stillVideo(mediaId: string): EditStartGenerateJobInput {
  return {
    kind: "generate_video",
    prompt: "the still, slowly moving",
    imageUrl: `/api/v1/media/${mediaId}/file`,
    // Accepts a still, so the only thing that can refuse the request is the still itself.
    model: "grok-imagine-video",
  };
}

async function refusalOf(pending: Promise<unknown>): Promise<unknown> {
  return pending.then(
    () => null,
    (error: unknown) => error,
  );
}

async function settle(jobId: string, projectId: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < 5_000) {
    const job = await getEditJob(jobId, projectId);
    if (job.status !== "queued" && job.status !== "running") {
      return job.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not settle`);
}

beforeAll(async () => {
  tenantA = await ensurePortalOwner(db, ALPHA);
  tenantB = await ensurePortalOwner(db, BETA);
}, 60_000);

beforeEach(() => {
  // No gateway: a queued job finishes as soon as it starts.
  setEditJobRunnerForTests(async () => ({ outputAssetIds: [] }));
});

afterEach(() => {
  resetEditJobsForTests();
});

afterAll(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort, as in test/global-setup.ts: on Windows an open handle can refuse the delete.
  }
});

describe("the still of an Edit generate", () => {
  it("answers another organization's media id exactly as it answers an id that does not exist", async () => {
    const theirs = await saveMedia(tenantB, new File([PNG], "theirs.png", { type: "image/png" }));
    const project = await createEditProject(tenantA, { name: "still-foreign", aspect: "16:9", fps: 30 });

    const foreign = await refusalOf(startGenerateJob(tenantA, project.id, stillVideo(theirs.id)));
    const missing = await refusalOf(startGenerateJob(tenantA, project.id, stillVideo(crypto.randomUUID())));

    expect(missing).toMatchObject({ code: "still_not_found", status: 400 });
    expect(foreign).toMatchObject({ code: "still_not_found", status: 400 });
    expect((foreign as Error).message).toBe((missing as Error).message);
    // Nothing was queued, priced or drawn for either answer.
    expect(await db.select().from(editJobs).where(eq(editJobs.projectId, project.id))).toEqual([]);
    expect(await db.select().from(editCards).where(eq(editCards.projectId, project.id))).toEqual([]);
  });

  it("still takes a still from the caller's own organization", async () => {
    const mine = await saveMedia(tenantA, new File([PNG], "mine.png", { type: "image/png" }));
    const project = await createEditProject(tenantA, { name: "still-own", aspect: "16:9", fps: 30 });

    const result = await startGenerateJob(tenantA, project.id, stillVideo(mine.id));
    const job = result.job as { id: string; kind: string };

    expect(job.kind).toBe("generate_video");
    expect(await settle(job.id, project.id)).toBe("succeeded");
  });
});

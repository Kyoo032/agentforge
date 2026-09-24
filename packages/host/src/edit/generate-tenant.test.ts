/**
 * The generate worker runs as the project's tenant — never as the one a job row names.
 *
 * Before this, `defaultRunner` read `requestJson.tenant` and handed it to the studio as the
 * `TenantContext`: whose gateway key paid, whose usage ledger was charged, which desk received the
 * work card and which organization's media the still was read from. `requestJson` is written from a
 * request body on `POST …/jobs`, so a caller could queue a generate job as another tenant.
 *
 * Now every field of the tenant but the user comes from the project row, and the user is the one a
 * server path recorded when it queued the job — accepted only while that user is still a member of
 * the project's organization. The gateway gate is applied to that tenant before anything is spent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-edit-generate-tenant-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

import { eq } from "drizzle-orm";
import type { TenantContext } from "@agentforge/core";
import { db, editJobs, ensurePortalOwner } from "@agentforge/db";
import { dispatch } from "../router";
import { saveMedia } from "../media";
import { hostEditBackend } from "./backend";
import { withEditToolContext } from "./context";
import { setGenerateSubmit } from "./generate";
import { enqueueEditJob, getEditJob, resetEditJobsForTests, setEditJobRunnerForTests } from "./jobs";
import { createEditProject } from "./projects";
import { seedEditProject } from "./harness";
import { ensureGenerateSubmitWired } from "./wire-generate";

const STUB = process.env.AGENTFORGE_RUNTIME;

const ALPHA = { tenantId: "gen-tenant-a", orgId: "gen-org-a", userId: "gen-user-a" };
const BETA = { tenantId: "gen-tenant-b", orgId: "gen-org-b", userId: "gen-user-b" };

/** A 1×1 PNG, so the victim's media row has real bytes behind it. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let tenantA: TenantContext;
let tenantB: TenantContext;

type Seen = { tenant: unknown; request: unknown };

/**
 * Replace the gateway call with a recorder. `ensureGenerateSubmitWired` runs first so the queue's
 * own call to it is a no-op afterwards and cannot put the real submit back over the recorder.
 */
function recordSubmits(): Seen[] {
  ensureGenerateSubmitWired();
  const seen: Seen[] = [];
  setGenerateSubmit(async (input) => {
    seen.push({ tenant: (input as { tenant?: unknown }).tenant, request: input.request });
    return { status: 200, body: {}, outputAssetIds: [] };
  });
  return seen;
}

async function settle(jobId: string, projectId: string) {
  const start = Date.now();
  while (Date.now() - start < 5_000) {
    const job = await getEditJob(jobId, projectId);
    if (job.status !== "queued" && job.status !== "running") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`job ${jobId} did not settle`);
}

async function projectOfA(name: string) {
  return createEditProject(tenantA, { name, aspect: "16:9", fps: 30 });
}

beforeAll(async () => {
  tenantA = await ensurePortalOwner(db, ALPHA);
  tenantB = await ensurePortalOwner(db, BETA);
}, 60_000);

afterEach(() => {
  resetEditJobsForTests();
  setGenerateSubmit(null);
  process.env.AGENTFORGE_RUNTIME = STUB ?? "stub";
});

afterAll(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort, as in test/global-setup.ts: on Windows an open handle can refuse the delete.
  }
});

describe("the generate worker's tenant", () => {
  it("is the project's, whatever tenant the stored request names", async () => {
    const seen = recordSubmits();
    const project = await projectOfA("gen-forged-tenant");
    const job = await enqueueEditJob(project.id, {
      kind: "generate_image",
      request: { prompt: "a red cube", aspect: "square", tenant: tenantB },
      targetClipIds: [],
      requestedBy: tenantA.userId,
    });

    expect((await settle(job.id, project.id)).status).toBe("succeeded");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tenant).toEqual({
      tenantId: ALPHA.tenantId,
      organizationId: ALPHA.orgId,
      workspaceId: project.workspaceId,
      userId: ALPHA.userId,
      role: "owner",
    });
    // The provider request carries no identity at all, and nothing of B's reached the call.
    expect(seen[0]?.request).not.toHaveProperty("tenant");
    expect(seen[0]?.request).not.toHaveProperty("requestedBy");
    expect(JSON.stringify(seen)).not.toContain(BETA.tenantId);
    expect(JSON.stringify(seen)).not.toContain(BETA.orgId);
  });

  it("resolves the desk's local owner the same way, so the desktop still generates", async () => {
    // The Personal app has no portal: its owner is `ensureLocalOwner`'s rows, which the same
    // read-only resolver has to accept.
    const seen = recordSubmits();
    const { tenant, project } = await seedEditProject("gen-local-owner");
    const job = await enqueueEditJob(project.id, {
      kind: "generate_image",
      request: { prompt: "a red cube", aspect: "square" },
      targetClipIds: [],
      requestedBy: tenant.userId,
    });

    expect((await settle(job.id, project.id)).status).toBe("succeeded");
    expect(seen[0]?.tenant).toEqual({
      tenantId: tenant.tenantId,
      organizationId: tenant.organizationId,
      workspaceId: project.workspaceId,
      userId: tenant.userId,
      role: "owner",
    });
  });

  it("never stores a tenant on the job row", async () => {
    recordSubmits();
    const project = await projectOfA("gen-row-no-tenant");
    const job = await enqueueEditJob(project.id, {
      kind: "generate_image",
      request: { prompt: "a red cube", tenant: tenantB },
      targetClipIds: [],
      requestedBy: tenantA.userId,
    });
    await settle(job.id, project.id);

    const [row] = await db.select().from(editJobs).where(eq(editJobs.id, job.id));
    expect(row?.requestJson).not.toHaveProperty("tenant");
    expect(row?.requestJson).toMatchObject({ requestedBy: tenantA.userId });
    expect(JSON.stringify(row)).not.toContain(BETA.orgId);
  });

  it("refuses a requester who is not a member of the project's organization", async () => {
    const seen = recordSubmits();
    const project = await projectOfA("gen-foreign-requester");
    const job = await enqueueEditJob(project.id, {
      kind: "generate_image",
      request: { prompt: "a red cube" },
      targetClipIds: [],
      requestedBy: tenantB.userId,
    });

    const settled = await settle(job.id, project.id);
    expect(settled.status).toBe("failed");
    expect(settled.error).toBe("The account that queued this job can no longer run it.");
    expect(seen).toHaveLength(0);
  });

  it("fails closed when nobody was recorded as the requester", async () => {
    const seen = recordSubmits();
    const project = await projectOfA("gen-no-requester");
    const job = await enqueueEditJob(project.id, {
      kind: "generate_video",
      request: { prompt: "a red cube", tenant: tenantA },
      targetClipIds: [],
    });

    // A complete, genuine tenant in the request does not stand in for the recorded requester.
    const settled = await settle(job.id, project.id);
    expect(settled.status).toBe("failed");
    expect(settled.error).toBe("This job does not record who queued it, so it cannot run.");
    expect(seen).toHaveLength(0);
  });

  it("reads the still through the project's tenant, so another tenant's media is not reachable", async () => {
    const seen = recordSubmits();
    const project = await projectOfA("gen-foreign-still");
    const victimStill = await saveMedia(tenantB, new File([PNG], "still.png", { type: "image/png" }));
    const job = await enqueueEditJob(project.id, {
      kind: "generate_video",
      request: { prompt: "animate this", stillMediaId: victimStill.id, tenant: tenantB },
      targetClipIds: [],
      requestedBy: tenantA.userId,
    });

    const settled = await settle(job.id, project.id);
    expect(settled.status).toBe("failed");
    // Refused at the read: A's organization has no media row with B's id.
    expect(settled.error).toBe("The still image for this job is no longer available.");
    // Not one byte of B's image was inlined into a provider call.
    expect(seen).toHaveLength(0);
    expect(JSON.stringify(seen)).not.toContain(PNG.toString("base64"));
  });

  it("checks the gateway gate for the project's tenant before it spends anything", async () => {
    const seen = recordSubmits();
    const project = await projectOfA("gen-gate-shut");
    // Closed the way `handlers/finance-gate.test.ts` closes it: no stub runtime, and tenant A has no key.
    delete process.env.AGENTFORGE_RUNTIME;
    const job = await enqueueEditJob(project.id, {
      kind: "generate_image",
      request: { prompt: "a red cube" },
      targetClipIds: [],
      requestedBy: tenantA.userId,
    });

    const settled = await settle(job.id, project.id);
    expect(settled.status).toBe("failed");
    expect(settled.error).toBe("No gateway key is saved on this machine.");
    expect(seen).toHaveLength(0);
  });
});

describe("the server paths that queue a generate job", () => {
  it("POST …/generate records who asked and stores no tenant", async () => {
    setEditJobRunnerForTests(async () => ({ outputAssetIds: [] }));
    const { tenant, project } = await seedEditProject("gen-route-requester");
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/generate`,
      query: {},
      params: {},
      headers: {},
      body: { kind: "image", prompt: "a red cube", tier: "draft", model: "gpt-image-2" },
    });

    expect(result.type === "json" ? result.status : 0).toBe(201);
    const jobId = ((result.type === "json" ? result.body : {}) as { job?: { id?: string } }).job?.id ?? "";
    const [row] = await db.select().from(editJobs).where(eq(editJobs.id, jobId));
    expect(row?.requestJson).toMatchObject({ prompt: "a red cube", requestedBy: tenant.userId });
    expect(row?.requestJson).not.toHaveProperty("tenant");
    // The job the renderer is handed back does not carry the caller's tenant context either.
    expect(JSON.stringify(result)).not.toContain(`"organizationId":"${tenant.organizationId}"`);
  });

  it("the agent's job seam records the run's own user and drops the tool's tenant", async () => {
    setEditJobRunnerForTests(async () => ({ outputAssetIds: [] }));
    const project = await projectOfA("gen-agent-seam");
    const started = await withEditToolContext({ tenant: tenantA, projectId: project.id, runId: "run-seam" }, () =>
      hostEditBackend.startJob(tenantA, {
        kind: "generate_image",
        request: { prompt: "storyboard frame", tenant: tenantB },
        targetClipIds: [],
      }),
    );

    const jobId = (started.job as { id: string }).id;
    const [row] = await db.select().from(editJobs).where(eq(editJobs.id, jobId));
    expect(row?.requestJson).toMatchObject({ prompt: "storyboard frame", requestedBy: tenantA.userId });
    expect(row?.requestJson).not.toHaveProperty("tenant");
  });
});

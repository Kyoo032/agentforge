/**
 * `POST /api/v1/edit/projects/:projectId/jobs` — what a caller may queue by hand.
 *
 * The route used to hand `{ kind: body.kind, request: body.request }` to the queue verbatim, with the
 * kind cast rather than checked. Two holes followed from that. A generate job took its whole tenant
 * (key, ledger, desk, media reads) from `request.tenant`, so a caller could queue one as somebody
 * else; and it skipped the gateway gate that `/generate` and `/agent` apply before they spend
 * anything. The worker half of the fix is `generate-tenant.test.ts`; this file is the route half:
 * the kind is one of the five the queue knows, the generate kinds go through `/generate`, `asr` —
 * the other kind that reaches the gateway — is gated here, and whatever identity the body carries
 * is dropped before the row is written.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-edit-jobs-route-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

import { eq } from "drizzle-orm";
import type { TenantContext } from "@agentforge/core";
import { createLocalWorkspace, db, editJobs } from "@agentforge/db";
import { dispatch } from "../router";
import type { HostResult } from "../types";
import { addReadyClip, seedEditProject } from "./harness";
import { resetEditJobsForTests, setEditJobRunnerForTests } from "./jobs";
import { appendOps, foldProject } from "./ops";
import { reviewGateOpen } from "./review";

const STUB = process.env.AGENTFORGE_RUNTIME;

/** Another tenant's context, as a caller would forge it into a request body. */
const FORGED: TenantContext = {
  tenantId: "victim-tenant",
  organizationId: "victim-org",
  workspaceId: "victim-desk",
  userId: "victim-user",
  role: "owner",
};

function postJob(projectId: string, body: unknown, workspaceId?: string): Promise<HostResult> {
  return dispatch({
    method: "POST",
    path: `/api/v1/edit/projects/${projectId}/jobs`,
    query: {},
    params: {},
    headers: {},
    body,
    workspaceId,
  });
}

function statusOf(result: HostResult): number {
  return result.type === "json" ? result.status : 200;
}

function errorCodeOf(result: HostResult): string | undefined {
  if (result.type !== "json") {
    return undefined;
  }
  const error = (result.body as { error?: unknown } | null)?.error;
  if (typeof error === "string") {
    return error;
  }
  return (error as { code?: string } | undefined)?.code;
}

async function jobsOf(projectId: string) {
  return db.select().from(editJobs).where(eq(editJobs.projectId, projectId));
}

beforeEach(() => {
  // No ffmpeg, no gateway: a queued job finishes as soon as it starts.
  setEditJobRunnerForTests(async () => ({ outputAssetIds: [] }));
});

afterEach(() => {
  resetEditJobsForTests();
  process.env.AGENTFORGE_RUNTIME = STUB ?? "stub";
});

afterAll(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort, as in test/global-setup.ts: on Windows an open handle can refuse the delete.
  }
});

describe("POST …/jobs checks the kind", () => {
  it("refuses a kind the queue does not know, and queues nothing", async () => {
    const { project } = await seedEditProject("jobs-kind-unknown");
    const result = await postJob(project.id, { kind: "rm_rf", request: {} });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalid_request");
    expect(await jobsOf(project.id)).toHaveLength(0);
  });

  it("refuses a body with no kind at all", async () => {
    const { project } = await seedEditProject("jobs-kind-missing");
    const result = await postJob(project.id, { request: {} });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalid_request");
    expect(await jobsOf(project.id)).toHaveLength(0);
  });

  it("still 404s another desk's project before it looks at the body", async () => {
    // The tenancy harness sends `{}` here and needs the ownership refusal, not a body refusal.
    const { tenant, project } = await seedEditProject("jobs-kind-foreign");
    const other = await createLocalWorkspace(db, tenant.organizationId, `jobs-desk-b-${crypto.randomUUID().slice(0, 8)}`);
    const result = await postJob(project.id, { kind: "rm_rf" }, other.id);

    expect(statusOf(result)).toBe(404);
    expect(await jobsOf(project.id)).toHaveLength(0);
  });
});

describe("POST …/jobs and the generate kinds", () => {
  it.each(["generate_image", "generate_video"])(
    "refuses %s, which starts through /generate where it is gated, routed and priced",
    async (kind) => {
      const { project } = await seedEditProject(`jobs-${kind}`);
      const result = await postJob(project.id, { kind, request: { prompt: "a red cube", tenant: FORGED } });

      expect(statusOf(result)).toBe(400);
      expect(errorCodeOf(result)).toBe("invalid_request");
      expect(JSON.stringify(result)).toContain("/generate");
      expect(await jobsOf(project.id)).toHaveLength(0);
    },
  );
});

/**
 * `render` is the export. `/export` refuses it while an agent's edits are unreviewed; the renderer
 * and the agent's export tool both go through that check. Queued here it skipped the review gate
 * (and took its preset from the body unchecked), so the route refuses it and names `/export`.
 */
describe("POST …/jobs and render", () => {
  async function unreviewedProject(name: string) {
    const { project } = await seedEditProject(name);
    await addReadyClip(project.id, project.workspaceId, `${name}-clip`);
    await appendOps(
      project.id,
      [{ type: "set_volume", payload: { clipId: `${name}-clip`, volume: 0.5 }, cardId: `${name}-card` }],
      { actor: "agent:run-review", cardId: `${name}-card`, workspaceId: project.workspaceId },
    );
    return project;
  }

  it("refuses to render a timeline whose agent edits are unreviewed, and queues nothing", async () => {
    const project = await unreviewedProject("jobs-render-unreviewed");
    expect(reviewGateOpen((await foldProject(project.id, project.workspaceId)).review)).toBe(false);

    const result = await postJob(project.id, { kind: "render", request: { preset: "h264-1080p" } });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalid_request");
    expect(JSON.stringify(result)).toContain("/export");
    expect(await jobsOf(project.id)).toHaveLength(0);
  });

  it("refuses render even with the gate open: the export has one door, /export", async () => {
    const { project } = await seedEditProject("jobs-render-reviewed");
    expect(reviewGateOpen((await foldProject(project.id, project.workspaceId)).review)).toBe(true);

    const result = await postJob(project.id, { kind: "render", request: { preset: "h264-1080p" } });

    expect(statusOf(result)).toBe(400);
    expect(JSON.stringify(result)).toContain("/export");
    expect(await jobsOf(project.id)).toHaveLength(0);
  });
});

describe("POST …/jobs and identity in the body", () => {
  it("drops a tenant from the request and records the caller, not the body's requester", async () => {
    const { tenant, project } = await seedEditProject("jobs-strip-tenant");
    const result = await postJob(project.id, {
      kind: "ffmpeg_op",
      request: { recipe: "matchLook", clipId: "c1", tenant: FORGED, requestedBy: FORGED.userId },
    });

    expect(statusOf(result)).toBe(201);
    const [row] = await jobsOf(project.id);
    const stored = row?.requestJson as Record<string, unknown>;
    expect(stored).toMatchObject({ recipe: "matchLook", clipId: "c1", requestedBy: tenant.userId });
    expect(stored).not.toHaveProperty("tenant");
    // Nothing of the forged context survives anywhere in the row or in the answer.
    expect(JSON.stringify(row)).not.toContain(FORGED.tenantId);
    expect(JSON.stringify(result)).not.toContain(FORGED.organizationId);
  });
});

describe("POST …/jobs and the gateway gate", () => {
  it("answers 403 gateway_blocked for asr when the gate is shut, and queues nothing", async () => {
    const { project } = await seedEditProject("jobs-asr-gated");
    // Closed the way `handlers/finance-gate.test.ts` closes it: no stub runtime and no key.
    delete process.env.AGENTFORGE_RUNTIME;
    const result = await postJob(project.id, { kind: "asr", request: { assetId: "a1" } });

    expect(statusOf(result)).toBe(403);
    expect(errorCodeOf(result)).toBe("gateway_blocked");
    expect(await jobsOf(project.id)).toHaveLength(0);
  });

  it("queues asr when the gate is open", async () => {
    const { project } = await seedEditProject("jobs-asr-open");
    const result = await postJob(project.id, { kind: "asr", request: { assetId: "a1" } });

    expect(statusOf(result)).toBe(201);
    expect(await jobsOf(project.id)).toHaveLength(1);
  });

  it("does not gate the ffmpeg kinds, which never reach the gateway", async () => {
    const { project } = await seedEditProject("jobs-ffmpeg-ungated");
    delete process.env.AGENTFORGE_RUNTIME;
    const result = await postJob(project.id, { kind: "ffmpeg_op", request: { recipe: "silenceDetect" } });

    expect(statusOf(result)).toBe(201);
    expect(await jobsOf(project.id)).toHaveLength(1);
  });
});

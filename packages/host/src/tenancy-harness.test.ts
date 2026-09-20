/**
 * Phase 3 lane E — the tenancy harness (spec `docs/internal/web-phase3-tenancy-spec.md` §6, row T3).
 *
 * One table and one loop, not 52 hand-written tests. Tenant A seeds a real row of every kind the
 * router's `:params` name; tenant B then calls **every by-id route** with A's ids and must be told
 * the thing does not exist. A 404 is the only acceptable answer: a 200 is a leak, a 500 says a
 * handler fell over rather than refused, and a 403 would confirm the id exists to someone who may
 * not see it.
 *
 * Three assertions per route, because "it 404'd" is the weakest of the three:
 *   1. status 404;
 *   2. the body is an error envelope and nothing else — no partial record beside it;
 *   3. **no byte of A's record appears in the response.** Every seeded row carries `LEAK_MARKER` in
 *      its text fields, and the whole serialised result is searched for it. That is what catches a
 *      200 leaking A's data through a nested object, which assertion 1 alone never would.
 *
 * And one assertion about the table itself: `routeRegistrations()` (`./router.ts`) is read back and
 * every by-id route in it must appear here. A by-id route added without a tenancy test fails this
 * suite instead of shipping unnoticed — which is the point of the harness outliving the lane.
 *
 * What this proves and what it does not: it proves the **refusal**, on a real database, through
 * `dispatch` with two provisioned tenants. It is not a driven app. The phase's own "done when" —
 * two tenants on a running server — still needs a deploy (`docs/internal/web-phase3-lane-e.md` §6).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-tenancy-harness-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
// Deliberately high-variety: `getLocalVaultKey` has a variety floor, so a key of one repeated
// character is refused. 32 bytes of distinct-looking hex clears it and clears any later tightening.
process.env.AGENTFORGE_SECRETS_KEY = "3f8a1c05d97e26b4084fa3c1e5d7290b6c48af13e02d95b7ca6318fd4e7092a5";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;

import type { TenantContext } from "@agentforge/core";
import { dispatch, isByIdRoute, routeRegistrations } from "./router";
import { createSession } from "./auth/session";
import { createMemorySessionStore } from "./auth/session-store";
import type {
  HostBytesResult,
  HostFile,
  HostJsonResult,
  HostRequest,
  HostResult,
  HostStreamResult,
} from "./types";

const T0 = Date.UTC(2026, 8, 20, 9, 0, 0);

/**
 * Planted in every text field of every row tenant A seeds. Nothing else in the tree contains it, so
 * finding it anywhere in tenant B's response is unambiguous: B was handed A's data.
 */
const LEAK_MARKER = "TENANT-A-SECRET-MARKER-9f2c";

const IDENTITY_A = { tenantId: "harness-tenant-a", orgId: "harness-org-a", userId: "harness-user-a" };
const IDENTITY_B = { tenantId: "harness-tenant-b", orgId: "harness-org-b", userId: "harness-user-b" };

/**
 * The by-id surface, one entry per registration in `./router.ts`.
 *
 * `params` maps each `:param` in the path to the seeded id of tenant A's row. A route whose
 * `params` are all `"unseeded"` is one whose resource kind has no seed yet — it is still called,
 * still expected to 404, and still counted, but it proves only that a *non-existent* id is refused
 * rather than that another tenant's *existing* id is. Those are listed in the lane doc.
 *
 * `body` is sent on the mutating routes that validate a body before they look the resource up: an
 * empty body would 400 before the ownership check ran, which would make the 404 assertion vacuous.
 */
type SeedKey = keyof Seeds | "unseeded";

/**
 * What a correct refusal looks like on this route.
 *
 * `"not_found"` is the default and what the spec asks for: status 404.
 *
 * `"indistinguishable"` is for the handful of routes whose safe answer is *not* a 404, and it is
 * not a weaker assertion — it is a different one. The property that actually matters is that tenant
 * B cannot tell A's id apart from an id that never existed, and that A's row is untouched. Every
 * route is held to that (see `ghost` below); these few are held to that **alone**, because a 404
 * would be the wrong answer for them. Each one states why, in `why`, and each `why` is a claim
 * about the handler that was read, not a shrug.
 */
type Refusal = "not_found" | "indistinguishable";

type ByIdRoute = {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, SeedKey>>;
  readonly body?: unknown;
  /**
   * Multipart routes. Sent on the ones that refuse a request with no file *before* they look the
   * resource up — without it the call 400s on the missing file and the refusal under test never
   * runs. Resolved lazily in `requestFor`, because a `.docx` fixture is read off disk.
   */
  readonly files?: () => HostFile[];
  readonly refusal?: Refusal;
  /** Required when `refusal` is `"indistinguishable"`: what the handler does instead, and why. */
  readonly why?: string;
  /** Set when the route's `:param` names something that is not tenant data. Explained inline. */
  readonly notTenantData?: string;
};

type Seeds = {
  projectId: string;
  cardId: string;
  jobId: string;
  itemId: string;
  exportJobId: string;
  workspaceId: string;
  threadId: string;
  mediaId: string;
  datasetId: string;
  matterId: string;
  docId: string;
  runId: string;
  artifactId: string;
  memoryId: string;
  sourceId: string;
  agentId: string;
  channelId: string;
  meetingId: string;
};

const BY_ID_ROUTES: readonly ByIdRoute[] = [
  // --- edit ---------------------------------------------------------------------------------
  { method: "GET", path: "/api/v1/edit/projects/:projectId", params: { projectId: "projectId" } },
  {
    method: "POST",
    path: "/api/v1/edit/projects/:projectId/ops",
    params: { projectId: "projectId" },
    body: { ops: [] },
  },
  { method: "POST", path: "/api/v1/edit/projects/:projectId/undo", params: { projectId: "projectId" }, body: {} },
  {
    method: "POST",
    path: "/api/v1/edit/projects/:projectId/cards/:cardId/keep",
    params: { projectId: "projectId", cardId: "cardId" },
    body: {},
  },
  { method: "POST", path: "/api/v1/edit/projects/:projectId/import", params: { projectId: "projectId" }, body: {} },
  { method: "POST", path: "/api/v1/edit/projects/:projectId/generate", params: { projectId: "projectId" }, body: {} },
  {
    method: "POST",
    path: "/api/v1/edit/projects/:projectId/agent",
    params: { projectId: "projectId" },
    body: {},
    refusal: "indistinguishable",
    why:
      "The handler opens an SSE stream and returns `status: 200` before the work begins " +
      "(handlers/edit.ts handlePostEditAgent). The desk check is `foldProject(projectId, " +
      "tenant.workspaceId)` inside the run (edit/agent-run.ts, first statement of the worker), so " +
      "the refusal arrives as a frame rather than as a status. Nothing of the project is read " +
      "before it, and a project that does not exist takes exactly the same path.",
  },
  { method: "GET", path: "/api/v1/edit/projects/:projectId/events", params: { projectId: "projectId" } },
  { method: "POST", path: "/api/v1/edit/projects/:projectId/jobs", params: { projectId: "projectId" }, body: {} },
  {
    method: "GET",
    path: "/api/v1/edit/projects/:projectId/jobs/:jobId",
    params: { projectId: "projectId", jobId: "jobId" },
  },
  {
    method: "POST",
    path: "/api/v1/edit/projects/:projectId/jobs/:jobId/cancel",
    params: { projectId: "projectId", jobId: "jobId" },
    body: {},
  },
  { method: "POST", path: "/api/v1/edit/projects/:projectId/export", params: { projectId: "projectId" }, body: {} },
  {
    method: "GET",
    path: "/api/v1/edit/projects/:projectId/export/:jobId/file",
    params: { projectId: "projectId", jobId: "exportJobId" },
  },
  {
    method: "POST",
    path: "/api/v1/edit/projects/:projectId/unplaced/:itemId/place",
    params: { projectId: "projectId", itemId: "itemId" },
    body: {},
  },
  {
    method: "POST",
    path: "/api/v1/edit/projects/:projectId/unplaced/:itemId/discard",
    params: { projectId: "projectId", itemId: "itemId" },
    body: {},
  },
  { method: "POST", path: "/api/v1/edit/projects/:projectId/parity", params: { projectId: "projectId" }, body: {} },

  // --- workspaces (desks) -------------------------------------------------------------------
  { method: "POST", path: "/api/v1/workspaces/:workspaceId/select", params: { workspaceId: "workspaceId" }, body: {} },
  { method: "PATCH", path: "/api/v1/workspaces/:workspaceId", params: { workspaceId: "workspaceId" }, body: {} },
  {
    method: "DELETE",
    path: "/api/v1/workspaces/:workspaceId",
    params: { workspaceId: "workspaceId" },
    body: { confirmName: LEAK_MARKER },
  },
  { method: "GET", path: "/api/v1/workspaces/:workspaceId/agents", params: { workspaceId: "workspaceId" } },
  {
    method: "POST",
    path: "/api/v1/workspaces/:workspaceId/agents",
    params: { workspaceId: "workspaceId" },
    body: { name: "b" },
  },

  // --- threads and runs ---------------------------------------------------------------------
  { method: "GET", path: "/api/v1/threads/:threadId", params: { threadId: "threadId" } },
  { method: "DELETE", path: "/api/v1/threads/:threadId", params: { threadId: "threadId" } },
  {
    method: "POST",
    path: "/api/v1/threads/:threadId/runs/text",
    params: { threadId: "threadId" },
    body: { content: "hello" },
  },
  {
    method: "POST",
    path: "/api/v1/threads/:threadId/runs/image",
    params: { threadId: "threadId" },
    // The image route needs at least one `image_url` part before it will look at the thread
    // (core parseImageRunInput); a data URI keeps it off the network.
    body: {
      content: [
        { type: "text", text: "hello" },
        { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
      ],
    },
  },
  {
    method: "POST",
    path: "/api/v1/threads/:threadId/runs/video",
    params: { threadId: "threadId" },
    body: {
      content: [
        { type: "text", text: "hello" },
        { type: "video_url", video_url: { url: "data:video/mp4;base64,AAAA" } },
      ],
    },
  },

  // --- media ---------------------------------------------------------------------------------
  { method: "GET", path: "/api/v1/media/:mediaId/file", params: { mediaId: "mediaId" } },
  {
    method: "GET",
    path: "/api/v1/videos/examples/:name/file",
    params: { name: "unseeded" },
    notTenantData:
      "The example reel shipped with the build. `listVideoExamples()` (./video-examples.ts) takes no " +
      "tenant and reads a directory beside the binary, so there is no owner to be foreign to. The " +
      "route is still called with a name no example has, and must still 404.",
  },

  // --- datasets --------------------------------------------------------------------------------
  { method: "GET", path: "/api/v1/datasets/:datasetId", params: { datasetId: "datasetId" } },
  { method: "DELETE", path: "/api/v1/datasets/:datasetId", params: { datasetId: "datasetId" } },

  // --- legal -----------------------------------------------------------------------------------
  { method: "GET", path: "/api/v1/legal/matters/:matterId", params: { matterId: "matterId" } },
  {
    method: "PATCH",
    path: "/api/v1/legal/matters/:matterId",
    params: { matterId: "matterId" },
    // A body the schema accepts, so the call reaches the ownership check rather than 400ing on
    // `nothing to update` — a 400 there would make the refusal assertion vacuous.
    body: { title: "tenant B was here" },
  },
  { method: "DELETE", path: "/api/v1/legal/matters/:matterId", params: { matterId: "matterId" } },
  {
    method: "POST",
    path: "/api/v1/legal/matters/:matterId/files",
    params: { matterId: "matterId" },
    // A real .docx: the route refuses a fileless request with a 400 before it looks the matter up,
    // so without one the refusal under test would never run.
    files: () => [docxFixture()],
  },
  {
    method: "DELETE",
    path: "/api/v1/legal/matters/:matterId/files/:docId",
    params: { matterId: "matterId", docId: "docId" },
  },
  {
    method: "POST",
    path: "/api/v1/legal/matters/:matterId/run/stream",
    params: { matterId: "matterId" },
    body: {},
  },
  {
    method: "GET",
    path: "/api/v1/legal/matters/:matterId/runs/:runId",
    params: { matterId: "matterId", runId: "runId" },
  },

  // --- artifacts -------------------------------------------------------------------------------
  { method: "GET", path: "/api/v1/artifacts/:artifactId", params: { artifactId: "artifactId" } },
  { method: "DELETE", path: "/api/v1/artifacts/:artifactId", params: { artifactId: "artifactId" } },
  { method: "GET", path: "/api/v1/artifacts/:artifactId/file", params: { artifactId: "artifactId" } },

  // --- knowledge -------------------------------------------------------------------------------
  {
    method: "DELETE",
    path: "/api/v1/knowledge/memories/:memoryId",
    params: { memoryId: "memoryId" },
    refusal: "indistinguishable",
    why:
      "`deleteMemory` (knowledge.ts) is `DELETE ... WHERE workspace_id = ? AND id = ?` and returns " +
      "nothing, so the handler answers `{ ok: true }` whether or not a row matched. A delete that " +
      "is a silent no-op discloses less than a 404 does, not more — the 404 would confirm to a " +
      "prober which ids exist. The survivor check below is what proves A's row is still there.",
  },
  {
    method: "POST",
    path: "/api/v1/knowledge/sources/:sourceId/reindex",
    params: { sourceId: "sourceId" },
    body: {},
  },
  {
    method: "DELETE",
    path: "/api/v1/knowledge/sources/:sourceId",
    params: { sourceId: "sourceId" },
    refusal: "indistinguishable",
    why: "Same as the memory delete: `deleteSource` is workspace-scoped and the handler ignores its boolean.",
  },

  // --- agents ----------------------------------------------------------------------------------
  { method: "GET", path: "/api/v1/agents/:agentId", params: { agentId: "agentId" } },
  { method: "GET", path: "/api/v1/agents/:agentId/capabilities", params: { agentId: "agentId" } },
  {
    method: "GET",
    path: "/api/v1/agents/:agentId/threads",
    params: { agentId: "agentId" },
    refusal: "indistinguishable",
    why:
      "`listThreads(tenant, agentId)` filters on organisation, agent and user, so a foreign agent " +
      "id selects nothing and the route answers 200 with an empty list — the same answer an agent " +
      "id nobody owns gets. Its siblings 404 first because they look the agent up; this one does " +
      "not need to, and making it would add a query to tell a prober something.",
  },
  {
    method: "POST",
    path: "/api/v1/agents/:agentId/tools",
    params: { agentId: "agentId" },
    // A registered tool key, so the call gets past the handler's own "Tool not found" and reaches
    // the agent lookup (`listVersions(tenant.organizationId, agentId)`), which is the check under
    // test. With an unknown key both calls 404 on the tool and the ownership check never runs.
    body: { toolKey: "calculator" },
  },
  { method: "POST", path: "/api/v1/agents/:agentId/soul", params: { agentId: "agentId" }, body: {} },
  { method: "POST", path: "/api/v1/agents/:agentId/publish", params: { agentId: "agentId" }, body: {} },
  { method: "POST", path: "/api/v1/agents/:agentId/share", params: { agentId: "agentId" }, body: {} },
  { method: "POST", path: "/api/v1/agents/:agentId/product-modes", params: { agentId: "agentId" }, body: {} },
  { method: "POST", path: "/api/v1/agents/:agentId/generate-defaults", params: { agentId: "agentId" }, body: {} },

  // --- channels (Telegram, PR #67) --------------------------------------------------------------
  { method: "GET", path: "/api/v1/channels/:channelId", params: { channelId: "channelId" } },
  { method: "DELETE", path: "/api/v1/channels/:channelId", params: { channelId: "channelId" } },
  { method: "GET", path: "/api/v1/channels/:channelId/messages", params: { channelId: "channelId" } },
  {
    method: "POST",
    path: "/api/v1/channels/:channelId/send",
    params: { channelId: "channelId" },
    // Sendable text, so the call reaches `requireChannel` rather than 400ing on an empty message.
    // It never reaches Telegram: the channel is refused first.
    body: { text: "tenant B was here" },
  },

  // --- meetings (PR #66) -------------------------------------------------------------------------
  { method: "GET", path: "/api/v1/meetings/:meetingId", params: { meetingId: "meetingId" } },
  { method: "DELETE", path: "/api/v1/meetings/:meetingId", params: { meetingId: "meetingId" } },
  {
    method: "POST",
    path: "/api/v1/meetings/:meetingId/recording",
    params: { meetingId: "meetingId" },
    files: () => [audioFixture()],
  },
  {
    method: "POST",
    path: "/api/v1/meetings/:meetingId/transcript",
    params: { meetingId: "meetingId" },
    body: { text: "tenant B was here" },
  },
  {
    method: "POST",
    path: "/api/v1/meetings/:meetingId/transcribe/stream",
    params: { meetingId: "meetingId" },
    body: {},
    refusal: "indistinguishable",
    why:
      "`streamJob` answers 200 and opens the SSE stream before the work starts, so the refusal " +
      "arrives as a frame rather than as a status. `requireMeeting(tenant, meetingId)` is the " +
      "first statement of the job (meeting/run.ts:152, :287, :362 — before the runtime gate, so " +
      "this check is reached under the stub runtime too, and before anything of the meeting is " +
      "read), and a meeting that does not exist takes exactly the same path. Same shape as " +
      "POST /api/v1/edit/projects/:projectId/agent above.",
  },
  {
    method: "POST",
    path: "/api/v1/meetings/:meetingId/minutes/stream",
    params: { meetingId: "meetingId" },
    body: {},
    refusal: "indistinguishable",
    why:
      "`streamJob` answers 200 and opens the SSE stream before the work starts, so the refusal " +
      "arrives as a frame rather than as a status. `requireMeeting(tenant, meetingId)` is the " +
      "first statement of the job (meeting/run.ts:152, :287, :362 — before the runtime gate, so " +
      "this check is reached under the stub runtime too, and before anything of the meeting is " +
      "read), and a meeting that does not exist takes exactly the same path. Same shape as " +
      "POST /api/v1/edit/projects/:projectId/agent above.",
  },
  {
    method: "POST",
    path: "/api/v1/meetings/:meetingId/run/stream",
    params: { meetingId: "meetingId" },
    body: {},
    refusal: "indistinguishable",
    why:
      "`streamJob` answers 200 and opens the SSE stream before the work starts, so the refusal " +
      "arrives as a frame rather than as a status. `requireMeeting(tenant, meetingId)` is the " +
      "first statement of the job (meeting/run.ts:152, :287, :362 — before the runtime gate, so " +
      "this check is reached under the stub runtime too, and before anything of the meeting is " +
      "read), and a meeting that does not exist takes exactly the same path. Same shape as " +
      "POST /api/v1/edit/projects/:projectId/agent above.",
  },
];

let store: ReturnType<typeof createMemorySessionStore>;
let sessionA: ReturnType<typeof createSession>;
let sessionB: ReturnType<typeof createSession>;
let tenantA: TenantContext;
let seeds: Seeds;

/**
 * One real row of every kind, owned by tenant A, each carrying `LEAK_MARKER` wherever it has a text
 * field to carry it in.
 *
 * Seeded through the store functions the handlers themselves call, not through raw SQL, so a row
 * here is a row the app would have written — the same `workspace_id`, the same sealed body, the same
 * file on disk. Three kinds are direct inserts and say why inline: the edit sub-resources exist only
 * as the output of a running job, and starting one would mean a worker, ffmpeg and a model call.
 *
 * Tenant B is provisioned but seeded with nothing. It needs no data to ask for A's.
 */
/** Names the seed that threw. A bare `FOREIGN KEY constraint failed` says nothing about which row. */
async function step<T>(label: string, run: () => Promise<T> | T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new Error(`seed "${label}" failed: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

async function seedTenantA(): Promise<Seeds> {
  const { db, createLocalWorkspace, editCards, editJobs, editUnplaced, ensurePortalOwner, resolvePortalTenant } =
    await import("@agentforge/db");

  await ensurePortalOwner(db, IDENTITY_A);
  await ensurePortalOwner(db, IDENTITY_B);

  const resolvedA = await resolvePortalTenant(db, IDENTITY_A);
  if (!resolvedA.ok) {
    throw new Error(`tenant A did not resolve: ${resolvedA.code}`);
  }
  tenantA = resolvedA.tenant;

  store = createMemorySessionStore();
  sessionA = createSession({ ...IDENTITY_A, now: T0 });
  sessionB = createSession({ ...IDENTITY_B, now: T0 });
  await store.create(sessionA);
  await store.create(sessionB);

  const { createEditProject } = await import("./edit/projects");
  const { createThread } = await import("./threads");
  const { agentService } = await import("./tenant");
  const { artifactStore } = await import("./artifacts");
  const { datasetStore } = await import("./datasets");
  const { legalStore } = await import("./legal/store");
  const { addMemory, addPastedSource } = await import("./knowledge");
  const { channelStore } = await import("./channels/store");
  const { meetingStore } = await import("./meeting/store");
  const { saveMedia } = await import("./media");
  const { listChatModels } = await import("@agentforge/core");

  // A second desk of tenant A's, so `/workspaces/:workspaceId/*` is asked about a desk that really
  // exists and really belongs to somebody else — not merely about an id nothing matches.
  const desk = await step("desk", () =>
    createLocalWorkspace(db, tenantA.organizationId, LEAK_MARKER, undefined, undefined, tenantA.userId),
  );

  const project = await step("edit project", () =>
    createEditProject(tenantA, { name: LEAK_MARKER, aspect: "16:9", fps: 30 }),
  );

  // Direct inserts: `enqueueEditJob` starts the job runner, and a card and an unplaced item are
  // written by a job that has already produced output. The rows are the shape those paths write.
  const [job] = await db
    .insert(editJobs)
    .values({
      projectId: project.id,
      kind: "generate_image",
      status: "queued",
      targetClipIdsJson: [],
      requestJson: { prompt: LEAK_MARKER },
      progress: 0,
    })
    .returning();
  const [exportJob] = await db
    .insert(editJobs)
    .values({
      projectId: project.id,
      kind: "render",
      status: "succeeded",
      targetClipIdsJson: [],
      requestJson: { name: LEAK_MARKER },
      progress: 1,
    })
    .returning();
  const [card] = await db
    .insert(editCards)
    .values({
      projectId: project.id,
      runId: crypto.randomUUID(),
      toolKey: "edit.generate",
      verb: "generate",
      object: LEAK_MARKER,
      opIdsJson: [],
      status: "pending",
      thumbsJson: [],
    })
    .returning();
  const [unplaced] = await db
    .insert(editUnplaced)
    .values({ projectId: project.id, jobId: job.id, assetId: crypto.randomUUID(), prompt: LEAK_MARKER })
    .returning();

  // The static catalogue, passed explicitly: `defaultSelectableModel()` reads the settings slice,
  // which is a dependency this harness has no reason to take on.
  const models = listChatModels();
  const agent = await agentService.create(
    tenantA,
    { name: LEAK_MARKER, systemPrompt: LEAK_MARKER, model: models[0].id },
    models,
  );
  const thread = await step("thread", () => createThread(tenantA, agent.agent.id, LEAK_MARKER));

  const artifact = artifactStore().create(tenantA, {
    mode: "documents",
    kind: "draft",
    title: LEAK_MARKER,
    mime: "text/markdown",
    body: `# ${LEAK_MARKER}`,
  });

  const dataset = datasetStore().create(tenantA, {
    name: LEAK_MARKER,
    filename: "harness.csv",
    bytes: new TextEncoder().encode(`name,note\nrow,${LEAK_MARKER}\n`),
  });

  const matter = legalStore().create(tenantA, {
    title: LEAK_MARKER,
    side: { role: "borrower", party: LEAK_MARKER, counterparty: "the Lenders" },
    workType: "review",
    deliverables: ["issues-memo"],
    instructions: LEAK_MARKER,
  });
  const runId = crypto.randomUUID();
  legalStore().saveRun(tenantA, matter.id, {
    id: runId,
    matterId: matter.id,
    startedAt: T0,
    finishedAt: T0,
    manifest: { note: LEAK_MARKER } as never,
    findings: [],
    verify: null,
    artifacts: [],
    error: null,
  });

  const memory = await step("memory", () => addMemory(tenantA, LEAK_MARKER));
  const source = await step("knowledge source", () =>
    addPastedSource(tenantA, LEAK_MARKER, `${LEAK_MARKER} pasted body`),
  );

  // A 1×1 PNG. `saveMedia` keys on the declared mime and the size, so the bytes only have to be a
  // real file on disk for the `/file` route to have something to serve.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const channel = await step("channel", () =>
    channelStore().create(tenantA, {
      transport: "telegram",
      chatTarget: "@tenant-a-harness",
      chatId: "-1001234567890",
      title: LEAK_MARKER,
      chatType: "channel",
    }),
  );
  const meeting = await step("meeting", () => meetingStore().create(tenantA, { title: LEAK_MARKER, locale: "en" }));

  const mediaRow = await step("media", () =>
    saveMedia(tenantA, new File([png], `${LEAK_MARKER}.png`, { type: "image/png" })),
  );

  return {
    projectId: project.id,
    cardId: card.id,
    jobId: job.id,
    itemId: unplaced.id,
    exportJobId: exportJob.id,
    workspaceId: desk.id,
    threadId: thread.id,
    mediaId: mediaRow.id,
    datasetId: dataset.id,
    matterId: matter.id,
    // No seed of its own. `addFile` assigns document ids sequentially inside a matter, so a real
    // `:docId` would have to be created through tenant A's matter — and the only route that takes
    // one, `DELETE …/files/:docId`, refuses on the `:matterId` first (handlers/legal.ts
    // handleDeleteLegalMatterFile → removeFile, which loads the matter before reading its docs).
    // So the `:matterId` in that path is tenant A's real matter and carries the refusal.
    docId: "S1",
    runId,
    artifactId: artifact.id,
    memoryId: memory.id,
    sourceId: source.id,
    agentId: agent.agent.id,
    channelId: channel.id,
    meetingId: meeting.id,
  };
}

/** An id no row has. Used for a `:param` whose kind has no seed yet. */
const UNSEEDED_ID = "00000000-0000-4000-8000-000000000000";

/** A real .docx, so the Legal file route gets past its own "attach a file" 400. */
function docxFixture(): HostFile {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = join(here, "../../core/src/docx/fixtures/original-term-sheet.docx");
  return {
    field: "file",
    filename: "harness.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: new Uint8Array(readFileSync(file)),
  };
}

/**
 * Bytes for the meeting recording route. `addRecording` looks the meeting up **before** it checks
 * the file (`meeting/store.ts` addRecording), so the content only has to exist.
 */
function audioFixture(): HostFile {
  return { field: "file", filename: "harness.m4a", mime: "audio/mp4", bytes: new Uint8Array(1024) };
}

/**
 * `mode: "foreign"` fills the path with tenant A's real ids — the call under test.
 * `mode: "ghost"` fills it with ids nothing has ever had — the control the foreign call is compared
 * against. If the two answers differ, tenant B can tell A's ids apart from ids that do not exist,
 * which is an existence oracle even when no field of the record comes back.
 */
function fillPath(route: ByIdRoute, mode: "foreign" | "ghost"): string {
  return route.path.replace(/:([A-Za-z]+)/g, (_, key: string) => {
    const seedKey = route.params[key];
    if (mode === "ghost" || !seedKey || seedKey === "unseeded") {
      return mode === "ghost" ? crypto.randomUUID() : UNSEEDED_ID;
    }
    return seeds[seedKey];
  });
}

function requestFor(route: ByIdRoute, sessionId: string, mode: "foreign" | "ghost" = "foreign"): HostRequest {
  return {
    method: route.method,
    path: fillPath(route, mode),
    query: {},
    params: {},
    headers: { cookie: `agentforge_session=${sessionId}` },
    body: route.body,
    files: route.files?.(),
  };
}

/** Everything a result carries, as one string, so a leak anywhere in it is one `includes` away. */
async function serialise(result: HostResult): Promise<string> {
  if (result.type === "json") {
    return JSON.stringify((result as HostJsonResult).body ?? null);
  }
  if (result.type === "bytes") {
    const bytes = (result as HostBytesResult).bytes;
    return `${(result as HostBytesResult).filename ?? ""}|${Buffer.from(bytes).toString("utf8")}`;
  }
  const chunks: string[] = [];
  for await (const event of (result as HostStreamResult).events) {
    chunks.push(event);
  }
  return chunks.join("");
}

async function callAsTenantB(
  route: ByIdRoute,
  mode: "foreign" | "ghost" = "foreign",
): Promise<{ result: HostResult; text: string }> {
  const result = await dispatch(requestFor(route, sessionB.id, mode), {
    serverMode: true,
    sessionStore: store,
    now: () => T0,
  });
  return { result, text: await serialise(result) };
}

/**
 * A response reduced to what a prober could learn from it, with the ids they already sent stripped
 * out. Two calls that reduce to the same string are two calls a prober cannot tell apart.
 *
 * UUIDs are blanked because a refusal may quote the id back ("Thread <id> not found"), and the id
 * came from the caller in the first place, so quoting it reveals nothing. Anything else that
 * differs between the two calls is a difference the caller did not already know.
 */
function shape(result: HostResult, text: string): string {
  const withoutIds = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
  return `${result.type} ${result.status} ${withoutIds}`;
}

describe("every by-id route refuses another tenant's id", () => {
  beforeAll(async () => {
    seeds = await seedTenantA();
  }, 120_000);

  afterAll(async () => {
    const { sql } = await import("@agentforge/db");
    sql.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("seeded a row of every kind the routes name", () => {
    for (const [kind, id] of Object.entries(seeds)) {
      expect(id, `${kind} was not seeded`).toBeTruthy();
    }
  });

  it.each(BY_ID_ROUTES.map((route) => [`${route.method} ${route.path}`, route] as const))(
    "%s",
    async (_label, route) => {
      const { result, text } = await callAsTenantB(route, "foreign");

      // 1. Nothing of tenant A's came back — the assertion a 200 leaking a nested object fails.
      expect(text, `${route.method} ${route.path} returned tenant A's data`).not.toContain(LEAK_MARKER);

      // 2. No existence oracle: A's real ids are answered exactly as ids that never existed are.
      const ghost = await callAsTenantB(route, "ghost");
      expect(
        shape(result, text),
        `${route.method} ${route.path} answers tenant A's id differently from an id nobody owns`,
      ).toBe(shape(ghost.result, ghost.text));

      // 3. The status the spec asks for, on every route that does not say otherwise in `why`.
      if ((route.refusal ?? "not_found") === "not_found") {
        expect(result.status, `${route.method} ${route.path} did not 404`).toBe(404);
        if (result.type === "json") {
          // An error envelope and nothing beside it: `{ error: { code, message } }`, no record.
          const body = result.body as { error?: { code?: string; message?: string } };
          expect(Object.keys(body ?? {})).toEqual(["error"]);
          expect(typeof body.error?.code).toBe("string");
        }
      } else {
        // A route excused from the 404 must say why, in the table, where the next reader will see it.
        expect(route.why, `${route.method} ${route.path} is marked indistinguishable with no reason`).toBeTruthy();
      }
    },
  );

  /**
   * The control, and it is not optional: every assertion above would also pass against a server
   * that answered 404 to everybody. These are tenant A reading its own rows through the same
   * `dispatch`, **after** tenant B has been through the whole table — so they are a survivor check
   * too. A delete that silently succeeded across the tenant boundary shows up here and nowhere else.
   */
  it.each([
    ["GET", "/api/v1/artifacts/:artifactId", "artifactId"],
    ["GET", "/api/v1/edit/projects/:projectId", "projectId"],
    ["GET", "/api/v1/threads/:threadId", "threadId"],
    ["GET", "/api/v1/datasets/:datasetId", "datasetId"],
    ["GET", "/api/v1/legal/matters/:matterId", "matterId"],
    ["GET", "/api/v1/agents/:agentId", "agentId"],
  ] as const)("tenant A still reads its own row on %s %s", async (method, path, seedKey) => {
    const result = await dispatch(
      {
        method,
        path: path.replace(/:[A-Za-z]+/, seeds[seedKey]),
        query: {},
        params: {},
        headers: { cookie: `agentforge_session=${sessionA.id}` },
      },
      { serverMode: true, sessionStore: store, now: () => T0 },
    );
    expect(result.status, `${method} ${path} did not answer tenant A`).toBe(200);
    expect(JSON.stringify((result as HostJsonResult).body)).toContain(LEAK_MARKER);
  });

  it("leaves tenant A's knowledge rows alone, though the deletes answered ok", async () => {
    // The two routes marked `indistinguishable` because they no-op rather than 404. A no-op that
    // was not scoped would have deleted A's rows and still answered `{ ok: true }` — this is the
    // only assertion that can tell those two apart.
    const { listMemories, listSources } = await import("./knowledge");
    expect(listMemories(tenantA).map((row) => row.id)).toContain(seeds.memoryId);
    expect(listSources(tenantA).map((row) => row.id)).toContain(seeds.sourceId);
  });

  it("covers every by-id route the router registers", () => {
    const registered = routeRegistrations()
      .filter(isByIdRoute)
      .map((route) => `${route.method} ${route.path}`);
    const covered = new Set(BY_ID_ROUTES.map((route) => `${route.method} ${route.path}`));

    const missing = registered.filter((key) => !covered.has(key));
    const stale = [...covered].filter((key) => !registered.includes(key));

    // The message is the point: whoever adds a by-id route reads this, not the diff.
    expect(missing, `by-id routes with no tenancy test — add them to BY_ID_ROUTES: ${missing.join(", ")}`).toEqual([]);
    expect(stale, `BY_ID_ROUTES names routes the router no longer has: ${stale.join(", ")}`).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "../define-tool";
import { getTool, resetToolRegistry } from "../registry";
import type { TenantContext } from "../../tenancy/types";
import { DEFAULT_TITLE_STYLE, emptyProject, type EditProject } from "../../edit/document";
import type { ApplyableOp } from "../../edit/ops";
import { editAgentBindings } from "./bindings";
import { setEditToolBackend, type EditToolBackend } from "./backend";
import { editToolRefusal } from "./refusals";
import { registerEditTools } from "./register";

const tenant: TenantContext = {
  tenantId: "local-tenant",
  organizationId: "org-1",
  workspaceId: "ws-1",
  userId: "user-1",
  role: "builder",
};

function fakeBackend(overrides: Partial<EditToolBackend> = {}): {
  backend: EditToolBackend;
  applied: ApplyableOp[][];
  jobs: unknown[];
} {
  const applied: ApplyableOp[][] = [];
  const jobs: unknown[] = [];
  const project: EditProject = emptyProject({ id: "p1", workspaceId: "ws-1", name: "Demo", aspect: "16:9" });
  const backend: EditToolBackend = {
    getProject: async () => project,
    listClips: async (_tenant, trackId) =>
      trackId ? project.clips.filter((clip) => clip.trackId === trackId) : project.clips,
    probeAsset: async () => ({ codec: "h264" }),
    listIngredients: async () => project.ingredients,
    detectSilence: async () => ({ ranges: [{ startFrame: 10, endFrame: 20 }] }),
    detectScenes: async () => ({ frames: [30, 60] }),
    asrAvailable: async () => false,
    reviewGateOpen: async () => false,
    applyAgentOps: async (_tenant, ops) => {
      applied.push(ops);
      return { ops, card: { id: "card-1" } };
    },
    startJob: async (_tenant, job) => {
      jobs.push(job);
      return { job: { id: "job-1", ...job } };
    },
    startGenerateJob: async (_tenant, job) => {
      jobs.push(job);
      return { job: { id: "job-1", ...job }, clips: [], estimateUsd: 0.04, card: { id: "card-1" } };
    },
    proposePlan: async (_tenant, plan) => ({ card: { id: "plan-1", ...plan } }),
    cancelJob: async (_tenant, jobId) => ({ id: jobId, status: "cancelled" }),
    ...overrides,
  };
  return { backend, applied, jobs };
}

function tool(key: string) {
  const found = getTool(key);
  if (!found) {
    throw new Error(`missing tool ${key}`);
  }
  return found;
}

describe("edit tools", () => {
  beforeEach(() => {
    setEditToolBackend(null);
    resetToolRegistry();
    registerEditTools();
  });

  it("registers Prep tools", () => {
    expect(getTool("get_project")?.key).toBe("get_project");
    expect(getTool("export")?.key).toBe("export");
    expect(getTool("delete_clips")?.description).toContain(
      "More than 3 clips requires `confirm: true` after the user agreed.",
    );
    expect(getTool("clear_timeline")?.description).toContain(
      "Only when the user explicitly asked to clear everything.",
    );
    expect(getTool("detect_silence")?.description).toContain("Read-only. Call `remove_silence` to act.");
  });

  it("refuses bulk delete and clear without confirm (G-03)", async () => {
    const { backend, applied } = fakeBackend();
    setEditToolBackend(backend);
    await expect(invokeTool(tool("delete_clips"), { clipIds: ["a", "b", "c", "d"] }, tenant)).resolves.toEqual({
      success: false,
      refused: "confirm_required",
      message: "More than 3 clips requires confirm: true",
    });
    await expect(invokeTool(tool("clear_timeline"), {}, tenant)).resolves.toMatchObject({
      success: false,
      refused: "confirm_required",
    });
    expect(applied).toHaveLength(0);
  });

  it("delegates confirmed mutations through applyAgentOps", async () => {
    const { backend, applied } = fakeBackend();
    setEditToolBackend(backend);
    const result = await invokeTool(tool("delete_clips"), { clipIds: ["a", "b", "c", "d"], confirm: true }, tenant);
    expect(result).toMatchObject({ card: { id: "card-1" } });
    expect(applied[0]?.map((op) => op.type)).toEqual(["delete_clip", "delete_clip", "delete_clip", "delete_clip"]);
  });

  it("refuses export when the review gate is closed (G-10)", async () => {
    const { backend, jobs } = fakeBackend({ reviewGateOpen: async () => false });
    setEditToolBackend(backend);
    await expect(invokeTool(tool("export"), { preset: "h264-1080p" }, tenant)).resolves.toEqual({
      success: false,
      refused: "review_required",
      message: "Export is blocked until the review gate passes",
    });
    expect(jobs).toHaveLength(0);
  });

  it("starts a render job when the review gate is open", async () => {
    const { backend, jobs } = fakeBackend({ reviewGateOpen: async () => true });
    setEditToolBackend(backend);
    const result = await invokeTool(tool("export"), { preset: "h264-720p" }, tenant);
    expect(result).toMatchObject({ success: true });
    expect(jobs[0]).toMatchObject({ kind: "render", request: { preset: "h264-720p" } });
  });

  it("refuses transcribe when ASR is unavailable", async () => {
    const { backend } = fakeBackend({ asrAvailable: async () => false });
    setEditToolBackend(backend);
    await expect(invokeTool(tool("transcribe"), { assetId: "asset-v" }, tenant)).resolves.toMatchObject({
      success: false,
      refused: "asr_unavailable",
    });
  });

  it("lands a title card from text alone", async () => {
    const { backend, applied } = fakeBackend();
    setEditToolBackend(backend);
    await invokeTool(tool("add_title"), { text: "Hello" }, tenant);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.[0]).toMatchObject({
      type: "add_clip",
      payload: { clip: { title: { text: "Hello" }, trackId: "v1", timelineStartFrame: 0, durationFrames: 90 } },
    });
  });

  it("rejects title styles outside the ASS subset (G-11)", async () => {
    const { backend } = fakeBackend();
    setEditToolBackend(backend);
    await expect(
      invokeTool(
        tool("add_title"),
        {
          text: "Hi",
          style: { ...DEFAULT_TITLE_STYLE, letterSpacing: 2 },
          startFrame: 0,
          durationFrames: 30,
        },
        tenant,
      ),
    ).rejects.toMatchObject({ code: "invalid_tool_args" });
  });

  it("uses a structured refusal shape including still_unsupported", () => {
    expect(editToolRefusal("still_unsupported")).toEqual({ success: false, refused: "still_unsupported" });
    expect(editToolRefusal("confirm_required", "need confirm").success).toBe(false);
  });

  it("binds every edit tool, including add_title, for a live turn", () => {
    const bindings = editAgentBindings("org-1");
    expect(bindings.length).toBeGreaterThan(0);
    expect(bindings.every((binding) => binding.enabled)).toBe(true);
    expect(bindings.some((binding) => binding.toolKey === "add_title")).toBe(true);
  });

  it("registers generate tools", () => {
    expect(getTool("generate_image")?.key).toBe("generate_image");
    expect(getTool("generate_video")?.key).toBe("generate_video");
    expect(getTool("regenerate_clip")?.key).toBe("regenerate_clip");
    expect(getTool("variations")?.key).toBe("variations");
    expect(getTool("extend_clip")?.key).toBe("extend_clip");
  });

  it("refuses generate_video stills on t2v-only models", async () => {
    const { backend, jobs } = fakeBackend();
    setEditToolBackend(backend);
    await expect(
      invokeTool(
        tool("generate_video"),
        { prompt: "still", imageUrl: "https://cdn.example/a.png", model: "mj_video" },
        tenant,
      ),
    ).resolves.toEqual({
      success: false,
      refused: "still_unsupported",
      message: "This model does not accept a still image",
    });
    expect(jobs).toHaveLength(0);
  });

  it("starts generate_image through startGenerateJob", async () => {
    const { backend, jobs } = fakeBackend();
    setEditToolBackend(backend);
    const result = await invokeTool(tool("generate_image"), { prompt: "a cat", aspect: "16:9", tier: "draft" }, tenant);
    expect(result).toMatchObject({ success: true, job: { kind: "generate_image" } });
    expect(jobs[0]).toMatchObject({ kind: "generate_image", prompt: "a cat" });
  });
});

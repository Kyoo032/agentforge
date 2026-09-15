import {
  ApiError,
  createRuntime,
  editStubAssistantCopy,
  encodeSse,
  getTool,
  hasLiveProvider,
  invokeToolGuarded,
  matchStubEditScenario,
  matchStubFillScenario,
  matchStubGenerateScenario,
  modeMessage,
  resolveRuntimeMode,
  stubEditCardCopy,
  withOutputLanguage,
  type RuntimeEvent,
  type TenantContext,
} from "@agentforge/core";
import { rememberJobUsage } from "../job-usage";
import { loadSettings } from "../settings-store";
import { localeForRun } from "../run-context";
import { ensureToolsRegistered } from "../register-tools";
import { withEditToolContext } from "./context";
import { foldProject } from "./ops";
import { getEditDoctor } from "./doctor";
import { encodeEditSse } from "./events";
import { createTurnBudget, chargeTurnBudget, estimateEditJobUsd } from "./budget";
import { hostEditBackend } from "./backend";
import { undoCard } from "./undo";
import { appendEditMetric } from "./metrics";

const MUTATING = new Set([
  "split_clip",
  "trim_clip",
  "move_clip",
  "delete_clips",
  "remove_silence",
  "split_at_scenes",
  "add_title",
  "add_caption",
  "reframe",
  "set_clip_volume",
  "clear_timeline",
]);

const GENERATION = new Set([
  "generate_image",
  "generate_video",
  "regenerate_clip",
  "variations",
  "extend_clip",
  "generate_storyboard",
  "animate_storyboard",
  "transcribe",
]);

class StringQueue {
  private items: string[] = [];
  private waiters: Array<(next: IteratorResult<string>) => void> = [];
  private closed = false;

  push(item: string): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as unknown as string, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    while (true) {
      if (this.items.length > 0) {
        yield this.items.shift() as string;
        continue;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<IteratorResult<string>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}

function ffmpegPromptLine(): string {
  const { ffmpeg } = getEditDoctor();
  if (ffmpeg.found) {
    return `ffmpeg ${ffmpeg.version ?? ""} is installed. Export and ffmpeg are free. Never call ffmpeg yourself.`;
  }
  const setup = ffmpeg.setup;
  return [
    `ffmpeg is NOT available on this ${setup?.platform ?? "machine"}: ${setup?.summary ?? "not found"}`,
    `If the owner asks for probe, cut, captions or export, or asks why video tools fail, tell them to run \`${setup?.installCommand ?? "install ffmpeg"}\` in a terminal, then press "Check again" in the Edit banner. No restart needed.`,
    "Do not queue ffmpeg jobs until it is installed.",
  ].join(" ");
}

function compactPrompt(doc: Awaited<ReturnType<typeof foldProject>>, budgetUsd: number): string {
  return [
    "You are the DPSBuddy Edit agent. Share one ops log with the owner. Every mutation is a card.",
    `Project ${doc.name} ${doc.width}x${doc.height} @${doc.fps}fps seq=${doc.seq} review=${JSON.stringify(doc.review)}`,
    `Tracks: ${doc.tracks.map((track) => `${track.id}:${track.kind}`).join(", ")}`,
    `Clips: ${doc.clips.map((clip) => `${clip.id}@${clip.trackId}:${clip.timelineStartFrame}+${clip.durationFrames}`).join("; ") || "(none)"}`,
    `Ingredients: ${doc.ingredients.map((item) => item.name).join(", ") || "(none)"}`,
    `Turn cap USD: ${budgetUsd}. ${ffmpegPromptLine()}`,
    "clear_timeline requires an explicit user ask AND confirm:true.",
  ].join("\n");
}

function firstClipId(doc: Awaited<ReturnType<typeof foldProject>>): string | undefined {
  return doc.clips.find((clip) => doc.tracks.find((track) => track.id === clip.trackId)?.kind === "video")?.id
    ?? doc.clips[0]?.id;
}

function firstAssetId(doc: Awaited<ReturnType<typeof foldProject>>): string | undefined {
  return Object.keys(doc.assets)[0];
}

export async function runEditAgent(input: {
  tenant: TenantContext;
  projectId: string;
  text: string;
  abortSignal?: AbortSignal;
}): Promise<AsyncIterable<string>> {
  const queue = new StringQueue();
  const runId = crypto.randomUUID();
  const settings = loadSettings(input.tenant.workspaceId);
  ensureToolsRegistered();
  const budget = createTurnBudget({ capUsd: settings.editTurnCapUsd });
  const stub = resolveRuntimeMode({
    settingsHasKey: hasLiveProvider(settings),
    envRuntime: process.env.AGENTFORGE_RUNTIME,
  }) === "stub";

  void (async () => {
    try {
      await withEditToolContext({ tenant: input.tenant, projectId: input.projectId, runId }, async () => {
        const doc = await foldProject(input.projectId, input.tenant.workspaceId);
        queue.push(encodeSse({ type: "run.started", runId }));
        if (stub) {
          await runStub(input, doc, runId, budget, queue);
        } else {
          const runtime = createRuntime(settings);
          await runtime.execute({
            tenant: input.tenant,
            runId,
            modality: "text",
            version: {
              id: "edit",
              agentId: "edit",
              organizationId: input.tenant.organizationId,
              version: 1,
              systemPrompt: withOutputLanguage(compactPrompt(doc, budget.turnBudget), "edit", localeForRun()),
              model: "edit",
              inputModalities: ["text"],
              config: {},
              createdAt: new Date(),
            },
            bindings: [],
            history: [{ role: "user", parts: [{ type: "text", text: input.text }] }],
            onEvent: async (event: RuntimeEvent) => {
              queue.push(encodeSse(event));
              if (event.type === "run.completed") {
                rememberJobUsage(event);
              }
            },
          });
        }
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : modeMessage("editAgentFailed", localeForRun());
      queue.push(encodeSse({ type: "run.failed", message }));
    } finally {
      queue.close();
    }
  })();

  return queue;
}

async function runStub(
  input: { tenant: TenantContext; projectId: string; text: string },
  doc: Awaited<ReturnType<typeof foldProject>>,
  runId: string,
  budget: ReturnType<typeof createTurnBudget>,
  queue: StringQueue,
): Promise<void> {
  const scenario =
    matchStubEditScenario(input.text) ??
    matchStubFillScenario(input.text) ??
    matchStubGenerateScenario(input.text);
  if (!scenario) {
    queue.push(encodeSse({ type: "assistant.delta", text: editStubAssistantCopy(localeForRun()).help }));
    queue.push(encodeSse({ type: "run.completed", runId }));
    return;
  }
  if (scenario.toolKey === "__undo__") {
    queue.push(encodeSse({ type: "assistant.delta", text: editStubAssistantCopy(localeForRun()).undo }));
    queue.push(encodeSse({ type: "run.completed", runId }));
    return;
  }
  if (scenario.toolKey === "run_recipe") {
    const tool = getTool("run_recipe");
    const args = "buildArgs" in scenario ? scenario.buildArgs(input.text) : scenario.args;
    queue.push(encodeEditSse({ type: "tool.started", toolKey: "run_recipe", touching: [] }));
    const output = tool ? await invokeToolGuarded(tool, args, input.tenant) : { error: "missing_tool" };
    queue.push(encodeSse({ type: "tool.completed", toolKey: "run_recipe", output }));
    if (output && typeof output === "object" && "card" in output) {
      queue.push(encodeEditSse({ type: "edit.plan", card: (output as { card: unknown }).card }));
    }
    queue.push(encodeSse({ type: "run.completed", runId }));
    return;
  }
  if (scenario.id === "S9") {
    const tool = getTool("clear_timeline");
    const touching: string[] = [];
    queue.push(encodeEditSse({ type: "tool.started", toolKey: "clear_timeline", touching }));
    const output = tool
      ? await invokeToolGuarded(tool, scenario.args, input.tenant)
      : { success: false, refused: "confirm_required" };
    queue.push(encodeSse({ type: "tool.completed", toolKey: "clear_timeline", output }));
    queue.push(encodeSse({ type: "run.completed", runId }));
    return;
  }

  let mutatingCount = 0;
  if (MUTATING.has(scenario.toolKey)) {
    mutatingCount += 1;
  }
  if (mutatingCount > 3) {
    const plan = await hostEditBackend.proposePlan(input.tenant, {
      steps: [{ tool: scenario.toolKey, args: scenario.args }],
      totalUsd: 0,
    });
    queue.push(encodeEditSse({ type: "edit.plan", card: plan.card }));
    queue.push(encodeSse({ type: "run.completed", runId }));
    return;
  }
  if (GENERATION.has(scenario.toolKey)) {
    const seconds = typeof scenario.args.seconds === "number" ? scenario.args.seconds : 5;
    const count = typeof scenario.args.count === "number" ? scenario.args.count : 1;
    const model =
      typeof scenario.args.model === "string"
        ? scenario.args.model
        : scenario.toolKey === "generate_image"
          ? "gpt-image-2"
          : "grok-imagine-video";
    const estimate =
      scenario.toolKey === "transcribe" ? 0.02 : estimateEditJobUsd(model, { seconds, count });
    const charged = chargeTurnBudget(budget, estimate);
    if (!charged.ok) {
      queue.push(encodeSse({ type: "tool.completed", toolKey: scenario.toolKey, output: charged.refusal }));
      const plan = await hostEditBackend.proposePlan(input.tenant, {
        steps: [
          {
            tool: scenario.toolKey,
            args: "buildArgs" in scenario ? scenario.buildArgs(input.text) : scenario.args,
            estimateUsd: estimate ?? undefined,
          },
        ],
        totalUsd: estimate ?? 0,
      });
      queue.push(encodeEditSse({ type: "edit.plan", card: plan.card }));
      queue.push(encodeSse({ type: "run.completed", runId }));
      return;
    }
  }

  const args = "buildArgs" in scenario ? { ...scenario.buildArgs(input.text) } : { ...scenario.args };
  if (!args.clipId && firstClipId(doc)) {
    args.clipId = firstClipId(doc);
  }
  if (scenario.toolKey === "match_look" && firstClipId(doc)) {
    const clips = doc.clips.filter((clip) => clip.trackId === "v1");
    args.clipId = clips[0]?.id ?? firstClipId(doc);
    args.referenceClipId = clips[1]?.id ?? clips[0]?.id ?? args.referenceClipId;
  }
  if (scenario.toolKey === "propose_alt_cut") {
    args.clipIds = doc.clips.filter((clip) => clip.trackId === "v1").map((clip) => clip.id).slice(0, 4);
    if (!Array.isArray(args.clipIds) || args.clipIds.length === 0) {
      args.clipIds = ["stub-a"];
    }
  }
  if (scenario.toolKey === "animate_storyboard" && Array.isArray(args.clipIds)) {
    const stills = doc.clips
      .filter((clip) => {
        const assetId = clip.source?.assetId;
        return clip.trackId === "v1" && assetId && doc.assets[assetId]?.kind === "image";
      })
      .map((clip) => clip.id);
    if (stills.length > 0) {
      args.clipIds = stills;
    }
  }
  const ASSET_TOOLS = new Set(["transcribe", "detect_silence", "detect_scenes", "probe_asset"]);
  if (ASSET_TOOLS.has(scenario.toolKey) && !args.assetId && firstAssetId(doc)) {
    args.assetId = firstAssetId(doc);
  }
  if (scenario.toolKey === "add_title" && !args.style) {
    args.style = {
      fontFamily: "Inter",
      fontSizePx: 48,
      primaryColor: "#FFFFFFFF",
      outlineColor: "#000000FF",
      outlinePx: 2,
      shadowPx: 0,
      bold: false,
      italic: false,
      alignment: 8,
      marginL: 80,
      marginR: 80,
      marginV: 40,
    };
    args.startFrame = args.startFrame ?? 0;
    args.durationFrames = args.durationFrames ?? 90;
  }
  if (scenario.toolKey === "move_clip" && !args.trackId) {
    args.trackId = "v1";
  }
  const touching = typeof args.clipId === "string" ? [args.clipId] : [];
  queue.push(encodeEditSse({ type: "tool.started", toolKey: scenario.toolKey, touching }));
  const tool = getTool(scenario.toolKey);
  const output = tool ? await invokeToolGuarded(tool, args, input.tenant) : { error: "missing_tool" };
  queue.push(encodeSse({ type: "tool.completed", toolKey: scenario.toolKey, output }));
  if (output && typeof output === "object" && "ops" in output) {
    queue.push(encodeEditSse({ type: "edit.ops", ops: (output as { ops: unknown }).ops }));
  }
  if (output && typeof output === "object" && "card" in output) {
    queue.push(encodeEditSse({ type: "edit.card", card: (output as { card: unknown }).card }));
  }
  if (output && typeof output === "object" && "job" in output) {
    queue.push(encodeEditSse({ type: "edit.job", job: (output as { job: unknown }).job }));
  }
  if (output && typeof output === "object" && "jobs" in output && Array.isArray((output as { jobs: unknown }).jobs)) {
    for (const job of (output as { jobs: unknown[] }).jobs) {
      queue.push(encodeEditSse({ type: "edit.job", job }));
    }
  }
  const card = stubEditCardCopy(scenario, localeForRun());
  queue.push(encodeSse({ type: "assistant.delta", text: `${card.verb} · ${card.object}` }));
  const completed: RuntimeEvent = { type: "run.completed", runId };
  rememberJobUsage(completed);
  queue.push(encodeSse(completed));
  appendEditMetric({ projectId: input.projectId, runId, event: "agent.turn" });
}

export { undoCard };

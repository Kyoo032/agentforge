import {
  ApiError,
  createRuntime,
  encodeSse,
  getTool,
  hasLiveProvider,
  invokeToolGuarded,
  matchStubEditScenario,
  resolveRuntimeMode,
  type RuntimeEvent,
  type TenantContext,
} from "@agentforge/core";
import { rememberJobUsage } from "../job-usage";
import { loadSettings } from "../settings-store";
import { ensureToolsRegistered } from "../register-tools";
import { withEditToolContext } from "./context";
import { foldProject } from "./ops";
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

const GENERATION = new Set(["generate_image", "generate_video", "transcribe"]);

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

function compactPrompt(doc: Awaited<ReturnType<typeof foldProject>>, budgetUsd: number): string {
  return [
    "You are the Agentforge Edit agent. Share one ops log with the owner. Every mutation is a card.",
    `Project ${doc.name} ${doc.width}x${doc.height} @${doc.fps}fps seq=${doc.seq} review=${JSON.stringify(doc.review)}`,
    `Tracks: ${doc.tracks.map((track) => `${track.id}:${track.kind}`).join(", ")}`,
    `Clips: ${doc.clips.map((clip) => `${clip.id}@${clip.trackId}:${clip.timelineStartFrame}+${clip.durationFrames}`).join("; ") || "(none)"}`,
    `Ingredients: ${doc.ingredients.map((item) => item.name).join(", ") || "(none)"}`,
    `Turn cap USD: ${budgetUsd}. Export and ffmpeg are free. Never call ffmpeg yourself.`,
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
  const settings = loadSettings();
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
              systemPrompt: compactPrompt(doc, budget.turnBudget),
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
      const message = error instanceof ApiError ? error.message : "edit agent failed";
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
  const scenario = matchStubEditScenario(input.text);
  if (!scenario) {
    queue.push(encodeSse({ type: "assistant.delta", text: "I can help trim, split, caption, and title this timeline." }));
    queue.push(encodeSse({ type: "run.completed", runId }));
    return;
  }
  if (scenario.toolKey === "__undo__") {
    queue.push(encodeSse({ type: "assistant.delta", text: "Undo is available on the last card." }));
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
    const estimate = scenario.toolKey === "transcribe" ? 0.02 : estimateEditJobUsd("whisper-1", { seconds: 60 });
    const charged = chargeTurnBudget(budget, estimate);
    if (!charged.ok) {
      queue.push(encodeSse({ type: "tool.completed", toolKey: scenario.toolKey, output: charged.refusal }));
      const plan = await hostEditBackend.proposePlan(input.tenant, {
        steps: [{ tool: scenario.toolKey, args: scenario.args, estimateUsd: estimate ?? undefined }],
        totalUsd: estimate ?? 0,
      });
      queue.push(encodeEditSse({ type: "edit.plan", card: plan.card }));
      queue.push(encodeSse({ type: "run.completed", runId }));
      return;
    }
  }

  const args = { ...scenario.args };
  if (!args.clipId && firstClipId(doc)) {
    args.clipId = firstClipId(doc);
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
  queue.push(encodeSse({ type: "assistant.delta", text: `${scenario.cardVerb} · ${scenario.cardObject}` }));
  const completed: RuntimeEvent = { type: "run.completed", runId };
  rememberJobUsage(completed);
  queue.push(encodeSse(completed));
  appendEditMetric({ projectId: input.projectId, runId, event: "agent.turn" });
}

export { undoCard };

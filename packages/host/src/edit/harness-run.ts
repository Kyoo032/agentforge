import {
  editHarnessLine,
  encodeSse,
  extractMadeShot,
  extractPictureWords,
  framesInsideClip,
  getTool,
  harnessTargetClip,
  invokeToolGuarded,
  pictureWordsAreCaptions,
  planSceneFrames,
  planSilenceRanges,
  requireEditToolBackend,
  sceneProbeArgs,
  silenceProbeArgs,
  withOutputLanguage,
  wordsLanded,
  assetFramesToTimeline,
  type EditHarnessLineKey,
  type EditHarnessSkill,
  type EditProject,
  type SilenceRange,
  type TenantContext,
} from "@agentforge/core";
import { localeForRun } from "../run-context";
import { chargeTurnBudget, estimateEditJobUsd, type TurnBudget } from "./budget";
import { encodeEditSse } from "./events";
import { foldProject } from "./ops";

const PROBE_ATTEMPTS = 2;

type Push = (frame: string) => void;

function say(push: Push, key: EditHarnessLineKey): void {
  push(encodeSse({ type: "assistant.delta", text: editHarnessLine(key, localeForRun()) }));
}

function pushTool(push: Push, output: unknown): void {
  if (!output || typeof output !== "object") {
    return;
  }
  const record = output as Record<string, unknown>;
  if ("ops" in record) {
    push(encodeEditSse({ type: "edit.ops", ops: record.ops }));
  }
  if ("card" in record) {
    push(encodeEditSse({ type: "edit.card", card: record.card }));
  }
  if ("job" in record) {
    push(encodeEditSse({ type: "edit.job", job: record.job }));
  }
}

async function invoke(
  push: Push,
  tenant: TenantContext,
  toolKey: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const touching = typeof args.clipId === "string" ? [args.clipId] : [];
  push(encodeEditSse({ type: "tool.started", toolKey, touching }));
  const tool = getTool(toolKey);
  const output = tool ? await invokeToolGuarded(tool, args, tenant) : { error: "missing_tool" };
  push(encodeSse({ type: "tool.completed", toolKey, output }));
  pushTool(push, output);
  return output;
}

function jobAccepted(output: unknown): boolean {
  if (!output || typeof output !== "object") {
    return false;
  }
  const record = output as Record<string, unknown>;
  return (
    record.success === true && (record.job !== undefined || (Array.isArray(record.clips) && record.clips.length > 0))
  );
}

function spendRefusal(output: unknown): boolean {
  if (!output || typeof output !== "object") {
    return false;
  }
  const refused = (output as { refused?: string }).refused;
  return refused === "turn_cap_exceeded" || refused === "price_unknown";
}

async function probeSilence(
  stub: boolean,
  clip: NonNullable<ReturnType<typeof harnessTargetClip<EditProject["clips"][number]>>>,
  attempt: number,
  tenant: TenantContext,
): Promise<SilenceRange[]> {
  if (stub || !clip.source?.assetId) {
    return stub ? planSilenceRanges(clip, attempt) : [];
  }
  try {
    const probed = await requireEditToolBackend().detectSilence(tenant, {
      assetId: clip.source.assetId,
      ...silenceProbeArgs(attempt),
    });
    return assetFramesToTimeline(clip, probed.ranges);
  } catch {
    return [];
  }
}

async function probeScenes(
  stub: boolean,
  clip: NonNullable<ReturnType<typeof harnessTargetClip<EditProject["clips"][number]>>>,
  attempt: number,
  tenant: TenantContext,
): Promise<number[]> {
  if (stub || !clip.source?.assetId) {
    return stub ? planSceneFrames(clip, attempt) : [];
  }
  try {
    const probed = await requireEditToolBackend().detectScenes(tenant, {
      assetId: clip.source.assetId,
      ...sceneProbeArgs(attempt),
    });
    return framesInsideClip(clip, probed.frames);
  } catch {
    return [];
  }
}

async function liftDeadAir(input: RunInput): Promise<void> {
  const clip = harnessTargetClip(input.doc);
  if (!clip) {
    say(input.push, "liftDeadAirEmpty");
    return;
  }
  let ranges: SilenceRange[] = [];
  for (let attempt = 0; attempt < PROBE_ATTEMPTS && ranges.length === 0; attempt += 1) {
    ranges = await probeSilence(input.stub, clip, attempt, input.tenant);
  }
  if (ranges.length === 0) {
    say(input.push, "liftDeadAirEmpty");
    return;
  }
  await invoke(input.push, input.tenant, "remove_silence", { clipId: clip.id, ranges });
  say(input.push, "liftDeadAirRan");
}

async function cutOnShots(input: RunInput): Promise<void> {
  const clip = harnessTargetClip(input.doc);
  if (!clip) {
    say(input.push, "cutOnShotsEmpty");
    return;
  }
  let frames: number[] = [];
  for (let attempt = 0; attempt < PROBE_ATTEMPTS && frames.length === 0; attempt += 1) {
    frames = await probeScenes(input.stub, clip, attempt, input.tenant);
  }
  if (frames.length === 0) {
    say(input.push, "cutOnShotsEmpty");
    return;
  }
  await invoke(input.push, input.tenant, "split_at_scenes", { clipId: clip.id, frames });
  say(input.push, "cutOnShotsRan");
}

async function wordsOnPicture(input: RunInput): Promise<void> {
  const words = extractPictureWords(input.text);
  if (!words) {
    say(input.push, "wordsOnPictureEmpty");
    return;
  }
  const captions = pictureWordsAreCaptions(input.text);
  const toolKey = captions ? "add_caption" : "add_title";
  const args = captions ? { source: "script", text: words } : { text: words };
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    await invoke(input.push, input.tenant, toolKey, args);
    const folded = await foldProject(input.projectId, input.tenant.workspaceId);
    if (wordsLanded(folded.clips, words, captions ? "caption" : "title")) {
      say(input.push, "wordsOnPictureRan");
      return;
    }
  }
  say(input.push, "wordsOnPictureEmpty");
}

async function placeMadeShot(input: RunInput): Promise<void> {
  const shot = extractMadeShot(input.text);
  if (!shot) {
    say(input.push, "placeMadeShotEmpty");
    return;
  }
  const toolKey = shot.kind === "image" ? "generate_image" : "generate_video";
  const model = shot.kind === "image" ? "gpt-image-2" : "grok-imagine-video";
  const seconds = shot.kind === "video" ? 4 : undefined;
  const estimate = estimateEditJobUsd(model, { seconds, count: 1 });
  const charged = chargeTurnBudget(input.budget, estimate);
  const prompt = withOutputLanguage(shot.prompt, "edit", localeForRun());
  const args: Record<string, unknown> = { prompt, model, tier: "standard" };
  if (seconds !== undefined) {
    args.seconds = seconds;
  }
  if (!charged.ok) {
    const output = await invoke(input.push, input.tenant, "propose_plan", {
      steps: [{ tool: toolKey, args, estimateUsd: estimate ?? undefined }],
      totalUsd: estimate ?? 0,
    });
    if (output && typeof output === "object" && "card" in output) {
      input.push(encodeEditSse({ type: "edit.plan", card: (output as { card: unknown }).card }));
    }
    say(input.push, "placeMadeShotBlocked");
    return;
  }
  let output = await invoke(input.push, input.tenant, toolKey, args);
  if (!jobAccepted(output) && !spendRefusal(output)) {
    output = await invoke(input.push, input.tenant, toolKey, args);
  }
  if (spendRefusal(output)) {
    say(input.push, "placeMadeShotBlocked");
    return;
  }
  if (!jobAccepted(output)) {
    say(input.push, "placeMadeShotEmpty");
    return;
  }
  say(input.push, "placeMadeShotRan");
}

async function handBackFile(input: RunInput): Promise<void> {
  const open = await requireEditToolBackend().reviewGateOpen(input.projectId);
  if (!open) {
    say(input.push, "handBackFileBlocked");
    return;
  }
  const args = { preset: "h264-1080p" };
  let output: unknown;
  try {
    output = await invoke(input.push, input.tenant, "export", args);
  } catch {
    output = null;
  }
  if (!jobAccepted(output)) {
    try {
      output = await invoke(input.push, input.tenant, "export", args);
    } catch {
      output = null;
    }
  }
  if (!jobAccepted(output)) {
    say(input.push, "handBackFileFailed");
    return;
  }
  say(input.push, "handBackFileRan");
}

type RunInput = {
  tenant: TenantContext;
  projectId: string;
  text: string;
  skill: EditHarnessSkill;
  stub: boolean;
  budget: TurnBudget;
  doc: EditProject;
  push: Push;
};

const RUNNERS: Record<EditHarnessSkill, (input: RunInput) => Promise<void>> = {
  "lift-dead-air": liftDeadAir,
  "cut-on-shots": cutOnShots,
  "words-on-picture": wordsOnPicture,
  "place-made-shot": placeMadeShot,
  "hand-back-file": handBackFile,
};

export async function runEditHarness(input: RunInput): Promise<void> {
  await RUNNERS[input.skill](input);
}

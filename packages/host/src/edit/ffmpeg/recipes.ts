import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ApiError,
  buildAssDocument,
  framesToSeconds,
  secondsToFrames,
  type Asset,
  type EditProject,
} from "@agentforge/core";
import { mediaFilePath } from "../../media-root";
import { resolveFfmpeg } from "../ffmpeg-binary";
import {
  assertExistingInput,
  assertInsidePath,
  editAllowlist,
  editScratchRoot,
  escapeFilterPath,
  type EditScope,
} from "./paths";
import { runFfmpeg } from "./run";

export const RECIPE_KINDS = [
  "probe",
  "silenceDetect",
  "sceneDetect",
  "extractAudio",
  "thumbnail",
  "frameAt",
  "render",
] as const;

export type RecipeKind = (typeof RECIPE_KINDS)[number];

export function assertKnownRecipe(kind: string): asserts kind is RecipeKind {
  if (!(RECIPE_KINDS as readonly string[]).includes(kind)) {
    throw new ApiError("invalid_request", `unknown ffmpeg recipe: ${kind}`, 400);
  }
}

function timeoutForMedia(seconds: number): number {
  return Math.max(15_000, 2 * seconds * 1000 + 30_000);
}

export type ProbeResult = {
  durationSeconds: number;
  fps: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  codec?: string;
  sampleRate?: number;
};

export async function probe(filePath: string, scope: EditScope): Promise<ProbeResult> {
  const input = assertExistingInput(filePath, editAllowlist(scope));
  const { stdout } = await runFfmpeg(["-v", "error", "-print_format", "json", "-show_streams", "-show_format", input], {
    timeoutMs: 15_000,
    bin: "ffprobe",
  });
  const parsed = JSON.parse(stdout || "{}") as {
    streams?: Array<Record<string, unknown>>;
    format?: { duration?: string };
  };
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(parsed.format?.duration ?? video?.duration ?? 0);
  let fps = 30;
  const rate = typeof video?.avg_frame_rate === "string" ? video.avg_frame_rate : "30/1";
  const [num, den] = rate.split("/").map(Number);
  if (num && den) {
    fps = num / den;
  }
  return {
    durationSeconds: Number.isFinite(duration) ? duration : 0,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
    width: typeof video?.width === "number" ? video.width : undefined,
    height: typeof video?.height === "number" ? video.height : undefined,
    hasAudio: Boolean(audio),
    codec: typeof video?.codec_name === "string" ? video.codec_name : undefined,
    sampleRate: typeof audio?.sample_rate === "string" ? Number(audio.sample_rate) : undefined,
  };
}

export async function silenceDetect(
  filePath: string,
  scope: EditScope,
  fps: number,
  noiseDb = -30,
  minSeconds = 0.6,
): Promise<{ ranges: Array<{ startFrame: number; endFrame: number }> }> {
  const input = assertExistingInput(filePath, editAllowlist(scope));
  const probed = await probe(filePath, scope);
  const { stderr } = await runFfmpeg(
    ["-i", input, "-af", `silencedetect=noise=${noiseDb}dB:d=${minSeconds}`, "-f", "null", "-"],
    { timeoutMs: timeoutForMedia(probed.durationSeconds) },
  );
  const ranges: Array<{ startFrame: number; endFrame: number }> = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (startMatch) {
      start = Number(startMatch[1]);
    }
    if (endMatch && start != null) {
      ranges.push({
        startFrame: secondsToFrames(start, fps),
        endFrame: secondsToFrames(Number(endMatch[1]), fps),
      });
      start = null;
    }
  }
  return { ranges };
}

export async function sceneDetect(
  filePath: string,
  scope: EditScope,
  fps: number,
  threshold = 0.4,
): Promise<{ frames: number[] }> {
  const input = assertExistingInput(filePath, editAllowlist(scope));
  const probed = await probe(filePath, scope);
  let stderr = "";
  try {
    const result = await runFfmpeg(["-i", input, "-vf", `scdet=t=${threshold}`, "-f", "null", "-"], {
      timeoutMs: timeoutForMedia(probed.durationSeconds),
    });
    stderr = result.stderr;
  } catch {
    const result = await runFfmpeg(
      ["-i", input, "-vf", `select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"],
      { timeoutMs: timeoutForMedia(probed.durationSeconds) },
    );
    stderr = result.stderr;
  }
  const frames: number[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    const pts = line.match(/pts_time:([0-9.]+)/) ?? line.match(/t:([0-9.]+)/);
    if (pts) {
      frames.push(secondsToFrames(Number(pts[1]), fps));
    }
  }
  return { frames: [...new Set(frames)].sort((a, b) => a - b) };
}

export async function extractAudio(filePath: string, scope: EditScope): Promise<{ files: string[] }> {
  const allow = editAllowlist(scope);
  const input = assertExistingInput(filePath, allow);
  const scratch = editScratchRoot(scope);
  await mkdir(scratch, { recursive: true });
  const out = assertInsidePath(path.join(scratch, `audio-${crypto.randomUUID()}.mp3`), allow);
  await runFfmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", out], {
    timeoutMs: 120_000,
    outputPath: out,
  });
  return { files: [out] };
}

export async function thumbnail(
  filePath: string,
  scope: EditScope,
  frame: number,
  fps: number,
  width = 160,
): Promise<{ file: string }> {
  const allow = editAllowlist(scope);
  const input = assertExistingInput(filePath, allow);
  const scratch = editScratchRoot(scope);
  await mkdir(scratch, { recursive: true });
  const out = assertInsidePath(path.join(scratch, `thumb-${crypto.randomUUID()}.jpg`), allow);
  const t = framesToSeconds(frame, fps);
  await runFfmpeg(["-ss", String(t), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, out], {
    timeoutMs: 15_000,
    outputPath: out,
  });
  return { file: out };
}

function compileFilterGraph(doc: EditProject, assPath?: string): { filter: string; inputs: string[] } {
  const videoClips = doc.clips
    .filter((clip) => clip.source && doc.tracks.find((track) => track.id === clip.trackId)?.kind === "video")
    .sort((a, b) => a.timelineStartFrame - b.timelineStartFrame);
  const inputs: string[] = [];
  const parts: string[] = [];
  videoClips.forEach((clip, index) => {
    const asset = doc.assets[clip.source!.assetId];
    inputs.push(asset.storagePath);
    const dur = framesToSeconds(clip.durationFrames, doc.fps);
    parts.push(
      `[${index}:v]trim=start=${framesToSeconds(clip.source!.inFrame, asset.fps ?? doc.fps)}:duration=${dur},setpts=PTS-STARTPTS,scale=${doc.width}:${doc.height}:force_original_aspect_ratio=decrease,pad=${doc.width}:${doc.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[v${index}]`,
    );
  });
  if (videoClips.length === 0) {
    return { filter: `color=c=black:s=${doc.width}x${doc.height}:d=1[vout]`, inputs: [] };
  }
  const concatIn = videoClips.map((_, index) => `[v${index}]`).join("");
  let tail = `${concatIn}concat=n=${videoClips.length}:v=1:a=0[vcat]`;
  if (assPath) {
    tail += `;[vcat]ass=${escapeFilterPath(assPath)}[vout]`;
  } else {
    tail += `;[vcat]copy[vout]`;
  }
  return { filter: `${parts.join(";")};${tail}`, inputs };
}

export async function frameAt(
  tenantId: string,
  doc: EditProject,
  frame: number,
): Promise<{ file: string; bytes?: Buffer }> {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg.found) {
    throw new ApiError("ffmpeg_missing", "ffmpeg is not available on this machine", 400);
  }
  const allow = editAllowlist({ tenantId, projectId: doc.id });
  const scratch = editScratchRoot({ tenantId, projectId: doc.id });
  await mkdir(scratch, { recursive: true });
  // Through `assertInsidePath` like every other path here, and like `render` below already does.
  // `frame` is typed a number but arrives off a JSON body, so nothing before this point stops a
  // string from reaching `path.join` and walking out of the scratch root (finding A03-3).
  const assPath = assertInsidePath(path.join(scratch, `parity-${frame}.ass`), roots);
  await writeFile(assPath, buildAssDocument(doc), "utf8");
  const graph = compileFilterGraph(doc, assPath);
  const out = assertInsidePath(path.join(scratch, `frame-${frame}.png`), allow);
  const argv: string[] = [];
  for (const input of graph.inputs) {
    argv.push("-i", assertExistingInput(assetPath(tenantId, input), allow));
  }
  if (graph.inputs.length === 0) {
    argv.push("-f", "lavfi", "-i", `color=c=black:s=${doc.width}x${doc.height}:d=1`);
  }
  argv.push(
    "-filter_complex",
    graph.filter,
    "-map",
    "[vout]",
    "-ss",
    String(framesToSeconds(frame, doc.fps)),
    "-frames:v",
    "1",
    out,
  );
  await runFfmpeg(argv, { timeoutMs: 30_000, outputPath: out });
  return { file: out };
}

export async function render(
  tenantId: string,
  doc: EditProject,
  preset: "h264-1080p" | "h264-720p",
): Promise<{ file: string }> {
  const allow = editAllowlist({ tenantId, projectId: doc.id });
  const scratch = editScratchRoot({ tenantId, projectId: doc.id });
  await mkdir(scratch, { recursive: true });
  const assPath = assertInsidePath(path.join(scratch, `export-${crypto.randomUUID()}.ass`), allow);
  await writeFile(assPath, buildAssDocument(doc), "utf8");
  const graph = compileFilterGraph(doc, assPath);
  const out = assertInsidePath(path.join(scratch, `export-${crypto.randomUUID()}.mp4`), allow);
  const timelineSeconds =
    doc.clips.reduce((max, clip) => Math.max(max, clip.timelineStartFrame + clip.durationFrames), 0) / doc.fps;
  const argv: string[] = [];
  for (const input of graph.inputs) {
    argv.push("-i", assertExistingInput(assetPath(tenantId, input), allow));
  }
  if (graph.inputs.length === 0) {
    argv.push("-f", "lavfi", "-i", `color=c=black:s=${doc.width}x${doc.height}:d=1`);
  }
  argv.push(
    "-filter_complex",
    graph.filter,
    "-map",
    "[vout]",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    out,
  );
  void preset;
  await runFfmpeg(argv, { timeoutMs: Math.max(60_000, 10 * timelineSeconds * 1000 + 60_000), outputPath: out });
  return { file: out };
}

/**
 * A clip source as ffmpeg must see it. An absolute path is one the document already carries (the
 * starter media seeder writes one); anything relative is a `storage_path` and is resolved against
 * this tenant's media root, which refuses a path pointing outside it.
 */
function assetPath(tenantId: string, storagePath: string): string {
  return path.isAbsolute(storagePath) ? storagePath : mediaFilePath(tenantId, storagePath);
}

export function assetAbsPath(tenantId: string, asset: Asset): string {
  return assetPath(tenantId, asset.storagePath);
}

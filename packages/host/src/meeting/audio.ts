/**
 * Meeting mode — turning an uploaded recording into speech-grade audio chunks.
 *
 * Edit's `extractAudio` recipe does the same encode, but it resolves paths against Edit's project
 * allowlist (`edit/ffmpeg/paths.ts` `editAllowlist`), so it cannot read a file that lives
 * under the meeting store. The ffmpeg runner, the path guard and the probe below are the shared
 * ones; only the allowlist root differs.
 */

import { mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ApiError } from "@agentforge/core";
import { resolveFfmpeg } from "../edit/ffmpeg-binary";
import { assertExistingInput, assertInsidePath, type PathAllowlist } from "../edit/ffmpeg/paths";
import { runFfmpeg } from "../edit/ffmpeg/run";

/**
 * One chunk per ten minutes. Mono 16 kHz at 64 kbps is about 4.8 MB for that, which every
 * transcription route on the gateway accepts in one request, base64-inflated included.
 */
export const CHUNK_SECONDS = 600;
/** Guards against a pathological file producing hundreds of gateway calls: 6 hours of audio. */
export const MAX_CHUNKS = 36;

export type ExtractedAudio = {
  files: string[];
  durationSeconds: number;
  /** Offset of each chunk from the start, so transcript timings survive the split. */
  offsets: number[];
};

function timeoutForMedia(seconds: number): number {
  return Math.max(30_000, 2 * seconds * 1000 + 30_000);
}

export function ffmpegAvailable(): boolean {
  return resolveFfmpeg().found;
}

export async function probeDuration(filePath: string, allow: PathAllowlist): Promise<number> {
  const input = assertExistingInput(filePath, allow);
  const { stdout } = await runFfmpeg(["-v", "error", "-print_format", "json", "-show_format", input], {
    timeoutMs: 15_000,
    bin: "ffprobe",
  });
  const parsed = JSON.parse(stdout || "{}") as { format?: { duration?: string } };
  const duration = Number(parsed.format?.duration ?? 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * Decode whatever was uploaded — audio or video — into mono 16 kHz mp3 segments. Speech
 * recognition gains nothing from stereo or from a higher sample rate, and the smaller payload is
 * what keeps a long meeting inside one gateway request per chunk.
 */
export async function extractMeetingAudio(
  sourcePath: string,
  outDir: string,
  allow: PathAllowlist,
): Promise<ExtractedAudio> {
  if (!ffmpegAvailable()) {
    throw new ApiError(
      "ffmpeg_missing",
      "ffmpeg is needed to read a recording. Install it, or paste the transcript instead.",
      503,
    );
  }
  const input = assertExistingInput(sourcePath, allow);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const pattern = assertInsidePath(path.join(outDir, "chunk-%03d.mp3"), allow);
  const durationSeconds = await probeDuration(input, allow);
  await runFfmpeg(
    [
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "64k",
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_SECONDS),
      "-reset_timestamps",
      "1",
      pattern,
    ],
    { timeoutMs: timeoutForMedia(durationSeconds) },
  );
  if (!existsSync(outDir)) {
    throw new ApiError("ffmpeg_failed", "ffmpeg produced no audio from that recording", 502);
  }
  const files = (await readdir(outDir))
    .filter((name) => name.endsWith(".mp3"))
    .sort()
    .slice(0, MAX_CHUNKS)
    .map((name) => path.join(outDir, name));
  if (files.length === 0) {
    throw new ApiError("ffmpeg_failed", "That recording has no audio track", 400);
  }
  return {
    files,
    durationSeconds,
    offsets: files.map((_, index) => index * CHUNK_SECONDS),
  };
}

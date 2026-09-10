import { secondsToFrames } from "@agentforge/core";

/** How long an imported still image holds on the timeline by default. */
export const STILL_IMAGE_SECONDS = 5;

type Input = {
  kind: "image" | "video" | "audio";
  probedSeconds: number;
  probedFps: number | undefined;
  projectFps: number;
};

/**
 * Timeline length for a freshly imported asset. ffprobe reports a single
 * frame for a still image, which would vanish as soon as the playhead moves,
 * so images get a fixed hold at the project frame rate instead.
 */
export function importedClipDurationFrames({ kind, probedSeconds, probedFps, projectFps }: Input): number {
  if (kind === "image") {
    return Math.max(1, Math.round(projectFps * STILL_IMAGE_SECONDS));
  }
  return Math.max(1, secondsToFrames(probedSeconds || 1 / 30, probedFps || 30));
}

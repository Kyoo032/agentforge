export type Frame = number;

export function framesToSeconds(frames: number, fps: number): number {
  if (!Number.isFinite(frames) || !Number.isFinite(fps) || fps === 0) {
    return 0;
  }
  return frames / fps;
}

/** Round half up to an integer frame count. */
export function secondsToFrames(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0) {
    return 0;
  }
  const product = seconds * fps;
  if (product >= 0) {
    return Math.floor(product + 0.5);
  }
  return -Math.floor(-product + 0.5);
}

export function clampFrame(frame: number, min: number, max: number): number {
  const value = Number.isFinite(frame) ? Math.trunc(frame) : min;
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

/** Format integer frames at `fps` as `HH:MM:SS.mmm`. */
export function formatTimecode(frames: number, fps: number): string {
  const safeFrames = Number.isFinite(frames) && frames > 0 ? frames : 0;
  const totalMs = Math.round(framesToSeconds(safeFrames, fps) * 1000);
  const ms = ((totalMs % 1000) + 1000) % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = ((totalSec % 60) + 60) % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = ((totalMin % 60) + 60) % 60;
  const h = Math.floor(totalMin / 60);
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}

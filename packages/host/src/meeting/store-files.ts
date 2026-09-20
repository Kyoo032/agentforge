/**
 * Meeting mode — file-layer helpers for the meeting store.
 *
 * Layout under `<rootDir>/<workspaceId>/<meetingId>/`:
 *   meeting.json        MeetingRecord
 *   recording/source.*  the uploaded bytes, one per meeting
 *   audio/              ffmpeg's extracted mono mp3, rebuilt on demand and safe to delete
 *
 * Same shape as Legal's matter store (`../legal/store-files.ts`), for the same reason: a mode
 * whose inputs are files keeps them on disk under the workspace, not in a table.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ApiError } from "@agentforge/core";

/**
 * Per-recording cap. The HTTP adapter refuses a body over 26 MB outright
 * (`../http-adapter.ts` MAX_BODY_BYTES), so a larger cap here would only turn a clear error into a
 * confusing one. Roughly an hour of speech-grade mono audio; longer meetings go in as a transcript.
 */
export const MEETING_RECORDING_MAX_BYTES = 25 * 1024 * 1024;
export const MEETING_LIST_LIMIT = 100;

const MEETING_FILE = "meeting.json";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

export const MEETING_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
]);

export const MEETING_VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"]);

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
  "audio/flac": "flac",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
};

export function assertSafeId(value: string, label: string): string {
  if (!ID_PATTERN.test(value)) {
    throw new ApiError("invalid_request", `${label} is malformed`, 400);
  }
  return value;
}

export function meetingDir(rootDir: string, workspaceId: string, meetingId: string): string {
  return path.join(rootDir, assertSafeId(workspaceId, "Workspace id"), assertSafeId(meetingId, "Meeting id"));
}

export function meetingFile(dir: string): string {
  return path.join(dir, MEETING_FILE);
}

export function recordingFile(dir: string, relative: string): string {
  const resolved = path.resolve(dir, relative);
  // A stored path is ours, but it is still read back off disk — keep it inside the meeting.
  if (resolved !== path.resolve(dir) && !resolved.startsWith(`${path.resolve(dir)}${path.sep}`)) {
    throw new ApiError("invalid_request", "Recording path escapes the meeting directory", 400);
  }
  return resolved;
}

export function audioDir(dir: string): string {
  return path.join(dir, "audio");
}

/** Directories under `<rootDir>/<workspaceId>/` that carry a meeting.json. */
export function listMeetingIds(rootDir: string, workspaceId: string): string[] {
  const dir = path.join(rootDir, assertSafeId(workspaceId, "Workspace id"));
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, MEETING_FILE)))
    .map((entry) => entry.name);
}

/** Write to a sibling temp name, then rename so readers never see a partial file. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(value), "utf8");
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

export function readJson(file: string): unknown {
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ApiError("internal_error", `Stored record ${path.basename(file)} is unreadable: ${detail}`, 500);
  }
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name.trim()).replace(/[^\w.-]+/g, "_");
  return base || "recording";
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isMeetingMedia(mime: string): boolean {
  const value = mime.trim().toLowerCase().split(";")[0] ?? "";
  return MEETING_AUDIO_TYPES.has(value) || MEETING_VIDEO_TYPES.has(value);
}

export function extensionFor(mime: string, filename: string): string {
  const value = mime.trim().toLowerCase().split(";")[0] ?? "";
  const known = EXT_BY_MIME[value];
  if (known) {
    return known;
  }
  const fromName = path.extname(filename).replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : "bin";
}

export function assertRecordingCaps(bytes: Uint8Array, mime: string): void {
  if (bytes.byteLength === 0) {
    throw new ApiError("invalid_request", "The uploaded recording is empty", 400);
  }
  if (bytes.byteLength > MEETING_RECORDING_MAX_BYTES) {
    throw new ApiError("invalid_request", "A recording exceeds the 25 MB cap", 413);
  }
  if (!isMeetingMedia(mime)) {
    throw new ApiError("unsupported_content_type", "Upload an audio or video recording", 400);
  }
}

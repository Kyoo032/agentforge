/**
 * Meeting mode — file-layer helpers for the meeting store.
 *
 * Layout under `<rootDir>/<tenant prefix><workspaceId>/<meetingId>/`, where the tenant prefix is
 * empty for `local-tenant` and `tenants/<tenantId>/` for everyone else (Phase 3 lane D,
 * `../tenant-paths.ts`; see `docs/internal/maps/tenant-storage.md`):
 *   meeting.json        MeetingRecord
 *   recording/source.*  the uploaded bytes, one per meeting
 *   audio/              ffmpeg's extracted mono mp3, rebuilt on demand and safe to delete
 *
 * Same shape as Legal's matter store (`../legal/store-files.ts`), for the same reason: a mode
 * whose inputs are files keeps them on disk under the workspace, not in a table.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  type Dirent,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ApiError } from "@agentforge/core";
import { assertPathSegment, tenantScopedRoot } from "../tenant-paths";

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

/** The tenant's own slice of the meetings root. `tenants` is refused as a desk id so it cannot alias it. */
export function tenantMeetingRoot(rootDir: string, tenantId: string, workspaceId: string): string {
  return path.join(tenantScopedRoot(rootDir, tenantId), assertPathSegment(workspaceId, "Workspace id"));
}

export function meetingDir(rootDir: string, tenantId: string, workspaceId: string, meetingId: string): string {
  return path.join(tenantMeetingRoot(rootDir, tenantId, workspaceId), assertSafeId(meetingId, "Meeting id"));
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

/** The one directory a meeting's uploaded bytes ever live in. */
export const RECORDING_DIR = "recording";

/**
 * A file this store itself wrote: `source.` plus an extension `extensionFor` can produce — a known
 * one from `EXT_BY_MIME`, an `[a-z0-9]{1,5}` taken off the filename, or `bin`. Anything else in
 * that directory belongs to somebody else and is left alone.
 */
const SOURCE_FILE = /^source\.[a-z0-9]{1,5}$/;

/** ENOENT on a path that was there a moment ago is the outcome being asked for, not a failure. */
function isMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ENOENT";
}

/**
 * Delete every `source.*` in this meeting's recording directory except `keepAbsolute` (SR-13).
 *
 * A meeting holds ONE recording, but the file is named after the mime type, so replacing an `.mp3`
 * with a `.webm` used to write `source.weba` beside a `source.mp3` that nothing would ever remove
 * again: a tenant's audio outside the record, outside quota accounting, and only reachable by
 * deleting the whole meeting.
 *
 * What keeps this safe:
 *
 * - **Scope.** Only the `recording/` directory of the meeting it is handed, and every candidate is
 *   put back through `recordingFile()` — the same containment check that guards a read — before it
 *   is passed to `rmSync`.
 * - **Name.** Only `source.<ext>`. A file the store did not write (`README.txt` in a test, an
 *   operator's copy) is not this function's to delete.
 * - **No symlinks.** `readdirSync(..., { withFileTypes: true })` reports the directory entry's own
 *   type, so a symlink answers `isSymbolicLink()`, not `isFile()`, and is skipped. Nothing here can
 *   unlink a target outside the meeting — or inside it.
 * - **No directory recursion.** `isFile()` also excludes directories, so this cannot become a
 *   recursive delete by way of a path that turns into one.
 * - **ENOENT is success.** The directory or the file disappearing under a concurrent delete is the
 *   result being asked for.
 *
 * Returns the names it removed, which is what a caller would log.
 */
export function removeStaleRecordings(dir: string, keepAbsolute: string): string[] {
  const recordings = path.join(dir, RECORDING_DIR);
  let entries: Dirent[];
  try {
    entries = readdirSync(recordings, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
  const keep = path.resolve(keepAbsolute);
  const removed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !SOURCE_FILE.test(entry.name)) {
      continue;
    }
    const absolute = recordingFile(dir, path.join(RECORDING_DIR, entry.name));
    if (absolute === keep) {
      continue;
    }
    try {
      rmSync(absolute, { force: true });
      removed.push(entry.name);
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }
  return removed;
}

/**
 * Drop the extracted `audio/` chunks, because they are a cache of the recording that was just
 * replaced (SR-13).
 *
 * `meeting/run.ts` removes this directory in a `finally` after every transcription, and
 * `extractMeetingAudio` clears it again before it writes — so in the ordinary course it is empty.
 * It is not empty after a process that died mid-run, and those chunks are the OLD recording's
 * audio: same retention question as the source file, so they go at the same moment.
 *
 * `lstatSync` rather than `existsSync`: a symlink named `audio` is not a directory this function
 * recurses into, it is something to leave alone and let a human look at.
 */
export function removeDerivedAudio(dir: string): boolean {
  const audio = audioDir(dir);
  try {
    if (!lstatSync(audio).isDirectory()) {
      return false;
    }
  } catch (error) {
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
  rmSync(audio, { recursive: true, force: true });
  return true;
}

/** Directories under that tenant's `<rootDir>/<workspaceId>/` that carry a meeting.json. */
export function listMeetingIds(rootDir: string, tenantId: string, workspaceId: string): string[] {
  const dir = tenantMeetingRoot(rootDir, tenantId, workspaceId);
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

/**
 * Meeting mode — meeting store over `localDataDir()/meetings/<workspaceId>/<meetingId>/`.
 *
 * Every method filters on `tenant.workspaceId`; a record from another workspace reads as missing.
 * Records are immutable: each mutation persists and returns a new object.
 *
 * On disk rather than in a table, for the same reason Legal's matters are: the mode's input is a
 * file, and a recording plus its derived audio does not belong in SQLite.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ApiError, type AppLocale, type TenantContext } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";
import {
  MEETING_LIST_LIMIT,
  assertRecordingCaps,
  assertSafeId,
  extensionFor,
  listMeetingIds,
  meetingDir,
  meetingFile,
  readJson,
  recordingFile,
  sanitizeFilename,
  sha256Hex,
  writeJsonAtomic,
} from "./store-files";
import { meetingRecordSchema, type MeetingRecord, type MeetingStatus } from "./records";

export type { MeetingRecord, MeetingMinutesRecord } from "./records";

export type CreateMeetingInput = {
  title: string;
  locale: AppLocale;
};

export type MeetingPatch = Partial<
  Pick<MeetingRecord, "title" | "locale" | "status" | "transcript" | "transcriptArtifactId" | "minutes" | "translation">
>;

export interface MeetingStore {
  create(tenant: TenantContext, input: CreateMeetingInput): MeetingRecord;
  /** Newest first, capped at MEETING_LIST_LIMIT. */
  list(tenant: TenantContext): MeetingRecord[];
  get(tenant: TenantContext, id: string): MeetingRecord | null;
  remove(tenant: TenantContext, id: string): boolean;
  addRecording(
    tenant: TenantContext,
    id: string,
    file: { filename: string; mime: string; bytes: Uint8Array },
  ): MeetingRecord;
  update(tenant: TenantContext, id: string, patch: MeetingPatch): MeetingRecord;
  /** Absolute path of the stored recording, or null when the meeting has none. */
  recordingPath(tenant: TenantContext, id: string): string | null;
  /** Where ffmpeg may write this meeting's extracted audio, and the roots it may touch. */
  audioWorkspace(tenant: TenantContext, id: string): { dir: string; roots: string[] };
}

const TITLE_MAX = 200;

function meetingsRoot(): string {
  return path.join(localDataDir(), "meetings");
}

function newId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function readRecord(dir: string): MeetingRecord | null {
  const raw = readJson(meetingFile(dir));
  if (raw === null) {
    return null;
  }
  const parsed = meetingRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError("internal_error", "Stored meeting record is not readable", 500);
  }
  return parsed.data;
}

function writeRecord(dir: string, record: MeetingRecord): MeetingRecord {
  writeJsonAtomic(meetingFile(dir), record);
  return record;
}

function cleanTitle(value: string): string {
  const title = value.trim().slice(0, TITLE_MAX);
  if (!title) {
    throw new ApiError("invalid_request", "A meeting title is required", 400);
  }
  return title;
}

/** Status only ever moves forward, so re-running one step does not un-say a later one. */
const RANK: Record<MeetingStatus, number> = { new: 0, recorded: 1, transcribed: 2, minuted: 3 };

function highestStatus(current: MeetingStatus, next: MeetingStatus): MeetingStatus {
  return RANK[next] > RANK[current] ? next : current;
}

export function createMeetingStore(rootDir: string = meetingsRoot()): MeetingStore {
  const dirFor = (tenant: TenantContext, id: string) => meetingDir(rootDir, tenant.workspaceId, id);

  function require(tenant: TenantContext, id: string): { dir: string; record: MeetingRecord } {
    const dir = dirFor(tenant, id);
    const record = readRecord(dir);
    if (!record || record.workspaceId !== tenant.workspaceId) {
      throw new ApiError("not_found", "Meeting not found", 404);
    }
    return { dir, record };
  }

  return {
    create(tenant, input) {
      const now = Date.now();
      const id = newId();
      const dir = dirFor(tenant, id);
      mkdirSync(dir, { recursive: true });
      return writeRecord(
        dir,
        meetingRecordSchema.parse({
          id,
          workspaceId: tenant.workspaceId,
          title: cleanTitle(input.title),
          locale: input.locale,
          status: "new",
          createdAt: now,
          updatedAt: now,
          recording: null,
          transcript: null,
          transcriptArtifactId: "",
          minutes: null,
          translation: null,
        }),
      );
    },

    list(tenant) {
      return listMeetingIds(rootDir, tenant.workspaceId)
        .map((id) => {
          try {
            return readRecord(dirFor(tenant, id));
          } catch {
            // One unreadable record must not hide the rest of the desk's meetings.
            return null;
          }
        })
        .filter((record): record is MeetingRecord => record !== null && record.workspaceId === tenant.workspaceId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, MEETING_LIST_LIMIT);
    },

    get(tenant, id) {
      try {
        return readRecord(dirFor(tenant, id));
      } catch (error) {
        if (error instanceof ApiError && error.code === "invalid_request") {
          return null;
        }
        throw error;
      }
    },

    remove(tenant, id) {
      const dir = dirFor(tenant, id);
      const record = readRecord(dir);
      if (!record || record.workspaceId !== tenant.workspaceId) {
        return false;
      }
      rmSync(dir, { recursive: true, force: true });
      return true;
    },

    addRecording(tenant, id, file) {
      const { dir, record } = require(tenant, id);
      assertRecordingCaps(file.bytes, file.mime);
      const name = sanitizeFilename(file.filename);
      const relative = `recording/source.${extensionFor(file.mime, name)}`;
      const absolute = recordingFile(dir, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, file.bytes);
      return writeRecord(dir, {
        ...record,
        status: highestStatus(record.status, "recorded"),
        updatedAt: Date.now(),
        recording: {
          name,
          path: relative,
          mime: file.mime,
          bytes: file.bytes.byteLength,
          sha256: sha256Hex(file.bytes),
        },
      });
    },

    update(tenant, id, patch) {
      const { dir, record } = require(tenant, id);
      const next: MeetingRecord = {
        ...record,
        ...patch,
        ...(patch.title === undefined ? {} : { title: cleanTitle(patch.title) }),
        status: patch.status ? highestStatus(record.status, patch.status) : record.status,
        updatedAt: Date.now(),
      };
      return writeRecord(dir, meetingRecordSchema.parse(next));
    },

    recordingPath(tenant, id) {
      const { dir, record } = require(tenant, id);
      if (!record.recording) {
        return null;
      }
      const absolute = recordingFile(dir, record.recording.path);
      return existsSync(absolute) ? absolute : null;
    },

    audioWorkspace(tenant, id) {
      const dir = dirFor(tenant, assertSafeId(id, "Meeting id"));
      return { dir: path.join(dir, "audio"), roots: [dir] };
    },
  };
}

let store: MeetingStore | null = null;

export function meetingStore(): MeetingStore {
  if (!store) {
    store = createMeetingStore();
  }
  return store;
}

export function resetMeetingStoreForTests(): void {
  store = null;
}

export function requireMeeting(tenant: TenantContext, id: string): MeetingRecord {
  const record = meetingStore().get(tenant, id);
  if (!record) {
    throw new ApiError("not_found", "Meeting not found", 404);
  }
  return record;
}


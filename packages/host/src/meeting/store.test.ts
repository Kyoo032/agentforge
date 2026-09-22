/**
 * Meeting store — what replacing a recording leaves behind (SR-13).
 *
 * A meeting holds exactly one recording, and the file it lives in is named after the mime type:
 * `recording/source.<ext>`. Re-uploading in a different format therefore writes a NEW file beside
 * the old one, and until this lane the old bytes stayed on disk forever — a tenant's audio the
 * record does not mention, that nothing counts against a quota and that "delete this meeting" is
 * the only thing that ever removed.
 *
 * `createMeetingStore(rootDir)` takes its root as an argument, so every case here runs against its
 * own temp directory and none of them touches the desk.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { createMeetingStore } from "./store";

const root = mkdtempSync(path.join(tmpdir(), "agentforge-meeting-store-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function tenant(workspaceId = "desk-1", tenantId = "local-tenant"): TenantContext {
  return { tenantId, organizationId: "org-1", workspaceId, userId: "user-1", role: "owner" };
}

/** A fresh store on its own root, so one case cannot see another's files. */
function freshStore(label: string) {
  const dir = path.join(root, label);
  mkdirSync(dir, { recursive: true });
  return { store: createMeetingStore(dir), root: dir };
}

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function recordingDirOf(storeRoot: string, workspaceId: string, meetingId: string): string {
  return path.join(storeRoot, workspaceId, meetingId, "recording");
}

function listRecordingFiles(storeRoot: string, workspaceId: string, meetingId: string): string[] {
  const dir = recordingDirOf(storeRoot, workspaceId, meetingId);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe("replacing a recording leaves exactly one file on disk", () => {
  it("removes the previous source when the extension changes", () => {
    const { store, root: storeRoot } = freshStore("ext-change");
    const who = tenant();
    const meeting = store.create(who, { title: "Checkout weekly", locale: "en" });

    store.addRecording(who, meeting.id, { filename: "a.mp3", mime: "audio/mpeg", bytes: bytes("old-mp3") });
    expect(listRecordingFiles(storeRoot, who.workspaceId, meeting.id)).toEqual(["source.mp3"]);

    const after = store.addRecording(who, meeting.id, {
      filename: "b.webm",
      mime: "audio/webm",
      bytes: bytes("new-webm"),
    });

    expect(listRecordingFiles(storeRoot, who.workspaceId, meeting.id)).toEqual(["source.weba"]);
    expect(after.recording?.path).toBe("recording/source.weba");
    expect(store.recordingPath(who, meeting.id)).toBe(
      path.join(recordingDirOf(storeRoot, who.workspaceId, meeting.id), "source.weba"),
    );
  });

  it("survives a chain of formats without accumulating anything", () => {
    const { store, root: storeRoot } = freshStore("chain");
    const who = tenant();
    const meeting = store.create(who, { title: "Sprint review", locale: "en" });
    const uploads = [
      { filename: "a.mp3", mime: "audio/mpeg" },
      { filename: "b.webm", mime: "audio/webm" },
      { filename: "c.m4a", mime: "audio/mp4" },
      { filename: "d.mp4", mime: "video/mp4" },
      { filename: "e.wav", mime: "audio/wav" },
    ];
    for (const upload of uploads) {
      store.addRecording(who, meeting.id, { ...upload, bytes: bytes(upload.filename) });
      expect(listRecordingFiles(storeRoot, who.workspaceId, meeting.id).length, upload.mime).toBe(1);
    }
    expect(listRecordingFiles(storeRoot, who.workspaceId, meeting.id)).toEqual(["source.wav"]);
  });

  it("keeps the new bytes when the extension does not change", () => {
    const { store, root: storeRoot } = freshStore("same-ext");
    const who = tenant();
    const meeting = store.create(who, { title: "One to one", locale: "en" });
    store.addRecording(who, meeting.id, { filename: "a.mp3", mime: "audio/mpeg", bytes: bytes("first") });
    const after = store.addRecording(who, meeting.id, {
      filename: "b.mp3",
      mime: "audio/mpeg",
      bytes: bytes("second-and-longer"),
    });
    expect(listRecordingFiles(storeRoot, who.workspaceId, meeting.id)).toEqual(["source.mp3"]);
    expect(after.recording?.bytes).toBe(bytes("second-and-longer").byteLength);
    expect(store.recordingPath(who, meeting.id)).not.toBeNull();
  });

  it("drops the derived audio chunks of the recording it replaced", () => {
    const { store, root: storeRoot } = freshStore("derived-audio");
    const who = tenant();
    const meeting = store.create(who, { title: "Board call", locale: "en" });
    store.addRecording(who, meeting.id, { filename: "a.mp3", mime: "audio/mpeg", bytes: bytes("old") });

    // What a transcription run leaves if the process dies before its `finally` (meeting/run.ts).
    // Chunks of the OLD recording must not outlive it.
    const audio = path.join(storeRoot, who.workspaceId, meeting.id, "audio");
    mkdirSync(audio, { recursive: true });
    writeFileSync(path.join(audio, "chunk-000.mp3"), "stale");
    writeFileSync(path.join(audio, "chunk-001.mp3"), "stale");

    store.addRecording(who, meeting.id, { filename: "b.webm", mime: "audio/webm", bytes: bytes("new") });
    expect(existsSync(audio)).toBe(false);
  });

  it("touches nothing outside this meeting's recording directory", () => {
    const { store, root: storeRoot } = freshStore("scoped");
    const who = tenant();
    const keep = store.create(who, { title: "Keep me", locale: "en" });
    const replace = store.create(who, { title: "Replace me", locale: "en" });
    store.addRecording(who, keep.id, { filename: "k.mp3", mime: "audio/mpeg", bytes: bytes("keep") });
    store.addRecording(who, replace.id, { filename: "r.mp3", mime: "audio/mpeg", bytes: bytes("replace") });

    // A file next to `recording/`, and one inside it that is not a `source.*`.
    const meetingDir = path.join(storeRoot, who.workspaceId, replace.id);
    writeFileSync(path.join(meetingDir, "notes.txt"), "mine");
    writeFileSync(path.join(meetingDir, "recording", "README.txt"), "not a source file");

    store.addRecording(who, replace.id, { filename: "r.webm", mime: "audio/webm", bytes: bytes("replaced") });

    expect(listRecordingFiles(storeRoot, who.workspaceId, keep.id)).toEqual(["source.mp3"]);
    expect(existsSync(path.join(meetingDir, "notes.txt"))).toBe(true);
    expect(listRecordingFiles(storeRoot, who.workspaceId, replace.id)).toEqual(["README.txt", "source.weba"]);
    expect(existsSync(path.join(storeRoot, "meeting.json"))).toBe(false);
  });

  it("does not delete through a symlink that happens to be named like a source file", () => {
    const { store, root: storeRoot } = freshStore("symlink");
    const who = tenant();
    const meeting = store.create(who, { title: "Symlinked", locale: "en" });
    store.addRecording(who, meeting.id, { filename: "a.mp3", mime: "audio/mpeg", bytes: bytes("old") });

    const outsider = path.join(storeRoot, "outsider.bin");
    writeFileSync(outsider, "must survive");
    const link = path.join(recordingDirOf(storeRoot, who.workspaceId, meeting.id), "source.lnk");
    try {
      symlinkSync(outsider, link, "file");
    } catch {
      // Windows refuses symlinks without Developer Mode or elevation. The guard being tested is
      // `entry.isFile()`, which is covered by the other cases; nothing is proved by failing here.
      return;
    }

    store.addRecording(who, meeting.id, { filename: "b.webm", mime: "audio/webm", bytes: bytes("new") });

    expect(existsSync(outsider), "the symlink target must not be deleted").toBe(true);
  });

  it("is a no-op when the recording directory was removed underneath it", () => {
    const { store, root: storeRoot } = freshStore("missing-dir");
    const who = tenant();
    const meeting = store.create(who, { title: "Vanished", locale: "en" });
    store.addRecording(who, meeting.id, { filename: "a.mp3", mime: "audio/mpeg", bytes: bytes("old") });
    rmSync(recordingDirOf(storeRoot, who.workspaceId, meeting.id), { recursive: true, force: true });

    expect(() =>
      store.addRecording(who, meeting.id, { filename: "b.webm", mime: "audio/webm", bytes: bytes("new") }),
    ).not.toThrow();
    expect(listRecordingFiles(storeRoot, who.workspaceId, meeting.id)).toEqual(["source.weba"]);
  });

  it("still removes the whole meeting on delete", () => {
    const { store, root: storeRoot } = freshStore("delete");
    const who = tenant();
    const meeting = store.create(who, { title: "Gone", locale: "en" });
    store.addRecording(who, meeting.id, { filename: "a.mp3", mime: "audio/mpeg", bytes: bytes("old") });
    expect(store.remove(who, meeting.id)).toBe(true);
    expect(existsSync(path.join(storeRoot, who.workspaceId, meeting.id))).toBe(false);
  });

  it("never reaches another tenant's meeting of the same id", () => {
    const { store, root: storeRoot } = freshStore("tenants");
    const mine = tenant("desk-1", "tenant-a");
    const theirs = tenant("desk-1", "tenant-b");
    const a = store.create(mine, { title: "Mine", locale: "en" });
    store.addRecording(mine, a.id, { filename: "a.mp3", mime: "audio/mpeg", bytes: bytes("mine") });
    // The other tenant does not have this meeting at all, so there is nothing to replace.
    expect(() =>
      store.addRecording(theirs, a.id, { filename: "b.webm", mime: "audio/webm", bytes: bytes("theirs") }),
    ).toThrow(/not found/i);
    expect(listRecordingFiles(path.join(storeRoot, "tenants", "tenant-a"), mine.workspaceId, a.id)).toEqual([
      "source.mp3",
    ]);
  });
});

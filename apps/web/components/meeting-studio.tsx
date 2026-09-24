"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AppLocale } from "@agentforge/core/locale";
import type { MeetingMinutes, MeetingTranscript } from "@agentforge/core/meeting";
import { Link } from "@/lib/nav";
import { JobProgressList } from "@/components/job-progress";
import { MeetingMinutesView } from "@/components/meeting-minutes-view";
import { MeetingOtherDeskClips, MeetingRecorderPanel } from "@/components/meeting-recorder";
import { ModelSelect } from "@/components/model-select";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import type { RecordedClip } from "@/lib/meeting-recorder";
import {
  postMeetingRecording,
  saveClipToDevice,
  type MeetingApiFetch,
  type UploadOutcome,
} from "@/lib/meeting-upload";
import { useJobModel } from "@/lib/use-job-model";
import { useJobStream } from "@/lib/use-job-stream";
import { useMeetingRecorder } from "@/lib/use-meeting-recorder";
import { useMeetingUpload } from "@/lib/use-meeting-upload";
import { useWorkspaceScope } from "@/lib/workspace-scope";

type MinutesRecord = {
  locale: AppLocale;
  minutes: MeetingMinutes;
  artifactId: string;
  model: string;
  unverifiedNames: string[];
};

type Meeting = {
  id: string;
  title: string;
  locale: AppLocale;
  status: "new" | "recorded" | "transcribed" | "minuted";
  recording: { name: string; bytes: number } | null;
  transcript: MeetingTranscript | null;
  transcriptArtifactId: string;
  minutes: MinutesRecord | null;
  translation: MinutesRecord | null;
};

type Capability = {
  available: boolean;
  model: string | null;
  reason: "ok" | "no_model" | "no_key";
  ffmpeg: boolean;
};

type Tab = "transcript" | "minutes" | "translation";

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

function readableSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function mentionsSettings(message: string): boolean {
  return /gateway|api key|settings|runtime_stub|live gateway/i.test(message);
}

/** A body that is a meeting, or null when the host answered 2xx with something else. */
function asMeeting(value: unknown): Meeting | null {
  return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
    ? (value as Meeting)
    : null;
}

export type MeetingRequestOutcome =
  | { readonly ok: true; readonly meeting: Meeting | null }
  | { readonly ok: false; readonly message: string };

/**
 * Create a meeting or save a pasted transcript: one JSON POST, answered with the meeting.
 *
 * The order `postMeetingRecording` uses since SR-45: `res.ok` before the body, the error body read
 * with a catch, and a dead network reported rather than thrown. Both callers used to read
 * `res.json()` first with no `catch`, so an html error page or an offline laptop threw a rejection
 * nothing handled and the owner saw no message at all. A 2xx whose body is not a meeting still
 * counts as done; the caller reloads the list to show it.
 */
export async function requestMeeting(
  path: string,
  body: unknown,
  fallback: string,
  fetcher: MeetingApiFetch = apiFetch,
): Promise<MeetingRequestOutcome> {
  let res: Response;
  try {
    res = await fetcher(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, message: error instanceof Error && error.message ? error.message : fallback };
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    return { ok: false, message: errorMessage(payload, fallback) };
  }
  const payload = await res.json().catch(() => null);
  return { ok: true, meeting: asMeeting(payload) };
}

/** The meeting a recording belongs to — fixed when Record is pressed, never re-read from the list. */
export type ClipTarget = {
  readonly id: string;
  readonly title: string;
  /** The desk it was made on; null when the shell had not named one yet. */
  readonly workspaceId: string | null;
};

/** A recording whose studio went away before the host had it. */
export type RescuedClip = { readonly clip: RecordedClip; readonly target: ClipTarget };

let rescuedClips: readonly RescuedClip[] = [];

/**
 * Keep a recording that outlived its studio.
 *
 * `WorkModeKeepAlive` keys every work mode on the desk id, so a desk switch — or a language
 * restart — unmounts this studio. The recorder hands back what it had captured, and the upload
 * queue still holds whatever had not reached the host; both used to go with the component. They
 * wait here, in module scope, which outlives the pane, until the next studio mounts and takes
 * them. This is memory, not storage: a page reload still loses them.
 */
export function stashRescuedClip(entry: RescuedClip): void {
  if (rescuedClips.some((held) => held.clip === entry.clip)) {
    return;
  }
  rescuedClips = [...rescuedClips, entry];
}

/** Everything held, oldest first. The slot is empty afterwards. */
export function takeRescuedClips(): readonly RescuedClip[] {
  const taken = rescuedClips;
  rescuedClips = [];
  return taken;
}

/**
 * Whether a recording can be uploaded from this desk. The host resolves `/meetings/:id` against the
 * desk selected now, so a meeting on another desk answers 404. An unknown desk gets the benefit of
 * the doubt: if it is wrong, the upload fails and the clip is kept with Retry and Save to device.
 */
export function onSameDesk(target: ClipTarget, workspaceId: string | null): boolean {
  return target.workspaceId === null || workspaceId === null || target.workspaceId === workspaceId;
}

/** A stable key for a held recording, for the list and for Save. */
function rescuedKey(entry: RescuedClip): string {
  return `${entry.target.id}:${entry.clip.filename}:${entry.clip.bytes}`;
}

export type MeetingListRowProps = {
  meeting: Pick<Meeting, "id" | "title" | "status">;
  selected: boolean;
  /** The first press armed delete on this row; the confirm panel is showing. */
  confirming: boolean;
  deleting: boolean;
  /**
   * A recording is running. It belongs to the meeting selected when Record was pressed, so the
   * owner cannot switch rows until they stop it.
   */
  locked?: boolean;
  /** This row is the meeting being recorded: deleting it would pull the meeting out from under it. */
  deleteLocked?: boolean;
  onSelect: () => void;
  onAskDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

/**
 * One meeting in the list, with a two-step delete.
 *
 * Deleting removes the meeting folder and its recording, so the × only arms the row; the meeting
 * goes when the owner presses Delete in the panel that opens. Same shape as Settings' sign-out
 * confirm (`settings-reset-card.tsx`): a danger panel, a danger button, and a plain Cancel.
 */
export function MeetingListRow({
  meeting,
  selected,
  confirming,
  deleting,
  locked = false,
  deleteLocked = false,
  onSelect,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: MeetingListRowProps) {
  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onSelect}
          disabled={locked}
          title={locked ? t("meeting.record.switchLocked") : undefined}
          className={`flex-1 rounded-lg px-3 py-2 text-left text-sm disabled:cursor-not-allowed ${
            selected ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-[var(--text-2)] disabled:opacity-45"
          }`}
          data-testid={`meeting-item-${meeting.id}`}
        >
          {meeting.title}
          <span className="block text-xs text-[var(--text-3)]">{meeting.status}</span>
        </button>
        <button
          type="button"
          onClick={onAskDelete}
          disabled={confirming || deleteLocked}
          className="rounded-lg px-2 py-2 text-xs text-[var(--text-3)] disabled:opacity-45"
          aria-label={t("meeting.delete")}
          aria-expanded={confirming}
          data-testid={`meeting-delete-${meeting.id}`}
        >
          ×
        </button>
      </div>
      {confirming ? (
        <div
          className="mt-1 space-y-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-3"
          data-testid="meeting-delete-panel"
        >
          <p className="text-sm text-[var(--text)]">{t("meeting.deleteConfirm", { title: meeting.title })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-pill bg-[var(--danger)] px-3 py-1.5 text-sm text-[var(--surface)] disabled:opacity-50"
              disabled={deleting}
              onClick={onConfirmDelete}
              data-testid="meeting-delete-confirm"
            >
              {t("meeting.deleteConfirmSubmit")}
            </button>
            <button
              type="button"
              className="rounded-md px-3 py-2 text-sm text-[var(--text-2)] underline disabled:opacity-50"
              disabled={deleting}
              onClick={onCancelDelete}
              data-testid="meeting-delete-cancel"
            >
              {t("meeting.cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MeetingStudio() {
  const { models, model, setModel } = useJobModel("meeting");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [capability, setCapability] = useState<Capability | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [locale, setLocale] = useState<AppLocale>("en");
  const [paste, setPaste] = useState("");
  const [tab, setTab] = useState<Tab>("minutes");
  const [busy, setBusy] = useState<"create" | "upload" | "paste" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /** The meeting of the clip in the upload queue, for the notice that names it. */
  const [clipTarget, setClipTarget] = useState<ClipTarget | null>(null);
  /** The last recording ended early and what it captured was kept, and why. */
  const [kept, setKept] = useState<"salvaged" | "interrupted" | null>(null);
  /** Recordings rescued from an unmounted studio that have not been queued: see `stashRescuedClip`. */
  const [held, setHeld] = useState<readonly RescuedClip[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const { id: workspaceId } = useWorkspaceScope();
  const job = useJobStream<Meeting>();

  /**
   * Set when Record is pressed, to the meeting selected then. A recording belongs to that meeting
   * whatever row is selected by the time it stops: the upload used to read the selection at send
   * time, so switching rows mid-recording — or before Retry — replaced another meeting's recording.
   */
  const recordingTargetRef = useRef<ClipTarget | null>(null);
  /** The meeting of the clip the upload queue holds: what `sendClip`, and so Retry, posts to. */
  const clipTargetRef = useRef<ClipTarget | null>(null);
  /** `held` as of now rather than as of the last render, for the stash on unmount. */
  const heldRef = useRef<readonly RescuedClip[]>([]);

  // Unmounted mid-recording (a desk or language change): what was captured goes to the next studio.
  const recorder = useMeetingRecorder(undefined, (clip) => {
    const target = recordingTargetRef.current;
    if (target) {
      stashRescuedClip({ clip, target });
    } else {
      // Unreachable, since Record sets the target first; but a recording is never simply dropped.
      saveClipToDevice(clip);
    }
  });

  const selected = meetings.find((meeting) => meeting.id === selectedId) ?? null;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/v1/meetings");
      const data = (await res.json().catch(() => null)) as { items?: Meeting[]; capability?: Capability } | null;
      if (!res.ok || !data) {
        setError(errorMessage(data, t("meeting.errors.load")));
        return;
      }
      setMeetings(data.items ?? []);
      setCapability(data.capability ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("meeting.errors.load"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * A finished recording takes exactly the path a chosen file does — same route, same "file" field,
   * same `merge`, so the Run button lights up for a recording the way it does for an upload.
   *
   * What differs is who holds the bytes. `MeetingUploadController` does, from the moment the clip
   * is offered until the host answers 2xx; this studio only says which meeting it goes to and when
   * it is busy. Clearing the recorder before the POST, which is what this used to do, destroyed the
   * only copy of an hour of audio whenever that POST failed — see `@/lib/meeting-upload`.
   */
  const upload = useMeetingUpload(sendClip);

  const { clip: recordedClip, clearClip, status: recorderStatus } = recorder;
  const { offer: offerClip, setBlocked, recordingStarted, pending: pendingClip } = upload;
  const pendingClipRef = useRef(pendingClip);
  pendingClipRef.current = pendingClip;

  /** True while the microphone is open: choosing a file mid-recording would fight it for the slot. */
  const recording = recorderStatus !== "idle" && recorderStatus !== "error";

  useEffect(() => {
    if (!recordedClip) {
      return;
    }
    // Ownership moves first; only then is the recorder's copy dropped. The clip goes to the meeting
    // Record was pressed for, and a failed recorder hands over what it had captured the same way.
    const target = recordingTargetRef.current;
    if (target) {
      clipTargetRef.current = target;
      setClipTarget(target);
      offerClip(recordedClip);
    } else {
      saveClipToDevice(recordedClip);
    }
    if (recorderStatus === "error") {
      setKept("salvaged");
    }
    clearClip();
  }, [recordedClip, recorderStatus, clearClip, offerClip]);

  // Busy is a queue, not a bin: a clip offered mid-upload waits here instead of being dropped.
  // The clip carries its own meeting, so what is selected now does not decide whether it can go.
  useEffect(() => {
    setBlocked(busy !== null);
  }, [setBlocked, busy]);

  // A new recording replaces the last one's notices; nothing else clears them but Dismiss.
  useEffect(() => {
    if (recorderStatus === "requesting-permission" || recorderStatus === "recording") {
      recordingStarted();
      setKept(null);
    }
  }, [recorderStatus, recordingStarted]);

  // A previous studio was unmounted with a recording in hand. Take it: see `stashRescuedClip`.
  useEffect(() => {
    const rescued = takeRescuedClips().filter(
      (entry) => !heldRef.current.some((existing) => existing.clip === entry.clip),
    );
    if (rescued.length > 0) {
      heldRef.current = [...heldRef.current, ...rescued];
      setHeld(heldRef.current);
    }
    return () => {
      // Unmounting in turn: whatever has not reached the host moves on to the next studio.
      const pending = pendingClipRef.current;
      const target = clipTargetRef.current;
      if (pending && target) {
        stashRescuedClip({ clip: pending, target });
      }
      for (const entry of heldRef.current) {
        stashRescuedClip(entry);
      }
      heldRef.current = [];
    };
  }, []);

  // One rescued recording at a time goes into the upload queue, once it is free and on its desk.
  // A recording from another desk stays held: the host would answer its meeting with 404 here.
  useEffect(() => {
    if (pendingClip || recording) {
      return;
    }
    const next = held.find((entry) => onSameDesk(entry.target, workspaceId));
    if (!next) {
      return;
    }
    heldRef.current = heldRef.current.filter((entry) => entry !== next);
    setHeld(heldRef.current);
    clipTargetRef.current = next.target;
    setClipTarget(next.target);
    setKept("interrupted");
    if (selectedIdRef.current === null) {
      setSelectedId(next.target.id);
    }
    offerClip(next.clip);
  }, [held, pendingClip, recording, workspaceId, offerClip]);

  /** Record, fixing the meeting it is for. The list stays locked until it stops. */
  function startRecording() {
    if (!selected) {
      return;
    }
    recordingTargetRef.current = { id: selected.id, title: selected.title, workspaceId };
    recorder.start();
  }

  /**
   * Replace one meeting in place so the list does not jump while a job is running. `select: false`
   * is a recording that finished uploading after the owner had moved on: it updates its row without
   * taking the selection back, unless nothing else is selected.
   */
  function merge(meeting: Meeting, select = true) {
    setMeetings((current) => {
      const next = current.some((item) => item.id === meeting.id)
        ? current.map((item) => (item.id === meeting.id ? meeting : item))
        : [meeting, ...current];
      return next;
    });
    if (select || selectedIdRef.current === null) {
      setSelectedId(meeting.id);
    }
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const name = title.trim();
    // Creating selects the new meeting, which would move the owner off the one being recorded.
    if (!name || busy || recording) {
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const outcome = await requestMeeting("/api/v1/meetings", { title: name, locale }, t("meeting.errors.create"));
      if (!outcome.ok) {
        // The title stays in the field for another try.
        setError(outcome.message);
        return;
      }
      setTitle("");
      setTab("transcript");
      if (outcome.meeting) {
        merge(outcome.meeting);
      } else {
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  /**
   * The upload queue's sender. It posts to the clip's own meeting, fixed when Record was pressed,
   * so a clip that waited in the queue — and Retry — goes where the recording was made rather than
   * to whichever row is selected by then.
   */
  function sendClip(file: File): Promise<UploadOutcome> {
    const target = clipTargetRef.current;
    if (!target) {
      return Promise.resolve({ ok: false, message: t("meeting.errors.noMeeting") });
    }
    return sendTo(target.id, file, false);
  }

  /**
   * The one POST, for a chosen file and for a recording alike.
   *
   * It reports rather than decides: the outcome goes back to whoever asked, so the file input can
   * put a message in the page banner and the upload controller can keep the clip and offer Retry.
   */
  async function sendTo(meetingId: string, file: File, select: boolean): Promise<UploadOutcome> {
    setBusy("upload");
    setError(null);
    try {
      const outcome = await postMeetingRecording(meetingId, file);
      if (outcome.ok) {
        // A 2xx the host could not serialise is still stored; reloading shows it.
        const meeting = asMeeting(outcome.meeting);
        if (meeting) {
          merge(meeting, select);
        } else {
          void load();
        }
      }
      return outcome;
    } finally {
      setBusy(null);
    }
  }

  /** The file input's path: the same POST, with the failure shown in the page's error banner. */
  async function onChooseFile(file: File) {
    if (!selected || busy) {
      return;
    }
    const outcome = await sendTo(selected.id, file, true);
    if (!outcome.ok) {
      setError(outcome.message);
    }
    if (fileInput.current) {
      fileInput.current.value = "";
    }
  }

  async function onPaste() {
    const text = paste.trim();
    if (!selected || !text || busy) {
      return;
    }
    setBusy("paste");
    setError(null);
    try {
      const outcome = await requestMeeting(
        `/api/v1/meetings/${selected.id}/transcript`,
        { text },
        t("meeting.errors.transcript"),
      );
      if (!outcome.ok) {
        // The pasted transcript stays in the box for another try.
        setError(outcome.message);
        return;
      }
      setPaste("");
      setTab("transcript");
      if (outcome.meeting) {
        merge(outcome.meeting);
      } else {
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  async function onRun() {
    if (!selected || job.busy) {
      return;
    }
    setError(null);
    // With a transcript already in hand there is nothing to transcribe, so skip straight to the
    // minutes rather than asking the host to re-decide.
    const url = selected.transcript
      ? `/api/v1/meetings/${selected.id}/minutes/stream`
      : `/api/v1/meetings/${selected.id}/run/stream`;
    const result = await job.run(url, { model, translate: true });
    if (result) {
      merge(result);
      setTab("minutes");
    }
  }

  /** Second press of the two-step delete: the row's confirm panel calls this, never the × itself. */
  async function onDelete(id: string) {
    if (deleteBusy) {
      return;
    }
    setDeleteBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/meetings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as unknown;
        setError(errorMessage(data, t("meeting.errors.delete")));
        return;
      }
      setMeetings((current) => current.filter((meeting) => meeting.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
      }
      setDeletingId(null);
    } catch {
      setError(t("meeting.errors.delete"));
    } finally {
      setDeleteBusy(false);
    }
  }

  const blocked = capability && !capability.available;
  const noFfmpeg = capability && !capability.ffmpeg;
  const jobError = job.error ? job.error.message : null;
  const shown = error ?? jobError;
  const otherDeskClips = held.filter((entry) => !onSameDesk(entry.target, workspaceId));

  return (
    <main
      className="mx-auto flex min-h-full max-w-[var(--content-wide)] flex-col px-6 py-10 text-[var(--text)]"
      data-testid="meeting-studio"
    >
      <div>
        <h1 className="text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("meeting.title")}</h1>
        <p className="mt-2 max-w-[var(--content-narrow)] text-sm text-[var(--text-2)]" data-testid="expected-inputs">{t("meeting.subtitle")}</p>
      </div>

      {shown ? (
        <div
          className="mt-6 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--danger)]"
          role="alert"
          data-testid="meeting-error"
        >
          {shown}
          {mentionsSettings(shown) && !/settings/i.test(shown) ? (
            <>
              {" "}
              {t("meeting.openSettingsLead")}{" "}
              <Link href="/settings" className="underline">
                {t("meeting.settings")}
              </Link>
              .
            </>
          ) : null}
        </div>
      ) : null}

      {blocked ? (
        <p
          className="mt-4 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--text-2)]"
          data-testid="meeting-no-asr"
        >
          {t("meeting.noAsr")}
        </p>
      ) : null}
      {noFfmpeg ? (
        <p
          className="mt-4 rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--text-2)]"
          data-testid="meeting-no-ffmpeg"
        >
          {t("meeting.noFfmpeg")}
        </p>
      ) : null}

      <MeetingOtherDeskClips
        items={otherDeskClips.map((entry) => ({ key: rescuedKey(entry), title: entry.target.title }))}
        onSave={(key) => {
          const entry = otherDeskClips.find((candidate) => rescuedKey(candidate) === key);
          if (entry) {
            saveClipToDevice(entry.clip);
          }
        }}
      />

      <form className="mt-8 flex flex-wrap items-end gap-3" onSubmit={onCreate} data-testid="meeting-new">
        <label className="flex-1 min-w-[16rem] text-sm">
          <span className="text-[var(--text-2)]">{t("meeting.meetingTitle")}</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t("meeting.meetingTitlePlaceholder")}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--line)] bg-transparent px-3"
            data-testid="meeting-title"
          />
        </label>
        {/* Same stack as the title field beside it: the label holds a full-width control, so the
            caption sits on its own line above it instead of butting straight against the select. */}
        <label className="min-w-[10rem] text-sm">
          <span className="text-[var(--text-2)]">{t("meeting.language")}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as AppLocale)}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--line)] bg-transparent px-3"
            data-testid="meeting-locale"
          >
            <option value="en">{t("meeting.languageEnglish")}</option>
            <option value="id">{t("meeting.languageIndonesian")}</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy !== null || recording || !title.trim()}
          className="wash inline-flex h-9 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
          data-testid="meeting-create"
        >
          {t("meeting.create")}
        </button>
      </form>

      <div className="mt-8 grid flex-1 gap-6 md:grid-cols-[16rem_1fr]">
        <aside className="space-y-1" data-testid="meeting-list">
          {meetings.length === 0 ? (
            <p className="text-sm text-[var(--text-2)]" data-testid="meeting-empty">
              {t("meeting.empty")}
              <span className="block text-[var(--text-3)]">{t("meeting.emptyDetail")}</span>
            </p>
          ) : null}
          {meetings.map((meeting) => (
            <MeetingListRow
              key={meeting.id}
              meeting={meeting}
              selected={meeting.id === selectedId}
              confirming={meeting.id === deletingId}
              deleting={deleteBusy}
              // The list is locked while recording, so the row being recorded is the selected one.
              locked={recording}
              deleteLocked={recording && meeting.id === selectedId}
              onSelect={() => {
                if (!recording) {
                  setSelectedId(meeting.id);
                }
              }}
              onAskDelete={() => setDeletingId(meeting.id)}
              onConfirmDelete={() => void onDelete(meeting.id)}
              onCancelDelete={() => setDeletingId(null)}
            />
          ))}
        </aside>

        <section className="min-w-0">
          {selected ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="text-sm text-[var(--text-2)]">
                  <span className="font-medium text-[var(--text)]">{selected.title}</span>
                  {selected.recording ? (
                    <span className="ml-2" data-testid="meeting-recording">
                      {t("meeting.uploaded", {
                        name: selected.recording.name,
                        size: readableSize(selected.recording.bytes),
                      })}
                    </span>
                  ) : null}
                </div>
                <ModelSelect models={models} value={model} onChange={setModel} testId="meeting-model" />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  ref={fileInput}
                  type="file"
                  accept="audio/*,video/*"
                  // Choosing a file mid-recording would race the clip that is about to arrive for
                  // the same upload slot, and the winner would be whichever finished first.
                  disabled={busy !== null || recording}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void onChooseFile(file);
                    }
                  }}
                  className="text-sm text-[var(--text-2)]"
                  data-testid="meeting-file"
                />
                {busy === "upload" ? (
                  <span className="text-xs text-[var(--text-3)]" data-testid="meeting-uploading">
                    {t("meeting.uploading")}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void onRun()}
                  disabled={job.busy || busy !== null || (!selected.recording && !selected.transcript)}
                  className="wash inline-flex h-9 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)] disabled:opacity-45"
                  data-testid="meeting-run"
                >
                  {job.busy
                    ? t("meeting.running")
                    : selected.transcript
                      ? t("meeting.runFromTranscript")
                      : t("meeting.run")}
                </button>
                {job.busy ? (
                  <button
                    type="button"
                    onClick={job.cancel}
                    className="inline-flex h-9 items-center rounded-pill border border-[var(--line)] px-4 text-sm"
                    data-testid="meeting-cancel"
                  >
                    {t("meeting.cancel")}
                  </button>
                ) : null}
              </div>

              <div className="mt-3">
                <MeetingRecorderPanel
                  // A clip still in hand is a reason not to start another one: this controller
                  // holds exactly one recording, and a second would replace bytes nothing else has.
                  disabled={busy !== null || job.busy || upload.pending !== null}
                  view={{ ...recorder, start: startRecording }}
                  clip={{
                    capped: upload.capped,
                    status: upload.status,
                    errorMessage: upload.errorMessage,
                    dismissCapped: upload.dismissCapped,
                    retry: upload.retry,
                    save: () => {
                      if (upload.pending) {
                        saveClipToDevice(upload.pending);
                      }
                    },
                    meetingTitle: upload.pending ? (clipTarget?.title ?? null) : null,
                    kept,
                    dismissKept: () => setKept(null),
                  }}
                />
              </div>

              <p className="mt-2 text-xs text-[var(--text-3)]">{t("meeting.cap")}</p>

              {/* A recording is the headline path; a transcript in hand is the alternative, folded. */}
              {!selected.transcript ? (
                <details className="mt-5 rounded-lg border border-[var(--line)] px-3 py-2" data-testid="meeting-how">
                  <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
                    {t("meeting.orPaste")}
                  </summary>
                  <textarea
                    id="meeting-paste"
                    value={paste}
                    onChange={(event) => setPaste(event.target.value)}
                    placeholder={t("meeting.pastePlaceholder")}
                    rows={5}
                    className="mt-2 w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                    data-testid="meeting-paste"
                  />
                  <button
                    type="button"
                    onClick={() => void onPaste()}
                    disabled={busy !== null || !paste.trim()}
                    className="mt-2 inline-flex h-8 items-center rounded-pill border border-[var(--line)] px-4 text-sm disabled:opacity-45"
                    data-testid="meeting-save-paste"
                  >
                    {t("meeting.savePaste")}
                  </button>
                </details>
              ) : null}

              <JobProgressList progress={job.progress} busy={job.busy} testId="meeting-progress" />

              <nav className="mt-6 flex gap-2 text-sm" data-testid="meeting-tabs">
                {(["transcript", "minutes", "translation"] as Tab[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setTab(name)}
                    className={`rounded-pill px-3 py-1 ${
                      tab === name ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-[var(--text-2)]"
                    }`}
                    data-testid={`meeting-tab-${name}`}
                  >
                    {name === "transcript"
                      ? t("meeting.transcript")
                      : name === "minutes"
                        ? t("meeting.minutesTab")
                        : t("meeting.translationTab")}
                  </button>
                ))}
              </nav>

              <div className="mt-4">
                {tab === "transcript" && selected.transcript ? (
                  <pre
                    className="whitespace-pre-wrap rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-[var(--text-2)]"
                    data-testid="meeting-transcript"
                  >
                    {selected.transcript.text}
                  </pre>
                ) : null}
                {tab === "minutes" && selected.minutes ? (
                  <>
                    {selected.minutes.unverifiedNames.length > 0 ? (
                      <p className="mb-3 text-xs text-[var(--text-3)]" data-testid="meeting-unverified">
                        {t("meeting.unverified", { count: String(selected.minutes.unverifiedNames.length) })}
                      </p>
                    ) : null}
                    <MeetingMinutesView minutes={selected.minutes.minutes} testId="meeting-minutes" />
                  </>
                ) : null}
                {tab === "translation" && selected.translation ? (
                  <MeetingMinutesView minutes={selected.translation.minutes} testId="meeting-translation" />
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-[var(--text-2)]">{t("meeting.emptyDetail")}</p>
          )}
        </section>
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AppLocale } from "@agentforge/core/locale";
import type { MeetingMinutes, MeetingTranscript } from "@agentforge/core/meeting";
import { Link } from "@/lib/nav";
import { JobProgressList } from "@/components/job-progress";
import { MeetingMinutesView } from "@/components/meeting-minutes-view";
import { ModelSelect } from "@/components/model-select";
import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { useJobModel } from "@/lib/use-job-model";
import { useJobStream } from "@/lib/use-job-stream";

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
  const fileInput = useRef<HTMLInputElement | null>(null);
  const job = useJobStream<Meeting>();

  const selected = meetings.find((meeting) => meeting.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/v1/meetings");
      const data = (await res.json()) as { items?: Meeting[]; capability?: Capability };
      if (!res.ok) {
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

  /** Replace one meeting in place so the list does not jump while a job is running. */
  function merge(meeting: Meeting) {
    setMeetings((current) => {
      const next = current.some((item) => item.id === meeting.id)
        ? current.map((item) => (item.id === meeting.id ? meeting : item))
        : [meeting, ...current];
      return next;
    });
    setSelectedId(meeting.id);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const name = title.trim();
    if (!name || busy) {
      return;
    }
    setBusy("create");
    setError(null);
    try {
      const res = await apiFetch("/api/v1/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name, locale }),
      });
      const data = (await res.json()) as Meeting;
      if (!res.ok) {
        setError(errorMessage(data, t("meeting.errors.create")));
        return;
      }
      merge(data);
      setTitle("");
      setTab("transcript");
    } finally {
      setBusy(null);
    }
  }

  async function onUpload(file: File) {
    if (!selected || busy) {
      return;
    }
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file, file.name);
      const res = await apiFetch(`/api/v1/meetings/${selected.id}/recording`, { method: "POST", body: form });
      const data = (await res.json()) as Meeting;
      if (!res.ok) {
        setError(errorMessage(data, t("meeting.errors.upload")));
        return;
      }
      merge(data);
    } finally {
      setBusy(null);
      if (fileInput.current) {
        fileInput.current.value = "";
      }
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
      const res = await apiFetch(`/api/v1/meetings/${selected.id}/transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as Meeting;
      if (!res.ok) {
        setError(errorMessage(data, t("meeting.errors.transcript")));
        return;
      }
      merge(data);
      setPaste("");
      setTab("transcript");
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

  async function onDelete(id: string) {
    await apiFetch(`/api/v1/meetings/${id}`, { method: "DELETE" });
    setMeetings((current) => current.filter((meeting) => meeting.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
    }
  }

  const blocked = capability && !capability.available;
  const noFfmpeg = capability && !capability.ffmpeg;
  const jobError = job.error ? job.error.message : null;
  const shown = error ?? jobError;

  return (
    <main
      className="mx-auto flex min-h-full max-w-5xl flex-col px-6 py-10 text-[var(--text)]"
      data-testid="meeting-studio"
    >
      <div>
        <h1 className="text-2xl font-medium tracking-[var(--track)] text-[var(--text)]">{t("meeting.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-2)]">{t("meeting.subtitle")}</p>
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
        <label className="text-sm">
          <span className="text-[var(--text-2)]">{t("meeting.language")}</span>
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as AppLocale)}
            className="mt-1 h-9 rounded-lg border border-[var(--line)] bg-transparent px-3"
            data-testid="meeting-locale"
          >
            <option value="en">{t("meeting.languageEnglish")}</option>
            <option value="id">{t("meeting.languageIndonesian")}</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busy !== null || !title.trim()}
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
            <div key={meeting.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedId(meeting.id)}
                className={`flex-1 rounded-lg px-3 py-2 text-left text-sm ${
                  meeting.id === selectedId ? "bg-[var(--surface-2)] text-[var(--text)]" : "text-[var(--text-2)]"
                }`}
                data-testid={`meeting-item-${meeting.id}`}
              >
                {meeting.title}
                <span className="block text-xs text-[var(--text-3)]">{meeting.status}</span>
              </button>
              <button
                type="button"
                onClick={() => void onDelete(meeting.id)}
                className="rounded-lg px-2 py-2 text-xs text-[var(--text-3)]"
                aria-label={t("meeting.delete")}
                data-testid={`meeting-delete-${meeting.id}`}
              >
                ×
              </button>
            </div>
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
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void onUpload(file);
                    }
                  }}
                  className="text-sm text-[var(--text-2)]"
                  data-testid="meeting-file"
                />
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
              <p className="mt-1 text-xs text-[var(--text-3)]">{t("meeting.cap")}</p>

              {!selected.transcript ? (
                <div className="mt-5">
                  <label className="text-sm text-[var(--text-2)]" htmlFor="meeting-paste">
                    {t("meeting.orPaste")}
                  </label>
                  <textarea
                    id="meeting-paste"
                    value={paste}
                    onChange={(event) => setPaste(event.target.value)}
                    placeholder={t("meeting.pastePlaceholder")}
                    rows={5}
                    className="mt-1 w-full rounded-lg border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
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
                </div>
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

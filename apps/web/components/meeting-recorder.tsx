"use client";

/**
 * The Record control, beside the file input it is an alternative to.
 *
 * Presentation only: every decision is the controller's (`@/lib/meeting-recorder`), and the panel is
 * handed a finished view by `useMeetingRecorder`, the same shape `ComponentSetupPanel` takes, so it
 * can be rendered in a test without a browser.
 *
 * The recorded blob is not a special case downstream — `MeetingStudio` turns it into a `File` and
 * sends it through the same `POST /api/v1/meetings/:id/recording` the file input uses.
 *
 * The two notices under the controls are about the clip rather than the recorder, so they are fed
 * by `MeetingUploadController` (`@/lib/meeting-upload`) through the `clip` prop: the size-cap line
 * has to outlive the clip it describes, and the failure line only exists because the bytes are
 * still held after a POST fails.
 */

import { t } from "@/lib/i18n";
import type { MeetingRecorderView } from "@/lib/use-meeting-recorder";
import type { RecorderSource } from "@/lib/meeting-recorder";
import type { MeetingUploadStatus } from "@/lib/meeting-upload";

const SOURCES: readonly RecorderSource[] = ["mic", "mic+tab"];

/**
 * What the panel needs to know about the clip the studio is holding. A narrow view on purpose: the
 * panel decides nothing, and a test builds one of these in four lines.
 */
export type MeetingClipView = {
  /** The last recording stopped at the size cap. Outlives the clip; cleared by `dismissCapped`. */
  readonly capped: boolean;
  readonly status: MeetingUploadStatus;
  /** What the host or the network said about the failed upload. */
  readonly errorMessage: string | null;
  readonly dismissCapped: () => void;
  readonly retry: () => void;
  /** Write the held blob to the owner's downloads. The recording survives the deployment failing. */
  readonly save: () => void;
};

/** `12:34`, or `1:02:03` once a meeting runs past the hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = total >= 3600 ? String(Math.floor(total / 60) % 60).padStart(2, "0") : String(Math.floor(total / 60));
  return total >= 3600 ? `${Math.floor(total / 3600)}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

/** The size as it grows, in the same units the studio reports an uploaded recording in. */
export function formatRecordedSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

export function MeetingRecorderPanel({
  view,
  disabled = false,
  clip,
}: {
  view: MeetingRecorderView;
  disabled?: boolean;
  clip?: MeetingClipView;
}): React.JSX.Element | null {
  if (!view.supported) {
    return (
      <p className="text-xs text-[var(--text-3)]" data-testid="meeting-record-unsupported">
        {t("meeting.record.errors.unsupported_browser")}
      </p>
    );
  }

  const live = view.status === "recording" || view.status === "paused";
  const busy = live || view.status === "requesting-permission" || view.status === "stopping";

  return (
    <div className="flex flex-col gap-2" data-testid="meeting-recorder">
      <div className="flex flex-wrap items-center gap-2">
        {!busy ? (
          <button
            type="button"
            onClick={view.start}
            disabled={disabled}
            className="inline-flex h-9 items-center gap-2 rounded-pill border border-[var(--line)] px-4 text-sm disabled:opacity-45"
            data-testid="meeting-record-start"
          >
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--danger)]" />
            {t("meeting.record.start")}
          </button>
        ) : null}

        {view.status === "requesting-permission" ? (
          <span className="text-sm text-[var(--text-2)]" data-testid="meeting-record-requesting">
            {t("meeting.record.requesting")}
          </span>
        ) : null}

        {live ? (
          <>
            <span
              className="inline-flex items-center gap-2 text-sm tabular-nums text-[var(--text)]"
              role="timer"
              aria-live="off"
              data-testid="meeting-record-timer"
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  view.status === "recording" ? "bg-[var(--danger)]" : "bg-[var(--text-3)]"
                }`}
              />
              {formatElapsed(view.elapsedMs)}
            </span>
            <span className="text-xs text-[var(--text-3)]" data-testid="meeting-record-size">
              {formatRecordedSize(view.bytes)}
            </span>
            {view.status === "recording" ? (
              <button
                type="button"
                onClick={view.pause}
                className="inline-flex h-9 items-center rounded-pill border border-[var(--line)] px-4 text-sm"
                data-testid="meeting-record-pause"
              >
                {t("meeting.record.pause")}
              </button>
            ) : (
              <button
                type="button"
                onClick={view.resume}
                className="inline-flex h-9 items-center rounded-pill border border-[var(--line)] px-4 text-sm"
                data-testid="meeting-record-resume"
              >
                {t("meeting.record.resume")}
              </button>
            )}
            <button
              type="button"
              onClick={view.stop}
              className="wash inline-flex h-9 items-center rounded-pill bg-[var(--accent)] px-4 text-sm font-medium text-[var(--surface)]"
              data-testid="meeting-record-stop"
            >
              {t("meeting.record.stop")}
            </button>
          </>
        ) : null}

        {view.status === "stopping" ? (
          <span className="text-sm text-[var(--text-2)]" data-testid="meeting-record-stopping">
            {t("meeting.record.stopping")}
          </span>
        ) : null}
      </div>

      {!busy ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="meeting-record-source">
          <span className="text-xs text-[var(--text-3)]">{t("meeting.record.source")}</span>
          {SOURCES.map((source) => (
            <button
              key={source}
              type="button"
              onClick={() => view.setSource(source)}
              aria-pressed={view.source === source}
              className={`rounded-pill px-3 py-1 text-xs ${
                view.source === source
                  ? "bg-[var(--surface-2)] text-[var(--text)]"
                  : "border border-[var(--line)] text-[var(--text-2)]"
              }`}
              data-testid={source === "mic" ? "meeting-record-source-mic" : "meeting-record-source-tab"}
            >
              {source === "mic" ? t("meeting.record.sourceMic") : t("meeting.record.sourceTab")}
            </button>
          ))}
        </div>
      ) : null}

      {!busy && view.source === "mic+tab" ? (
        <p className="text-xs text-[var(--text-3)]" data-testid="meeting-record-tab-hint">
          {t("meeting.record.sourceTabHint")}
        </p>
      ) : null}

      {clip?.capped ? (
        <p className="text-xs text-[var(--text-2)]" role="status" data-testid="meeting-record-capped">
          {t("meeting.record.capped")}{" "}
          <button
            type="button"
            onClick={clip.dismissCapped}
            className="underline"
            data-testid="meeting-record-capped-dismiss"
          >
            {t("meeting.record.dismiss")}
          </button>
        </p>
      ) : null}

      {clip?.status === "queued" ? (
        <p className="text-xs text-[var(--text-2)]" role="status" data-testid="meeting-clip-queued">
          {t("meeting.record.queued")}
        </p>
      ) : null}

      {clip?.status === "failed" ? (
        <div className="flex flex-wrap items-center gap-2 text-xs" role="alert" data-testid="meeting-clip-failed">
          <span className="text-[var(--danger)]">{t("meeting.record.uploadFailed")}</span>
          {clip.errorMessage ? (
            <span className="text-[var(--text-3)]" data-testid="meeting-clip-detail">
              {clip.errorMessage}
            </span>
          ) : null}
          <button
            type="button"
            onClick={clip.retry}
            className="inline-flex h-7 items-center rounded-pill border border-[var(--line)] px-3"
            data-testid="meeting-clip-retry"
          >
            {t("meeting.record.retryUpload")}
          </button>
          <button
            type="button"
            onClick={clip.save}
            className="inline-flex h-7 items-center rounded-pill border border-[var(--line)] px-3"
            data-testid="meeting-clip-save"
          >
            {t("meeting.record.saveToDevice")}
          </button>
        </div>
      ) : null}

      {view.errorCode ? (
        <p className="text-xs text-[var(--danger)]" role="alert" data-testid="meeting-record-error">
          {t(`meeting.record.errors.${view.errorCode}`)}{" "}
          <button type="button" onClick={view.clearError} className="underline" data-testid="meeting-record-dismiss">
            {t("meeting.record.dismiss")}
          </button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Meeting mode — getting a finished recording off the machine it was made on.
 *
 * WHY THIS EXISTS. The studio used to hand a clip straight to its upload function and call
 * `clearClip()` **first**, so the only copy of the bytes was gone before the POST was made. Every
 * way that POST could fail — a 413, a 401 on a session that ended mid-meeting, an offline laptop,
 * an upload that arrived while another one was still running — ended the same way: a silent return,
 * an empty error banner and an hour of audio that no longer existed anywhere. A recording is the
 * one thing in this app that cannot be produced again.
 *
 * So the clip is held HERE, by this controller, until the host has answered `2xx`:
 *
 * - **Nothing is cleared on hope.** `offer()` takes ownership of the clip and only `pending: null`
 *   after a successful POST releases it.
 * - **Busy is a queue, not a bin.** A clip that arrives while an upload or a create is in flight
 *   waits (`queued`) and goes out when the studio says it is no longer blocked.
 * - **A failure keeps the bytes and offers two ways out.** `retry()` posts the same clip again, and
 *   the studio offers Save to device, which writes the blob to the owner's downloads. Neither is
 *   reachable if the clip has already been thrown away, which is why this file exists at all.
 * - **The cap notice outlives the clip.** "Recording stopped at 25 MB" used to be rendered from
 *   `recorder.clip?.capped`, so taking the clip erased the only warning that the recording is
 *   short. It is a flag here now, cleared by a dismissal or by the next recording.
 *
 * Framework-free, like `meeting-recorder.ts` next door: the one browser thing it touches is
 * `apiFetch`, which is a parameter with a default. `use-meeting-upload.ts` is the React skin and
 * `meeting-upload.test.ts` drives all of it in node.
 *
 * Map: `docs/internal/maps/meeting-minutes.md` (§ Recording).
 */

import { apiFetch } from "@/lib/api-client";
import { t } from "@/lib/i18n";
import { recordedClipToFile, type RecordedClip } from "./meeting-recorder";

/** The slice of `apiFetch` this file uses, so a test can hand it a stub. */
export type MeetingApiFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A POST that either landed, with the meeting the host answered, or did not, with something to read. */
export type UploadOutcome = { readonly ok: true; readonly meeting: unknown } | { readonly ok: false; readonly message: string };

export type MeetingUploadStatus = "idle" | "queued" | "uploading" | "failed";

export type MeetingUploadState = {
  /** The clip this controller is holding. Non-null means the bytes exist nowhere else. */
  readonly pending: RecordedClip | null;
  readonly status: MeetingUploadStatus;
  /** What the host or the network said, for the failure banner. Null unless `status` is `failed`. */
  readonly errorMessage: string | null;
  /** The last recording stopped at the size cap. Survives the clip, until dismissed or replaced. */
  readonly capped: boolean;
};

export const IDLE_UPLOAD_STATE: MeetingUploadState = {
  pending: null,
  status: "idle",
  errorMessage: null,
  capped: false,
};

/** The one thing the controller cannot do itself: send a file and say whether it landed. */
export type MeetingUploadDeps = {
  readonly send: (file: File) => Promise<UploadOutcome>;
};

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

/**
 * The one place a recording is posted: the same route, the same `file` field and the same multipart
 * body the file input has always used, so the host's caps, its tenancy scoping and the `merge` that
 * lights up Run are identical for a recording and for a chosen file.
 *
 * `res.ok` is checked **before** the body is read. Reading `res.json()` first, as this did, turned
 * an html error page or an empty 502 into a `SyntaxError` thrown out of an upload with no `catch`
 * anywhere above it — an unhandled rejection instead of a message, with the clip already gone.
 */
export async function postMeetingRecording(
  meetingId: string,
  file: File,
  fetcher: MeetingApiFetch = apiFetch,
): Promise<UploadOutcome> {
  const form = new FormData();
  form.set("file", file, file.name);
  let res: Response;
  try {
    res = await fetcher(`/api/v1/meetings/${meetingId}/recording`, { method: "POST", body: form });
  } catch (error) {
    // Offline, aborted, DNS: the clip is still here, which is the whole point.
    return { ok: false, message: error instanceof Error ? error.message : t("meeting.errors.upload") };
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    return { ok: false, message: errorMessage(payload, t("meeting.errors.upload")) };
  }
  try {
    return { ok: true, meeting: await res.json() };
  } catch {
    // A 2xx the host could not serialise. The recording is stored — say so rather than keeping a
    // clip the owner would upload twice.
    return { ok: true, meeting: null };
  }
}

/**
 * Holds one recording until it is safely on the server.
 *
 * State is replaced, never mutated, and every transition goes through `#set`, so a subscriber sees
 * each one — the same contract as `MeetingRecorderController`.
 */
export class MeetingUploadController {
  readonly #deps: MeetingUploadDeps;
  readonly #listeners = new Set<(state: MeetingUploadState) => void>();
  #state: MeetingUploadState = IDLE_UPLOAD_STATE;
  /** True while the studio cannot take an upload: another one is running, or no meeting is chosen. */
  #blocked = false;
  /** Guards against a second send of the same clip when an effect runs twice (React StrictMode). */
  #inFlight = false;

  constructor(deps: MeetingUploadDeps) {
    this.#deps = deps;
  }

  getState(): MeetingUploadState {
    return this.#state;
  }

  subscribe(listener: (state: MeetingUploadState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Take a finished recording. The caller clears the recorder immediately afterwards: from here on
   * this controller is the only holder of the bytes, and it does not let go until a POST answers.
   */
  offer(clip: RecordedClip): void {
    this.#set({ pending: clip, status: "queued", errorMessage: null, capped: clip.capped });
    void this.#pump();
  }

  /** The studio is busy (or has no meeting selected): queue rather than send. */
  setBlocked(blocked: boolean): void {
    if (this.#blocked === blocked) {
      return;
    }
    this.#blocked = blocked;
    if (!blocked) {
      void this.#pump();
    }
  }

  /** The Retry button on the failure banner: the same clip, one more time. */
  retry(): void {
    if (this.#state.status !== "failed") {
      return;
    }
    this.#set({ ...this.#state, status: "queued", errorMessage: null });
    void this.#pump();
  }

  /** The owner has read the size-cap notice. */
  dismissCapped(): void {
    if (!this.#state.capped) {
      return;
    }
    this.#set({ ...this.#state, capped: false });
  }

  /** A new recording is starting: the previous one's cap notice is no longer about anything. */
  recordingStarted(): void {
    this.dismissCapped();
  }

  // -------------------------------------------------------------------------- internals

  #set(state: MeetingUploadState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  /** Send the pending clip when there is one and nothing is in the way. Safe to call at any time. */
  async #pump(): Promise<void> {
    const clip = this.#state.pending;
    if (!clip || this.#blocked || this.#inFlight || this.#state.status === "failed") {
      return;
    }
    this.#inFlight = true;
    this.#set({ ...this.#state, status: "uploading", errorMessage: null });
    try {
      const outcome = await this.#deps.send(recordedClipToFile(clip));
      if (outcome.ok) {
        this.#set({ ...this.#state, pending: null, status: "idle", errorMessage: null });
      } else {
        this.#set({ ...this.#state, status: "failed", errorMessage: outcome.message });
      }
    } catch (error) {
      // `send` is the studio's closure; a bug in it must not lose the recording either.
      this.#set({
        ...this.#state,
        status: "failed",
        errorMessage: error instanceof Error ? error.message : t("meeting.errors.upload"),
      });
    } finally {
      this.#inFlight = false;
    }
  }
}

/**
 * Hand the clip to the browser's downloads — the second way out of a failed upload.
 *
 * DOM-only and deliberately tiny: everything decidable lives in the controller above. The object
 * URL is revoked on the next turn, once the click has been handled.
 */
export function saveClipToDevice(clip: RecordedClip): void {
  if (typeof document === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return;
  }
  const href = URL.createObjectURL(clip.blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = clip.filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

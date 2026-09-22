/**
 * Meeting mode — recording a meeting in the browser: the constants, types and pure helpers.
 *
 * The studio could only ever take a file that already existed. This is the other half: the owner
 * presses Record, speaks (or shares the tab an online meeting is running in), presses Stop, and the
 * resulting blob goes down the same upload route a chosen file does. Nothing about the host changes.
 *
 * Everything here is either a number with a reason, a structural type, or a function of its
 * arguments — no state and no browser object except behind `browserRecorderDeps()`. The state
 * machine that uses it is `MeetingRecorderController` in `meeting-recorder.ts`, which re-exports
 * this module so callers have one import.
 *
 * Three rules this pair of files exists to keep:
 *
 * 1. **Audio only, always.** `getDisplayMedia` has to be asked for video to offer a tab picker at
 *    all, so the video track is stopped the instant the stream arrives. Nothing ever records it.
 * 2. **Under the host's cap, by construction.** The recording is encoded at a speech bitrate and the
 *    running size is watched, so the upload cannot become a 413 an hour into a meeting.
 * 3. **Nothing stays open.** A microphone track that outlives the recording is an OS recording
 *    indicator that never goes away. Every failure path releases what it opened.
 *
 * Map: `docs/internal/maps/meeting-minutes.md` (§ Recording).
 */

/**
 * The host's own cap, `MEETING_RECORDING_MAX_BYTES` in
 * `packages/host/src/meeting/store-files.ts`, which is itself bounded by `MAX_BODY_BYTES` in
 * `packages/host/src/http-adapter.ts`.
 *
 * **Duplicated deliberately.** The renderer must not import from `@agentforge/host` (that package is
 * the server side; see AGENTS.md "Shell vs app"), and `@agentforge/core` exports no meeting file
 * limit. If the host cap ever moves, this constant moves with it — `meeting-recorder.test.ts` pins
 * the number so the two cannot drift silently.
 */
export const RECORDING_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Stop this far short of the cap. The last `dataavailable` chunk is only measured after it arrives,
 * so without a margin a recording could cross the line between two ticks and be refused on upload.
 */
export const RECORDING_STOP_MARGIN_BYTES = 512 * 1024;

/**
 * Speech, not music. 24 kbps opus is comfortably intelligible for minutes-taking and puts an hour at
 * roughly 10.8 MB — under half the cap, with room for the container.
 */
export const RECORDING_AUDIO_BITS_PER_SECOND = 24_000;

/** Ask the browser for a chunk every second, so the running size is never a second stale. */
export const RECORDING_TIMESLICE_MS = 1_000;

/**
 * In preference order. `audio/webm;codecs=opus` is first because the host stores `audio/webm`
 * (`MEETING_AUDIO_TYPES`) and ffmpeg decodes opus without a second thought. Safari lands on
 * `audio/mp4`, which the host also accepts.
 */
export const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

/** Extensions that agree with `EXT_BY_MIME` in the host's meeting store. */
const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
};

export type RecorderSource = "mic" | "mic+tab";

export type RecorderStatus = "idle" | "requesting-permission" | "recording" | "paused" | "stopping" | "error";

export type RecorderErrorCode =
  | "insecure_context"
  | "unsupported_browser"
  | "permission_denied"
  | "no_device"
  | "display_unsupported"
  | "display_cancelled"
  | "display_no_audio"
  | "recorder_failed"
  | "empty_recording";

export type RecordedClip = {
  readonly blob: Blob;
  readonly mimeType: string;
  readonly bytes: number;
  readonly durationMs: number;
  readonly filename: string;
  /** True when the byte cap stopped the recording rather than the owner. */
  readonly capped: boolean;
};

export type RecorderState = {
  readonly status: RecorderStatus;
  readonly source: RecorderSource;
  readonly errorCode: RecorderErrorCode | null;
  readonly bytes: number;
  readonly clip: RecordedClip | null;
};

/** The slice of `MediaRecorder` this file uses; a fake in tests, the real thing in a browser. */
export interface MediaRecorderLike {
  start(timesliceMs?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onstop: (() => void) | null;
}

export interface TrackLike {
  readonly kind: string;
  stop(): void;
}

export interface StreamLike {
  getTracks(): TrackLike[];
  getAudioTracks(): TrackLike[];
  getVideoTracks(): TrackLike[];
}

export interface AudioContextLike {
  createMediaStreamSource(stream: StreamLike): { connect(destination: unknown): void };
  createMediaStreamDestination(): { stream: StreamLike };
  close(): Promise<void>;
}

export type RecorderDeps = {
  readonly secureContext: boolean;
  readonly getUserMedia: ((constraints: unknown) => Promise<StreamLike>) | null;
  readonly getDisplayMedia: ((constraints: unknown) => Promise<StreamLike>) | null;
  readonly isTypeSupported: (type: string) => boolean;
  readonly createRecorder: (
    stream: StreamLike,
    options: { mimeType: string; audioBitsPerSecond: number },
  ) => MediaRecorderLike;
  readonly createAudioContext: () => AudioContextLike;
  readonly now: () => number;
};

export const IDLE_RECORDER_STATE: RecorderState = {
  status: "idle",
  source: "mic",
  errorCode: null,
  bytes: 0,
  clip: null,
};

// ---------------------------------------------------------------------------- pure helpers

/** The first candidate this browser can actually encode, or null when it can encode none. */
export function pickRecorderMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return RECORDER_MIME_CANDIDATES.find((type) => isTypeSupported(type)) ?? null;
}

export function baseMime(mime: string): string {
  return (mime.split(";")[0] ?? "").trim().toLowerCase();
}

export function extensionForRecordingMime(mime: string): string {
  return EXTENSION_BY_MIME[baseMime(mime)] ?? "webm";
}

/**
 * `recording-2026-09-21T04-05-06.webm`. The colons an ISO timestamp carries would be rewritten by
 * the host's `sanitizeFilename`, so they are replaced here where the result is still readable.
 */
export function recordingFilename(at: Date, mime: string): string {
  const stamp = at
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replace(/:/g, "-");
  return `recording-${stamp}.${extensionForRecordingMime(mime)}`;
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : "";
}

export function mapUserMediaError(error: unknown): RecorderErrorCode {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "permission_denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no_device";
    default:
      return "recorder_failed";
  }
}

export function mapDisplayMediaError(error: unknown): RecorderErrorCode {
  switch (errorName(error)) {
    case "NotAllowedError":
    case "AbortError":
    case "PermissionDeniedError":
      return "display_cancelled";
    case "NotSupportedError":
    case "NotFoundError":
      return "display_unsupported";
    default:
      return "recorder_failed";
  }
}

/** End every track of a stream. The one thing that must never be skipped on any path. */
export function stopTracks(stream: StreamLike): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

/** The bridge to the existing upload path: a clip becomes exactly what the file input produces. */
export function recordedClipToFile(clip: RecordedClip): File {
  return new File([clip.blob], clip.filename, { type: clip.mimeType });
}

/** The browser-backed deps. Every field degrades to a safe absence rather than throwing on access. */
export function browserRecorderDeps(): RecorderDeps {
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  const Recorder = typeof MediaRecorder === "undefined" ? undefined : MediaRecorder;
  const Context =
    typeof AudioContext === "undefined"
      ? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : AudioContext;
  return {
    secureContext: typeof isSecureContext === "boolean" ? isSecureContext : true,
    getUserMedia: devices ? (constraints) => devices.getUserMedia(constraints as MediaStreamConstraints) : null,
    getDisplayMedia:
      devices && typeof devices.getDisplayMedia === "function"
        ? (constraints) => devices.getDisplayMedia(constraints as DisplayMediaStreamOptions)
        : null,
    isTypeSupported: (type) => Boolean(Recorder?.isTypeSupported(type)),
    // One cast at the boundary: the DOM's handler signatures are `this`-typed and wider than the
    // structural slice above, which is all this file ever assigns to.
    createRecorder: (stream, options) =>
      new (Recorder as typeof MediaRecorder)(stream as unknown as MediaStream, options) as unknown as MediaRecorderLike,
    createAudioContext: () => new (Context as typeof AudioContext)() as unknown as AudioContextLike,
    now: () => Date.now(),
  };
}

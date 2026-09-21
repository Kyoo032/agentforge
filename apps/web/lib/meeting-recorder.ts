/**
 * Meeting mode — the recording controller.
 *
 * The state machine over `MediaRecorder`: start, pause, resume, stop, the running byte cap and the
 * release of every track and AudioContext. Constants, types, the pure helpers and the browser-backed
 * `RecorderDeps` live next door in `meeting-recorder-media.ts` and are re-exported here, so the rest
 * of the app has one import to reach for.
 *
 * Framework-free on purpose: every browser object arrives through `RecorderDeps`, so all of this is
 * unit-tested in a node environment. `use-meeting-recorder.ts` is the React skin over it;
 * `components/meeting-recorder.tsx` is the UI.
 *
 * Map: `docs/internal/maps/meeting-minutes.md` (§ Recording).
 */

import {
  IDLE_RECORDER_STATE,
  RECORDING_AUDIO_BITS_PER_SECOND,
  RECORDING_MAX_BYTES,
  RECORDING_STOP_MARGIN_BYTES,
  RECORDING_TIMESLICE_MS,
  baseMime,
  mapDisplayMediaError,
  mapUserMediaError,
  pickRecorderMimeType,
  recordingFilename,
  stopTracks,
  type AudioContextLike,
  type MediaRecorderLike,
  type RecorderDeps,
  type RecorderErrorCode,
  type RecorderSource,
  type RecorderState,
  type StreamLike,
} from "./meeting-recorder-media";

// One import for callers: the constants, types and helpers travel with the controller.
export * from "./meeting-recorder-media";

// ---------------------------------------------------------------------------- the controller

/**
 * One recording at a time. State is replaced, never mutated, and every transition goes through
 * `#set` so a subscriber sees each one.
 */
export class MeetingRecorderController {
  readonly #deps: RecorderDeps;
  readonly #listeners = new Set<(state: RecorderState) => void>();
  #state: RecorderState = IDLE_RECORDER_STATE;
  #recorder: MediaRecorderLike | null = null;
  #mic: StreamLike | null = null;
  #display: StreamLike | null = null;
  #context: AudioContextLike | null = null;
  #chunks: Blob[] = [];
  #mimeType = "";
  #accumulatedMs = 0;
  #resumedAt: number | null = null;
  #capped = false;
  /**
   * Bumped by every `start()` and by `dispose()`. An async step that resolves after its generation
   * has been superseded releases what it opened and reports nothing.
   *
   * This replaces a "disposed" flag, which could not survive React StrictMode: the hook holds one
   * controller in a ref across the deliberate mount → unmount → mount, so a terminal flag left
   * Record inert with no error at all. Generations make dispose an ordinary boundary, not a death.
   */
  #generation = 0;

  constructor(deps: RecorderDeps) {
    this.#deps = deps;
  }

  getState(): RecorderState {
    return this.#state;
  }

  subscribe(listener: (state: RecorderState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Wall-clock time spent recording, with paused stretches excluded. */
  elapsedMs(): number {
    const live = this.#resumedAt === null ? 0 : this.#deps.now() - this.#resumedAt;
    return this.#accumulatedMs + live;
  }

  async start(source: RecorderSource): Promise<void> {
    if (this.#state.status === "recording" || this.#state.status === "paused") {
      return;
    }
    const generation = this.#begin();
    this.#set({ ...IDLE_RECORDER_STATE, status: "requesting-permission", source });

    const precondition = this.#checkPreconditions(source);
    if (precondition) {
      this.#fail(generation, precondition);
      return;
    }
    const mimeType = pickRecorderMimeType(this.#deps.isTypeSupported);
    if (!mimeType) {
      this.#fail(generation, "unsupported_browser");
      return;
    }

    let mic: StreamLike;
    try {
      mic = await this.#openMicrophone();
    } catch (error) {
      this.#fail(generation, mapUserMediaError(error));
      return;
    }
    if (generation !== this.#generation) {
      // Unmounted, or a newer start now owns the hardware: give this grant straight back.
      stopTracks(mic);
      return;
    }
    this.#mic = mic;

    let stream: StreamLike = mic;
    if (source === "mic+tab") {
      const mixed = await this.#mixInDisplayAudio(generation, mic);
      if (!mixed) {
        return; // #mixInDisplayAudio has already failed and released.
      }
      stream = mixed;
    }

    try {
      this.#startRecorder(stream, mimeType, generation);
    } catch (error) {
      this.#fail(generation, mapUserMediaError(error));
      return;
    }
    this.#mimeType = mimeType;
    this.#accumulatedMs = 0;
    this.#resumedAt = this.#deps.now();
    this.#set({ ...this.#state, status: "recording", errorCode: null });
  }

  pause(): void {
    if (this.#state.status !== "recording" || !this.#recorder) {
      return;
    }
    this.#recorder.pause();
    this.#accumulatedMs = this.elapsedMs();
    this.#resumedAt = null;
    this.#set({ ...this.#state, status: "paused" });
  }

  resume(): void {
    if (this.#state.status !== "paused" || !this.#recorder) {
      return;
    }
    this.#recorder.resume();
    this.#resumedAt = this.#deps.now();
    this.#set({ ...this.#state, status: "recording" });
  }

  /** Ask the recorder to stop; the clip arrives through state when `onstop` fires. */
  stop(): void {
    if (this.#state.status !== "recording" && this.#state.status !== "paused") {
      return;
    }
    this.#accumulatedMs = this.elapsedMs();
    this.#resumedAt = null;
    this.#set({ ...this.#state, status: "stopping" });
    this.#recorder?.stop();
  }

  /** The studio calls this once it has uploaded the clip, so the same bytes are not sent twice. */
  clearClip(): void {
    if (!this.#state.clip) {
      return;
    }
    this.#set({ ...this.#state, clip: null, bytes: 0 });
  }

  /** Dismiss an error without starting again. */
  clearError(): void {
    if (this.#state.status !== "error") {
      return;
    }
    this.#set({ ...IDLE_RECORDER_STATE, source: this.#state.source });
  }

  /**
   * Unmount. Everything opened is closed and every in-flight step is orphaned. The controller
   * itself stays usable: StrictMode disposes and remounts the same instance on purpose.
   */
  dispose(): void {
    this.#begin();
    this.#state = { ...IDLE_RECORDER_STATE, source: this.#state.source };
    this.#listeners.clear();
  }

  // -------------------------------------------------------------------------- internals

  /** Open a new generation: release the last one's hardware and orphan its pending steps. */
  #begin(): number {
    this.#generation += 1;
    this.#release();
    this.#chunks = [];
    this.#accumulatedMs = 0;
    this.#capped = false;
    this.#mimeType = "";
    return this.#generation;
  }

  #set(state: RecorderState): void {
    this.#state = state;
    for (const listener of this.#listeners) {
      listener(state);
    }
  }

  #checkPreconditions(source: RecorderSource): RecorderErrorCode | null {
    if (!this.#deps.secureContext) {
      return "insecure_context";
    }
    if (!this.#deps.getUserMedia) {
      return "unsupported_browser";
    }
    if (source === "mic+tab" && !this.#deps.getDisplayMedia) {
      return "display_unsupported";
    }
    return null;
  }

  async #openMicrophone(): Promise<StreamLike> {
    const getUserMedia = this.#deps.getUserMedia;
    if (!getUserMedia) {
      throw { name: "NotSupportedError" };
    }
    return getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  }

  /**
   * Ask for the tab/screen, throw its video away, and sum the two audio graphs into one stream so
   * the remote voices of an online meeting land in the same recording as the owner's microphone.
   */
  async #mixInDisplayAudio(generation: number, mic: StreamLike): Promise<StreamLike | null> {
    const getDisplayMedia = this.#deps.getDisplayMedia;
    if (!getDisplayMedia) {
      this.#fail(generation, "display_unsupported");
      return null;
    }
    let display: StreamLike;
    try {
      display = await getDisplayMedia({ video: true, audio: true });
    } catch (error) {
      this.#fail(generation, mapDisplayMediaError(error));
      return null;
    }
    // The picker needs a video request to offer a tab at all; nothing here ever wants the pixels.
    for (const track of display.getVideoTracks()) {
      track.stop();
    }
    if (generation !== this.#generation) {
      stopTracks(display);
      return null;
    }
    this.#display = display;
    if (display.getAudioTracks().length === 0) {
      this.#fail(generation, "display_no_audio");
      return null;
    }
    try {
      const context = this.#deps.createAudioContext();
      this.#context = context;
      const destination = context.createMediaStreamDestination();
      context.createMediaStreamSource(mic).connect(destination);
      context.createMediaStreamSource(display).connect(destination);
      return destination.stream;
    } catch (error) {
      this.#fail(generation, mapUserMediaError(error));
      return null;
    }
  }

  #startRecorder(stream: StreamLike, mimeType: string, generation: number): void {
    const recorder = this.#deps.createRecorder(stream, {
      mimeType,
      audioBitsPerSecond: RECORDING_AUDIO_BITS_PER_SECOND,
    });
    this.#recorder = recorder;
    this.#chunks = [];
    this.#capped = false;
    recorder.ondataavailable = (event) => this.#onChunk(generation, event.data);
    recorder.onerror = () => this.#fail(generation, "recorder_failed");
    recorder.onstop = () => this.#onStopped(generation);
    recorder.start(RECORDING_TIMESLICE_MS);
  }

  #onChunk(generation: number, data: Blob): void {
    if (!data || data.size === 0 || generation !== this.#generation) {
      return;
    }
    this.#chunks = [...this.#chunks, data];
    const bytes = this.#state.bytes + data.size;
    this.#set({ ...this.#state, bytes });
    if (bytes >= RECORDING_MAX_BYTES - RECORDING_STOP_MARGIN_BYTES && !this.#capped) {
      // Stop ourselves while the bytes still fit, rather than letting the host answer 413.
      this.#capped = true;
      this.stop();
    }
  }

  #onStopped(generation: number): void {
    if (generation !== this.#generation) {
      return;
    }
    const chunks = this.#chunks;
    const bytes = chunks.reduce((total, chunk) => total + chunk.size, 0);
    const durationMs = this.#accumulatedMs;
    const capped = this.#capped;
    const mimeType = this.#mimeType;
    this.#release();
    if (bytes === 0) {
      this.#set({ ...IDLE_RECORDER_STATE, source: this.#state.source, status: "error", errorCode: "empty_recording" });
      return;
    }
    const blob = new Blob(chunks, { type: baseMime(mimeType) });
    this.#set({
      ...IDLE_RECORDER_STATE,
      source: this.#state.source,
      status: "idle",
      bytes,
      clip: { blob, mimeType, bytes, durationMs, filename: recordingFilename(new Date(), mimeType), capped },
    });
  }

  #fail(generation: number, code: RecorderErrorCode): void {
    // A superseded generation's hardware was already released by whoever superseded it.
    if (generation !== this.#generation) {
      return;
    }
    this.#release();
    this.#set({ ...IDLE_RECORDER_STATE, source: this.#state.source, status: "error", errorCode: code });
  }

  /** Close everything this controller opened. Safe to call twice. */
  #release(): void {
    const recorder = this.#recorder;
    this.#recorder = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      try {
        // Unmounting mid-recording: end the encoder too, not just its handlers.
        recorder.stop();
      } catch {
        // Already inactive — `stop()` on an inactive MediaRecorder throws, and that is fine.
      }
    }
    for (const stream of [this.#mic, this.#display]) {
      if (stream) {
        stopTracks(stream);
      }
    }
    this.#mic = null;
    this.#display = null;
    const context = this.#context;
    this.#context = null;
    // A close() that rejects (already closed, or a context the browser tore down) costs nothing.
    void context?.close().catch(() => {});
    this.#resumedAt = null;
  }
}

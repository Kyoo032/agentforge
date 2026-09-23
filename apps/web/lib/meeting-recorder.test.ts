/**
 * The meeting recorder engine, driven against a faked MediaRecorder and a faked mediaDevices.
 *
 * Everything here is the part of "record a meeting" that has no browser in it: which mime type is
 * picked, what a DOMException from getUserMedia means to the owner, when the byte cap stops the
 * recording on its own, and — the one that actually matters on a laptop — whether every track and
 * every AudioContext is released on stop, on failure, and on unmount. A leaked microphone track is
 * an OS-level recording indicator that never goes away, and no assertion about state transitions
 * catches it, so each path below checks the tracks it opened.
 *
 * What this cannot cover: that a real browser grants the permission, that getDisplayMedia's picker
 * offers "this tab", and that the resulting webm is something ffmpeg can decode. Those need a
 * human or a browser-automation pass.
 */
import { describe, expect, it, vi } from "vitest";
import {
  MeetingRecorderController,
  RECORDING_MAX_BYTES,
  RECORDING_STOP_MARGIN_BYTES,
  extensionForRecordingMime,
  mapDisplayMediaError,
  mapUserMediaError,
  pickRecorderMimeType,
  recordedClipToFile,
  recordingFilename,
  type MediaRecorderLike,
  type RecorderDeps,
} from "./meeting-recorder";

// ---------------------------------------------------------------------------- fakes

class FakeTrack {
  stopped = false;
  constructor(readonly kind: "audio" | "video") {}
  stop(): void {
    this.stopped = true;
  }
}

class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }
}

function micStream(): FakeStream {
  return new FakeStream([new FakeTrack("audio")]);
}

function displayStream(withAudio = true): FakeStream {
  const tracks = [new FakeTrack("video")];
  if (withAudio) {
    tracks.push(new FakeTrack("audio"));
  }
  return new FakeStream(tracks);
}

class FakeRecorder implements MediaRecorderLike {
  state: "inactive" | "recording" | "paused" = "inactive";
  timeslice: number | undefined;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    readonly stream: unknown,
    readonly options: { mimeType?: string; audioBitsPerSecond?: number },
  ) {}

  start(timeslice?: number): void {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  pause(): void {
    this.state = "paused";
  }
  resume(): void {
    this.state = "recording";
  }
  stop(): void {
    this.state = "inactive";
    this.onstop?.();
  }
  /** What the browser does every `timeslice` ms: hand over one encoded chunk. */
  emit(bytes: number): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: "audio/webm" }) });
  }
}

class FakeAudioContext {
  closed = false;
  readonly connected: unknown[] = [];
  readonly destination = { stream: new FakeStream([new FakeTrack("audio")]) };
  createMediaStreamSource(stream: unknown) {
    this.connected.push(stream);
    return { connect: () => {} };
  }
  createMediaStreamDestination() {
    return this.destination;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

type Harness = {
  deps: RecorderDeps;
  recorders: FakeRecorder[];
  contexts: FakeAudioContext[];
  mic: FakeStream;
  display: FakeStream;
  clock: { value: number };
};

function harness(overrides: Partial<RecorderDeps> = {}, display = displayStream()): Harness {
  const recorders: FakeRecorder[] = [];
  const contexts: FakeAudioContext[] = [];
  const mic = micStream();
  const clock = { value: 1_000 };
  const deps: RecorderDeps = {
    secureContext: true,
    getUserMedia: async () => mic as never,
    getDisplayMedia: async () => display as never,
    isTypeSupported: (type) => type.startsWith("audio/webm"),
    createRecorder: (stream, options) => {
      const recorder = new FakeRecorder(stream, options);
      recorders.push(recorder);
      return recorder;
    },
    createAudioContext: () => {
      const context = new FakeAudioContext();
      contexts.push(context);
      return context as never;
    },
    now: () => clock.value,
    ...overrides,
  };
  return { deps, recorders, contexts, mic, display, clock };
}

/** Everything the controller opened must be closed; this is the leak check. */
function allTracksStopped(...streams: FakeStream[]): boolean {
  return streams.every((stream) => stream.getTracks().every((track) => track.stopped));
}

// ---------------------------------------------------------------------------- pure helpers

describe("pickRecorderMimeType", () => {
  it("prefers webm/opus, which is what the host stores as audio/webm", () => {
    expect(pickRecorderMimeType(() => true)).toBe("audio/webm;codecs=opus");
  });

  it("falls back down the list when the head is unsupported", () => {
    expect(pickRecorderMimeType((type) => type === "audio/mp4")).toBe("audio/mp4");
  });

  it("returns null when the browser supports none of them, rather than guessing", () => {
    expect(pickRecorderMimeType(() => false)).toBeNull();
  });
});

describe("extensionForRecordingMime", () => {
  it("maps each candidate to the extension the host's EXT_BY_MIME agrees with", () => {
    expect(extensionForRecordingMime("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForRecordingMime("audio/ogg;codecs=opus")).toBe("ogg");
    expect(extensionForRecordingMime("audio/mp4")).toBe("m4a");
  });

  it("falls back to webm for an unknown type instead of an empty extension", () => {
    expect(extensionForRecordingMime("audio/exotic")).toBe("webm");
  });
});

describe("recordingFilename", () => {
  it("is recording-<iso>.<ext> with no colons, so the host's sanitizer keeps it readable", () => {
    const name = recordingFilename(new Date("2026-09-21T04:05:06.000Z"), "audio/webm;codecs=opus");
    expect(name).toBe("recording-2026-09-21T04-05-06.webm");
    expect(name).not.toMatch(/[:]/);
  });
});

describe("mapUserMediaError", () => {
  it("separates a refused permission from a missing microphone", () => {
    expect(mapUserMediaError({ name: "NotAllowedError" })).toBe("permission_denied");
    expect(mapUserMediaError({ name: "SecurityError" })).toBe("permission_denied");
    expect(mapUserMediaError({ name: "NotFoundError" })).toBe("no_device");
    expect(mapUserMediaError({ name: "OverconstrainedError" })).toBe("no_device");
  });

  it("calls anything else a recorder failure rather than blaming the owner", () => {
    expect(mapUserMediaError(new Error("boom"))).toBe("recorder_failed");
  });
});

describe("mapDisplayMediaError", () => {
  it("reads a refused share as a cancelled picker, not as a denied microphone", () => {
    expect(mapDisplayMediaError({ name: "NotAllowedError" })).toBe("display_cancelled");
    expect(mapDisplayMediaError({ name: "AbortError" })).toBe("display_cancelled");
    expect(mapDisplayMediaError({ name: "NotSupportedError" })).toBe("display_unsupported");
  });
});

describe("recordedClipToFile", () => {
  it("hands the upload path a File with the recording's own name and type", () => {
    const blob = new Blob([new Uint8Array(8)], { type: "audio/webm" });
    const file = recordedClipToFile({
      blob,
      mimeType: "audio/webm;codecs=opus",
      bytes: 8,
      durationMs: 1000,
      filename: "recording-2026-09-21T04-05-06.webm",
      capped: false,
    });
    expect(file.name).toBe("recording-2026-09-21T04-05-06.webm");
    expect(file.size).toBe(8);
    // The host sniffs the mime, not the extension, and splits on ";" — a parameterised type is fine.
    expect(file.type).toBe("audio/webm;codecs=opus");
  });
});

// ---------------------------------------------------------------------------- the controller

describe("MeetingRecorderController — preconditions", () => {
  it("refuses an insecure context before it asks for a microphone", async () => {
    const { deps } = harness({ secureContext: false, getUserMedia: vi.fn() });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().errorCode).toBe("insecure_context");
    expect(deps.getUserMedia).not.toHaveBeenCalled();
  });

  it("refuses a browser with no getUserMedia", async () => {
    const { deps } = harness({ getUserMedia: null });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    expect(controller.getState().errorCode).toBe("unsupported_browser");
  });

  it("refuses a browser whose MediaRecorder supports no audio type", async () => {
    const { deps } = harness({ isTypeSupported: () => false });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    expect(controller.getState().errorCode).toBe("unsupported_browser");
  });

  it("refuses mic + tab audio when the browser has no getDisplayMedia", async () => {
    const { deps } = harness({ getDisplayMedia: null });
    const getUserMedia = vi.fn(deps.getUserMedia as NonNullable<RecorderDeps["getUserMedia"]>);
    const controller = new MeetingRecorderController({ ...deps, getUserMedia });
    await controller.start("mic+tab");
    expect(controller.getState().errorCode).toBe("display_unsupported");
    // Checked before anything is opened, so the owner is never asked for a microphone it cannot use.
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

describe("MeetingRecorderController — microphone only", () => {
  it("walks idle → requesting-permission → recording and asks for audio alone", async () => {
    const seen: string[] = [];
    const { deps, recorders } = harness();
    const getUserMedia = vi.fn(deps.getUserMedia as NonNullable<RecorderDeps["getUserMedia"]>);
    const controller = new MeetingRecorderController({ ...deps, getUserMedia });
    controller.subscribe((state) => seen.push(state.status));
    const started = controller.start("mic");
    expect(controller.getState().status).toBe("requesting-permission");
    await started;
    expect(controller.getState().status).toBe("recording");
    expect(seen).toEqual(["requesting-permission", "recording"]);
    const constraints = getUserMedia.mock.calls[0]?.[0] as { audio?: unknown; video?: unknown };
    expect(constraints.video).toBe(false);
    expect(constraints.audio).toBeTruthy();
    expect(recorders).toHaveLength(1);
    expect(recorders[0]?.options.mimeType).toBe("audio/webm;codecs=opus");
  });

  it("encodes at a speech bitrate so an hour stays under the host's 25 MB cap", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    const bitrate = recorders[0]?.options.audioBitsPerSecond ?? 0;
    expect(bitrate).toBeGreaterThanOrEqual(16_000);
    expect(bitrate).toBeLessThanOrEqual(32_000);
    // An hour at that bitrate, with the container overhead the host also has to carry.
    expect((bitrate / 8) * 3600).toBeLessThan(RECORDING_MAX_BYTES);
  });

  it("asks for a chunk every second so the running size is known before the cap is hit", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    expect(recorders[0]?.timeslice).toBeGreaterThan(0);
    expect(recorders[0]?.timeslice).toBeLessThanOrEqual(2000);
  });

  it("does not open an AudioContext when there is nothing to mix", async () => {
    const { deps, contexts } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    expect(contexts).toHaveLength(0);
  });

  it("reports a denied permission and never reaches the recorder", async () => {
    const { deps, recorders, contexts } = harness({
      getUserMedia: async () => {
        throw { name: "NotAllowedError", message: "denied" };
      },
    });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().errorCode).toBe("permission_denied");
    // getUserMedia rejected, so there is no stream to release — but nothing may have been built on it.
    expect(recorders).toHaveLength(0);
    expect(contexts).toHaveLength(0);
  });

  it("reports a missing device", async () => {
    const { deps } = harness({
      getUserMedia: async () => {
        throw { name: "NotFoundError" };
      },
    });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    expect(controller.getState().errorCode).toBe("no_device");
  });

  it("starts again after an error without needing a new controller", async () => {
    let fail = true;
    const mic = micStream();
    const { deps } = harness({
      getUserMedia: async () => {
        if (fail) {
          throw { name: "NotAllowedError" };
        }
        return mic as never;
      },
    });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    expect(controller.getState().status).toBe("error");
    fail = false;
    await controller.start("mic");
    expect(controller.getState().status).toBe("recording");
    expect(controller.getState().errorCode).toBeNull();
  });
});

describe("MeetingRecorderController — pause, resume, elapsed", () => {
  it("pauses and resumes the underlying recorder", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    controller.pause();
    expect(controller.getState().status).toBe("paused");
    expect(recorders[0]?.state).toBe("paused");
    controller.resume();
    expect(controller.getState().status).toBe("recording");
    expect(recorders[0]?.state).toBe("recording");
  });

  it("ignores pause when it is not recording and resume when it is not paused", async () => {
    const { deps } = harness();
    const controller = new MeetingRecorderController(deps);
    controller.pause();
    expect(controller.getState().status).toBe("idle");
    await controller.start("mic");
    controller.resume();
    expect(controller.getState().status).toBe("recording");
  });

  it("does not count paused time as elapsed", async () => {
    const { deps, clock } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    clock.value += 5_000;
    expect(controller.elapsedMs()).toBe(5_000);
    controller.pause();
    clock.value += 60_000;
    expect(controller.elapsedMs()).toBe(5_000);
    controller.resume();
    clock.value += 2_000;
    expect(controller.elapsedMs()).toBe(7_000);
  });
});

describe("MeetingRecorderController — stop", () => {
  it("returns one blob, the running byte count and the duration, and releases the microphone", async () => {
    const { deps, recorders, clock, mic } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(4_000);
    clock.value += 3_000;
    recorders[0]?.emit(6_000);
    expect(controller.getState().bytes).toBe(10_000);
    controller.stop();
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    const clip = controller.getState().clip;
    expect(clip?.bytes).toBe(10_000);
    expect(clip?.blob.size).toBe(10_000);
    expect(clip?.durationMs).toBe(3_000);
    expect(clip?.capped).toBe(false);
    expect(clip?.filename).toMatch(/^recording-.*\.webm$/);
    expect(allTracksStopped(mic)).toBe(true);
  });

  it("reports an empty recording instead of uploading a zero-byte file", async () => {
    const { deps } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    controller.stop();
    await vi.waitFor(() => expect(controller.getState().status).toBe("error"));
    expect(controller.getState().errorCode).toBe("empty_recording");
    expect(controller.getState().clip).toBeNull();
  });

  it("clears the clip once the studio has taken it", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(2_000);
    controller.stop();
    await vi.waitFor(() => expect(controller.getState().clip).not.toBeNull());
    controller.clearClip();
    expect(controller.getState().clip).toBeNull();
    expect(controller.getState().bytes).toBe(0);
  });

  it("surfaces a MediaRecorder error and releases everything", async () => {
    const { deps, recorders, mic } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.onerror?.({ error: new Error("encoder died") });
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().errorCode).toBe("recorder_failed");
    expect(allTracksStopped(mic)).toBe(true);
  });
});

describe("MeetingRecorderController — the 25 MB cap", () => {
  it("stops on its own before the host would answer 413, and keeps what it captured", async () => {
    const { deps, recorders, mic } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    const recorder = recorders[0];
    recorder?.emit(RECORDING_MAX_BYTES - RECORDING_STOP_MARGIN_BYTES - 1_000);
    expect(controller.getState().status).toBe("recording");
    recorder?.emit(2_000);
    await vi.waitFor(() => expect(controller.getState().clip).not.toBeNull());
    const clip = controller.getState().clip;
    expect(clip?.capped).toBe(true);
    expect(clip?.bytes).toBeLessThan(RECORDING_MAX_BYTES);
    expect(allTracksStopped(mic)).toBe(true);
  });

  it("leaves a margin under the host cap rather than racing it exactly", () => {
    expect(RECORDING_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(RECORDING_STOP_MARGIN_BYTES).toBeGreaterThan(0);
    expect(RECORDING_STOP_MARGIN_BYTES).toBeLessThan(RECORDING_MAX_BYTES / 10);
  });
});

describe("MeetingRecorderController — mic + tab audio", () => {
  it("mixes the two through an AudioContext and stops the shared video immediately", async () => {
    const { deps, contexts, display, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic+tab");
    expect(controller.getState().status).toBe("recording");
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.connected).toHaveLength(2);
    // The video track is never recorded and never left running — it is only the price of the picker.
    expect(display.getVideoTracks().every((track) => track.stopped)).toBe(true);
    expect(display.getAudioTracks().every((track) => track.stopped)).toBe(false);
    expect(recorders[0]?.stream).toBe(contexts[0]?.destination.stream);
  });

  it("refuses a share with no audio and says so, rather than recording silence", async () => {
    const { deps, mic, display } = harness({}, displayStream(false));
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic+tab");
    expect(controller.getState().errorCode).toBe("display_no_audio");
    expect(allTracksStopped(mic, display)).toBe(true);
  });

  it("reports a cancelled picker and releases the microphone it already opened", async () => {
    const { deps, mic } = harness({
      getDisplayMedia: async () => {
        throw { name: "NotAllowedError" };
      },
    });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic+tab");
    expect(controller.getState().errorCode).toBe("display_cancelled");
    expect(allTracksStopped(mic)).toBe(true);
  });

  it("closes the AudioContext and both streams on stop", async () => {
    const { deps, contexts, mic, display, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic+tab");
    recorders[0]?.emit(1_000);
    controller.stop();
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    expect(allTracksStopped(mic, display)).toBe(true);
    expect(contexts[0]?.closed).toBe(true);
  });
});

describe("MeetingRecorderController — dispose", () => {
  it("releases every track and the AudioContext when the studio unmounts mid-recording", async () => {
    const { deps, contexts, mic, display } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic+tab");
    controller.dispose();
    expect(allTracksStopped(mic, display)).toBe(true);
    expect(contexts[0]?.closed).toBe(true);
    expect(controller.getState().status).toBe("idle");
  });

  it("stops notifying subscribers after dispose", async () => {
    const { deps } = harness();
    const controller = new MeetingRecorderController(deps);
    const seen: string[] = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state.status));
    unsubscribe();
    await controller.start("mic");
    expect(seen).toEqual([]);
  });

  /**
   * Caught by driving `/meeting` in a browser, not by any test above. `src/main.tsx` renders under
   * `<StrictMode>`, so React mounts, runs the unmount cleanup, and mounts again against the *same*
   * controller — the hook holds it in a ref. A `dispose()` that killed the controller for good left
   * Record silently inert: the owner pressed it and nothing happened at all, no error, no state.
   */
  it("records again after a dispose, the way StrictMode's mount → unmount → mount requires", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    controller.dispose();
    const seen: string[] = [];
    controller.subscribe((state) => seen.push(state.status));
    await controller.start("mic");
    expect(controller.getState().status).toBe("recording");
    expect(recorders).toHaveLength(1);
    expect(seen).toEqual(["requesting-permission", "recording"]);
  });

  it("releases a stream that only arrives after dispose, instead of recording into a dead studio", async () => {
    const mic = micStream();
    const grants: ((stream: never) => void)[] = [];
    const { deps, recorders } = harness({
      getUserMedia: () =>
        new Promise((resolve) => {
          grants.push(resolve as (stream: never) => void);
        }),
    });
    const controller = new MeetingRecorderController(deps);
    const pending = controller.start("mic");
    controller.dispose();
    grants[0]?.(mic as never);
    await pending;
    expect(allTracksStopped(mic)).toBe(true);
    expect(recorders).toHaveLength(0);
  });

  it("lets a new start cancel an older one still waiting on permission", async () => {
    const first = micStream();
    const second = micStream();
    const grants: ((stream: never) => void)[] = [];
    const { deps, recorders } = harness({
      getUserMedia: () =>
        new Promise((resolve) => {
          grants.push(resolve as (stream: never) => void);
        }),
    });
    const controller = new MeetingRecorderController(deps);
    const stale = controller.start("mic");
    const fresh = controller.start("mic");
    grants[1]?.(second as never);
    grants[0]?.(first as never);
    await Promise.all([stale, fresh]);
    // The abandoned permission grant is released, not left holding the microphone open.
    expect(allTracksStopped(first)).toBe(true);
    expect(recorders).toHaveLength(1);
    expect(recorders[0]?.stream).toBe(second);
  });
});

/**
 * A recorder whose `stop()` behaves like a browser's: it flushes the last chunk and fires `onstop`
 * later, not inside the call. The plain fake above fires it synchronously.
 */
class LateStopRecorder extends FakeRecorder {
  override stop(): void {
    this.state = "inactive";
  }
}

describe("MeetingRecorderController — a recorder that fails mid-recording", () => {
  it("keeps what it had captured as a clip, and still reports the failure", async () => {
    const { deps, recorders, mic, clock } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(4_000);
    clock.value += 2_000;
    recorders[0]?.emit(6_000);
    recorders[0]?.onerror?.({ error: new Error("encoder died") });

    const state = controller.getState();
    expect(state.status).toBe("error");
    expect(state.errorCode).toBe("recorder_failed");
    expect(state.clip?.bytes).toBe(10_000);
    expect(state.clip?.blob.size).toBe(10_000);
    expect(state.clip?.durationMs).toBe(2_000);
    expect(state.clip?.mimeType).toBe("audio/webm;codecs=opus");
    expect(state.clip?.filename).toMatch(/^recording-.*\.webm$/);
    expect(state.bytes).toBe(10_000);
    expect(allTracksStopped(mic)).toBe(true);
  });

  it("has nothing to keep when it failed before the first chunk", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.onerror?.({ error: new Error("encoder died") });

    expect(controller.getState().status).toBe("error");
    expect(controller.getState().clip).toBeNull();
  });

  it("lets the studio take the kept clip while the failure stays on screen", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(3_000);
    recorders[0]?.onerror?.({ error: new Error("encoder died") });
    controller.clearClip();

    expect(controller.getState().clip).toBeNull();
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().errorCode).toBe("recorder_failed");
  });

  it("does not drop a kept clip nobody has taken yet when the error is dismissed", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(3_000);
    recorders[0]?.onerror?.({ error: new Error("encoder died") });
    controller.clearError();

    expect(controller.getState().errorCode).toBeNull();
    expect(controller.getState().clip?.bytes).toBe(3_000);
  });

  it("ignores an error from a recorder a newer recording has replaced", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    const stale = recorders[0];
    const staleOnError = stale?.onerror;
    controller.stop();
    await controller.start("mic");
    recorders[1]?.emit(1_000);
    staleOnError?.({ error: new Error("late") });

    expect(controller.getState().status).toBe("recording");
    expect(controller.getState().bytes).toBe(1_000);
  });
});

describe("MeetingRecorderController — dispose keeps what was recorded", () => {
  it("hands back the audio captured so far when the studio unmounts mid-recording", async () => {
    const { deps, recorders, mic, clock } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(3_000);
    clock.value += 1_500;
    recorders[0]?.emit(2_000);

    const kept = controller.dispose();

    expect(kept?.bytes).toBe(5_000);
    expect(kept?.blob.size).toBe(5_000);
    expect(kept?.durationMs).toBe(1_500);
    expect(kept?.mimeType).toBe("audio/webm;codecs=opus");
    expect(kept?.filename).toMatch(/^recording-.*\.webm$/);
    expect(kept?.capped).toBe(false);
    // Kept, and still nothing left open.
    expect(allTracksStopped(mic)).toBe(true);
    expect(controller.getState().status).toBe("idle");
  });

  it("keeps a paused recording, without counting the pause", async () => {
    const { deps, recorders, clock } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(2_000);
    clock.value += 4_000;
    controller.pause();
    clock.value += 60_000;

    const kept = controller.dispose();

    expect(kept?.bytes).toBe(2_000);
    expect(kept?.durationMs).toBe(4_000);
  });

  it("keeps a recording that was still finishing when the studio went away", async () => {
    const { deps, recorders } = harness({
      createRecorder: (stream, options) => {
        const recorder = new LateStopRecorder(stream, options);
        recorders.push(recorder);
        return recorder;
      },
    });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(7_000);
    controller.stop();
    expect(controller.getState().status).toBe("stopping");

    expect(controller.dispose()?.bytes).toBe(7_000);
  });

  it("hands back a finished clip the studio had not taken yet", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(2_500);
    controller.stop();
    const finished = controller.getState().clip;

    expect(controller.dispose()).toBe(finished);
  });

  it("does not hand back a clip the studio already took, so it is never uploaded twice", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(2_500);
    controller.stop();
    controller.clearClip();

    expect(controller.dispose()).toBeNull();
  });

  it("does not hand back the failed recording's clip once the studio took it", async () => {
    const { deps, recorders } = harness();
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(2_500);
    recorders[0]?.onerror?.({ error: new Error("encoder died") });
    controller.clearClip();

    expect(controller.dispose()).toBeNull();
  });

  it("carries the cap flag with what it keeps", async () => {
    const { deps, recorders } = harness({
      createRecorder: (stream, options) => {
        const recorder = new LateStopRecorder(stream, options);
        recorders.push(recorder);
        return recorder;
      },
    });
    const controller = new MeetingRecorderController(deps);
    await controller.start("mic");
    recorders[0]?.emit(RECORDING_MAX_BYTES - RECORDING_STOP_MARGIN_BYTES + 1);
    expect(controller.getState().status).toBe("stopping");

    expect(controller.dispose()?.capped).toBe(true);
  });

  it("has nothing to hand back when nothing was recorded", async () => {
    const { deps } = harness();
    const idle = new MeetingRecorderController(deps);
    expect(idle.dispose()).toBeNull();

    const silent = new MeetingRecorderController(deps);
    await silent.start("mic");
    expect(silent.dispose()).toBeNull();
  });
});

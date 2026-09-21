"use client";

/**
 * React skin over `MeetingRecorderController`.
 *
 * All the logic — the state machine, the byte cap, the track release — lives in
 * `meeting-recorder.ts` and is tested there without a browser. This file does the three things that
 * are genuinely React's: subscribe to the controller, tick the elapsed clock while it is recording,
 * and dispose it on unmount so a microphone never outlives the studio.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  IDLE_RECORDER_STATE,
  MeetingRecorderController,
  browserRecorderDeps,
  pickRecorderMimeType,
  type RecordedClip,
  type RecorderDeps,
  type RecorderErrorCode,
  type RecorderSource,
  type RecorderStatus,
} from "./meeting-recorder";

/** How often the timer redraws while recording. Fast enough to look live, slow enough to be free. */
const TICK_MS = 250;

export type MeetingRecorderView = {
  readonly status: RecorderStatus;
  readonly source: RecorderSource;
  readonly errorCode: RecorderErrorCode | null;
  readonly bytes: number;
  readonly elapsedMs: number;
  readonly clip: RecordedClip | null;
  /** False when this browser could never record: no MediaRecorder, or an http:// origin. */
  readonly supported: boolean;
  readonly setSource: (source: RecorderSource) => void;
  readonly start: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly stop: () => void;
  readonly clearClip: () => void;
  readonly clearError: () => void;
};

/** Whether recording is possible at all, before the owner is asked for anything. */
export function recorderSupported(deps: RecorderDeps): boolean {
  return deps.secureContext && Boolean(deps.getUserMedia) && pickRecorderMimeType(deps.isTypeSupported) !== null;
}

export function useMeetingRecorder(depsOverride?: RecorderDeps): MeetingRecorderView {
  // Built once per mount. `browserRecorderDeps()` only reads globals, so it is safe in a lazy ref.
  const controllerRef = useRef<MeetingRecorderController | null>(null);
  const depsRef = useRef<RecorderDeps | null>(null);
  if (!controllerRef.current) {
    depsRef.current = depsOverride ?? browserRecorderDeps();
    controllerRef.current = new MeetingRecorderController(depsRef.current);
  }
  const controller = controllerRef.current;

  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const state = useSyncExternalStore(
    subscribe,
    () => controller.getState(),
    () => IDLE_RECORDER_STATE,
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    setTick(controller.elapsedMs());
    if (state.status !== "recording") {
      return;
    }
    const id = setInterval(() => setTick(controller.elapsedMs()), TICK_MS);
    return () => clearInterval(id);
  }, [controller, state.status]);

  useEffect(() => () => controller.dispose(), [controller]);

  const [source, setSource] = useState<RecorderSource>("mic");

  const start = useCallback(() => {
    void controller.start(source);
  }, [controller, source]);
  const pause = useCallback(() => controller.pause(), [controller]);
  const resume = useCallback(() => controller.resume(), [controller]);
  const stop = useCallback(() => controller.stop(), [controller]);
  const clearClip = useCallback(() => controller.clearClip(), [controller]);
  const clearError = useCallback(() => controller.clearError(), [controller]);

  const supported = useMemo(() => (depsRef.current ? recorderSupported(depsRef.current) : false), []);

  // Once stopped, the clip's own duration is the honest number; the live tick is only for recording.
  const elapsedMs = state.status === "idle" ? (state.clip?.durationMs ?? 0) : tick;

  return {
    status: state.status,
    source,
    errorCode: state.errorCode,
    bytes: state.bytes,
    elapsedMs,
    clip: state.clip,
    supported,
    setSource,
    start,
    pause,
    resume,
    stop,
    clearClip,
    clearError,
  };
}

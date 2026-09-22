"use client";

/**
 * React skin over `MeetingUploadController`.
 *
 * Same division as `use-meeting-recorder.ts`: every decision — when to send, when to queue, what to
 * keep after a failure — is in `meeting-upload.ts` and is tested there without a browser. This file
 * subscribes, and keeps the studio's `send` closure current in a ref so the controller always calls
 * the latest one without being rebuilt (which would drop the clip it is holding).
 */

import { useCallback, useRef, useSyncExternalStore } from "react";
import type { RecordedClip } from "./meeting-recorder";
import {
  IDLE_UPLOAD_STATE,
  MeetingUploadController,
  type MeetingUploadState,
  type UploadOutcome,
} from "./meeting-upload";

export type MeetingUploadView = MeetingUploadState & {
  readonly offer: (clip: RecordedClip) => void;
  readonly setBlocked: (blocked: boolean) => void;
  readonly retry: () => void;
  readonly dismissCapped: () => void;
  readonly recordingStarted: () => void;
};

export function useMeetingUpload(send: (file: File) => Promise<UploadOutcome>): MeetingUploadView {
  // The latest closure, without rebuilding the controller: a new controller would be a new (empty)
  // holder for a clip the old one still has, which is the data loss this whole module prevents.
  const sendRef = useRef(send);
  sendRef.current = send;

  const controllerRef = useRef<MeetingUploadController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new MeetingUploadController({ send: (file) => sendRef.current(file) });
  }
  const controller = controllerRef.current;

  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const state = useSyncExternalStore(
    subscribe,
    () => controller.getState(),
    () => IDLE_UPLOAD_STATE,
  );

  const offer = useCallback((clip: RecordedClip) => controller.offer(clip), [controller]);
  const setBlocked = useCallback((blocked: boolean) => controller.setBlocked(blocked), [controller]);
  const retry = useCallback(() => controller.retry(), [controller]);
  const dismissCapped = useCallback(() => controller.dismissCapped(), [controller]);
  const recordingStarted = useCallback(() => controller.recordingStarted(), [controller]);

  return { ...state, offer, setBlocked, retry, dismissCapped, recordingStarted };
}

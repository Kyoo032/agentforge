"use client";

import { useCallback, useReducer, useRef, useState } from "react";
import { EMPTY_JOB_PROGRESS, reduceJobProgress, type JobEvent, type JobProgress } from "@agentforge/core/jobs";
import { JobStreamError, runJobStream } from "./job-stream";

type Action = { type: "event"; event: JobEvent } | { type: "reset" };

function progressReducer(state: JobProgress, action: Action): JobProgress {
  return action.type === "reset" ? EMPTY_JOB_PROGRESS : reduceJobProgress(state, action.event);
}

export type JobStreamState<T> = {
  progress: JobProgress;
  busy: boolean;
  error: JobStreamError | null;
  run: (url: string, body: unknown) => Promise<T | null>;
  cancel: () => void;
  reset: () => void;
};

/** Drive one streamed job at a time and expose its progress for a phase list. */
export function useJobStream<T>(): JobStreamState<T> {
  const [progress, dispatch] = useReducer(progressReducer, EMPTY_JOB_PROGRESS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<JobStreamError | null>(null);
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    setError(null);
  }, []);

  const run = useCallback(
    async (url: string, body: unknown): Promise<T | null> => {
      cancel();
      const abort = new AbortController();
      controller.current = abort;
      dispatch({ type: "reset" });
      setError(null);
      setBusy(true);
      try {
        return await runJobStream<T>({
          url,
          body,
          signal: abort.signal,
          onEvent: (event) => dispatch({ type: "event", event }),
        });
      } catch (err) {
        if (abort.signal.aborted) {
          // The user cancelled: reset quietly instead of showing an error.
          dispatch({ type: "reset" });
          return null;
        }
        const failure =
          err instanceof JobStreamError
            ? err
            : new JobStreamError("request_failed", err instanceof Error ? err.message : "Request failed", 0);
        setError(failure);
        return null;
      } finally {
        if (controller.current === abort) {
          controller.current = null;
        }
        setBusy(false);
      }
    },
    [cancel],
  );

  return { progress, busy, error, run, cancel, reset };
}

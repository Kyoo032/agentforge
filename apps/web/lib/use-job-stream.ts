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

/** Where a run writes: React's dispatch and setters in the hook, plain recorders in a test. */
export type JobRunSink = {
  readonly dispatch: (action: Action) => void;
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (error: JobStreamError | null) => void;
};

type StreamFn = (input: {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  onEvent?: (event: JobEvent) => void;
}) => Promise<unknown>;

export type JobRunner<T> = {
  readonly run: (url: string, body: unknown) => Promise<T | null>;
  readonly cancel: () => void;
};

/**
 * One streamed job at a time, and only the current run writes.
 *
 * `run()` aborts the run before it, and that run then settles — rejected, aborted — *after* the new
 * one has already reset the progress list and set busy. It used to reset the list again and set busy
 * to false on its way out, so the new run's phases vanished and its Cancel button went away while it
 * was still streaming. Each run now holds a token, and every write checks that the token is still
 * the latest: a superseded run resolves to `null` and touches nothing.
 *
 * `cancel()` aborts without superseding, so the owner's own Cancel still resets the list quietly and
 * frees the studio through the run it stopped.
 */
export function createJobRunner<T>(sink: JobRunSink, stream: StreamFn = runJobStream): JobRunner<T> {
  let controller: AbortController | null = null;
  let latest = 0;

  const cancel = () => {
    controller?.abort();
    controller = null;
  };

  const run = async (url: string, body: unknown): Promise<T | null> => {
    cancel();
    latest += 1;
    const token = latest;
    const current = () => token === latest;
    const abort = new AbortController();
    controller = abort;
    sink.dispatch({ type: "reset" });
    sink.setError(null);
    sink.setBusy(true);
    try {
      const result = (await stream({
        url,
        body,
        signal: abort.signal,
        onEvent: (event) => {
          if (current()) {
            sink.dispatch({ type: "event", event });
          }
        },
      })) as T;
      return current() ? result : null;
    } catch (err) {
      if (!current()) {
        return null;
      }
      if (abort.signal.aborted) {
        // The owner cancelled: reset quietly instead of showing an error.
        sink.dispatch({ type: "reset" });
        return null;
      }
      const failure =
        err instanceof JobStreamError
          ? err
          : new JobStreamError("request_failed", err instanceof Error ? err.message : "Request failed", 0);
      sink.setError(failure);
      return null;
    } finally {
      if (controller === abort) {
        controller = null;
      }
      if (current()) {
        sink.setBusy(false);
      }
    }
  };

  return { run, cancel };
}

/** Drive one streamed job at a time and expose its progress for a phase list. */
export function useJobStream<T>(): JobStreamState<T> {
  const [progress, dispatch] = useReducer(progressReducer, EMPTY_JOB_PROGRESS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<JobStreamError | null>(null);
  const runnerRef = useRef<JobRunner<T> | null>(null);
  if (!runnerRef.current) {
    runnerRef.current = createJobRunner<T>({ dispatch, setBusy, setError });
  }
  const { run, cancel } = runnerRef.current;

  const reset = useCallback(() => {
    dispatch({ type: "reset" });
    setError(null);
  }, []);

  return { progress, busy, error, run, cancel, reset };
}

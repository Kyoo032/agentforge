import { abortErrorMessage, armStreamWatchdog, type AppLocale, type RuntimeEvent } from "@agentforge/core";

export type RunStallGuard = {
  /** A runtime event arrived: the stream is alive, even if the model has not spoken yet. */
  touch: () => void;
  /** The model produced output, so the idle budget takes over from the first-token one. */
  touchOutput: () => void;
  close: () => void;
};

/** Events that are the model working. Probing and lifecycle events are liveness only. */
export function isRunOutputEvent(event: RuntimeEvent): boolean {
  return (
    event.type === "assistant.delta" ||
    event.type === "assistant.thinking" ||
    event.type === "tool.started" ||
    event.type === "tool.completed"
  );
}

/**
 * First-token / idle guard for one chat run.
 *
 * It used to be a single `setTimeout(limits.ttfbMs)` armed at run start and never rearmed, so it
 * capped the whole run instead of guarding the first token: a healthy run that streamed deltas at
 * 21 s and at 79 s was still killed at 120 s, under the "No first token" wording, which by then was
 * not even true. It now carries the model's own limits and rearms on every runtime event, so a
 * quiet reasoning model gets its longer budget while a silent one still stops at the cap.
 */
export function armRunStallGuard(options: {
  model: string;
  locale: AppLocale;
  onStall: (message: string) => void;
  now?: () => number;
}): RunStallGuard {
  const abort = new AbortController();
  const watchdog = armStreamWatchdog(options.model, abort, undefined, options.now ?? Date.now, options.locale);
  abort.signal.addEventListener(
    "abort",
    () => {
      options.onStall(abortErrorMessage(abort.signal.reason, options.locale));
    },
    { once: true },
  );
  return {
    touch: () => watchdog.touch(),
    touchOutput: () => watchdog.touchOutput(),
    close: () => watchdog.close(),
  };
}

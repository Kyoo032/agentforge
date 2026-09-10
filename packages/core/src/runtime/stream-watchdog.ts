import { isThinkingModel } from "../models/curation";

/** Hermes TTFB default for a wedged SSE accept (`HERMES_CODEX_TTFB_TIMEOUT_SECONDS`). */
export const STREAM_TTFB_MS = 120_000;
/** Hermes Codex idle-after-first-byte default for mid-size requests. */
export const STREAM_IDLE_MS = 60_000;
/** Hermes stream-stale default (`HERMES_STREAM_STALE_TIMEOUT`) for reasoning pauses. */
export const STREAM_REASONING_IDLE_MS = 180_000;
/** Hermes Claude Opus 5 stale floor. */
export const STREAM_REASONING_TTFB_MS = 240_000;

export type StreamWatchdogKind = "ttfb" | "idle";

export type StreamWatchdogLimits = {
  ttfbMs: number;
  idleMs: number;
};

export type StreamWatchdogState = {
  startedAt: number;
  lastEventAt: number | null;
};

function leafId(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** Reasoning / long-prefill models that routinely sit quiet before the first token. */
export function isWatchdogReasoningModel(modelId: string): boolean {
  if (isThinkingModel(modelId)) {
    return true;
  }
  const id = leafId(modelId);
  return /^(claude-(?:opus|sonnet|fable)-5|claude-opus-4|claude-4)/.test(id);
}

function modelWatchdogLimits(modelId: string): StreamWatchdogLimits {
  if (isWatchdogReasoningModel(modelId)) {
    return { ttfbMs: STREAM_REASONING_TTFB_MS, idleMs: STREAM_REASONING_IDLE_MS };
  }
  return { ttfbMs: STREAM_TTFB_MS, idleMs: STREAM_IDLE_MS };
}

/** The larger of the model floor and a requested limit; a missing or malformed request keeps the floor. */
function raisedLimit(floor: number, wanted: number | undefined): number {
  return typeof wanted === "number" && Number.isFinite(wanted) && wanted > floor ? wanted : floor;
}

/**
 * Limits for one run: the model defaults, raised by an optional per-run
 * override. An override can only lengthen a limit, never shorten it below
 * what the model would get anyway.
 */
export function streamWatchdogLimits(modelId: string, override?: Partial<StreamWatchdogLimits>): StreamWatchdogLimits {
  const defaults = modelWatchdogLimits(modelId);
  if (!override) {
    return defaults;
  }
  return {
    ttfbMs: raisedLimit(defaults.ttfbMs, override.ttfbMs),
    idleMs: raisedLimit(defaults.idleMs, override.idleMs),
  };
}

export function checkStreamWatchdog(
  state: StreamWatchdogState,
  now: number,
  limits: StreamWatchdogLimits,
): StreamWatchdogKind | null {
  if (state.lastEventAt == null) {
    return now - state.startedAt >= limits.ttfbMs ? "ttfb" : null;
  }
  return now - state.lastEventAt >= limits.idleMs ? "idle" : null;
}

export function formatStreamWatchdogError(modelId: string, kind: StreamWatchdogKind, waitedMs: number): string {
  const name = modelId.trim() || "this model";
  const seconds = Math.max(1, Math.round(waitedMs / 1000));
  if (kind === "ttfb") {
    return `No first token from ${name} after ${seconds}s (timeout). Try a smaller prompt, another model, or send again.`;
  }
  return `No stream events from ${name} for ${seconds}s after it started (timeout). Try a smaller prompt, another model, or send again.`;
}

export function armStreamWatchdog(
  modelId: string,
  abort: AbortController,
  override?: Partial<StreamWatchdogLimits>,
  now: () => number = Date.now,
): { touch: () => void; close: () => void } {
  const limits = streamWatchdogLimits(modelId, override);
  let lastEventAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fire = (kind: StreamWatchdogKind, waitedMs: number) => {
    if (abort.signal.aborted) {
      return;
    }
    abort.abort(new Error(formatStreamWatchdogError(modelId, kind, waitedMs)));
  };

  const arm = () => {
    if (timer) {
      clearTimeout(timer);
    }
    const kind: StreamWatchdogKind = lastEventAt == null ? "ttfb" : "idle";
    const wait = kind === "ttfb" ? limits.ttfbMs : limits.idleMs;
    const started = lastEventAt ?? now();
    timer = setTimeout(() => fire(kind, now() - (lastEventAt ?? started)), wait);
  };

  arm();
  return {
    touch() {
      lastEventAt = now();
      arm();
    },
    close() {
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}

export function abortErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "The model stream timed out";
}

function rejectOnAbort(abort: AbortController): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () =>
      reject(
        abort.signal.reason instanceof Error ? abort.signal.reason : new Error(abortErrorMessage(abort.signal.reason)),
      );
    if (abort.signal.aborted) {
      fail();
      return;
    }
    abort.signal.addEventListener("abort", fail, { once: true });
  });
}

/** Race an async iterable against an abort so a silent stream cannot hang `for await`. */
export async function* watchAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  abort: AbortController,
  onItem?: () => void,
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await Promise.race([iterator.next(), rejectOnAbort(abort)]);
      if (result.done) {
        return;
      }
      onItem?.();
      yield result.value;
    }
  } finally {
    await iterator.return?.();
  }
}

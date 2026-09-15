import { parseAppLocale, type AppLocale } from "../locale";
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
  /** Last sign of life on the wire, including frames that carry no model output. */
  lastEventAt: number | null;
  /** True once the model produced output: text, reasoning, or a tool call. */
  streaming: boolean;
};

function leafId(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  const slash = trimmed.lastIndexOf("/");
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/**
 * Gateway families that think before they answer and cannot be told to stop over the chat wire.
 * Their reasoning arrives as `reasoning_content`, which AI SDK 4 drops, so the stream looks dead
 * while the model works (docs/internal/gateway-model-selection.md: DeepSeek V4 thinking on by
 * default, GLM-5.3 and Kimi K3 reasoning always on, Qwen3.8-Max thinking on by default).
 */
const QUIET_REASONING_FAMILY = /^(deepseek-v4|glm-5\.3|kimi-k3|qwen3\.8-max)/;

/** Reasoning / long-prefill models that routinely sit quiet before the first token. */
export function isWatchdogReasoningModel(modelId: string): boolean {
  if (isThinkingModel(modelId)) {
    return true;
  }
  const id = leafId(modelId);
  return /^(claude-(?:opus|sonnet|fable)-5|claude-opus-4|claude-4)/.test(id) || QUIET_REASONING_FAMILY.test(id);
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

/**
 * The one deadline rule, used by both the checker and the armed timer.
 *
 * Until the model produces output the first-token budget governs and it is a hard cap: a frame
 * that carries no output (the AI SDK `step-start`, a keep-alive) must neither start the short
 * idle clock nor push the cap out, or a gateway that heartbeats forever without ever answering
 * would keep the run alive forever. After the first output the idle budget runs from the last
 * sign of life.
 */
export function streamWatchdogDeadline(
  state: StreamWatchdogState,
  limits: StreamWatchdogLimits,
): { kind: StreamWatchdogKind; dueAt: number; since: number } {
  if (!state.streaming) {
    return { kind: "ttfb", dueAt: state.startedAt + limits.ttfbMs, since: state.startedAt };
  }
  const quietSince = state.lastEventAt ?? state.startedAt;
  return { kind: "idle", dueAt: quietSince + limits.idleMs, since: quietSince };
}

export function checkStreamWatchdog(
  state: StreamWatchdogState,
  now: number,
  limits: StreamWatchdogLimits,
): StreamWatchdogKind | null {
  const { kind, dueAt } = streamWatchdogDeadline(state, limits);
  return now >= dueAt ? kind : null;
}

export function formatStreamWatchdogError(
  modelId: string,
  kind: StreamWatchdogKind,
  waitedMs: number,
  locale: AppLocale = "en",
): string {
  const resolved = parseAppLocale(locale);
  const seconds = Math.max(1, Math.round(waitedMs / 1000));
  if (resolved === "id") {
    const name = modelId.trim() || "model ini";
    const advice = "Coba prompt yang lebih pendek, model lain, atau kirim lagi.";
    if (kind === "ttfb") {
      return `Tidak ada token pertama dari ${name} setelah ${seconds} detik (timeout). ${advice}`;
    }
    return `Tidak ada peristiwa stream dari ${name} selama ${seconds} detik setelah dimulai (timeout). ${advice}`;
  }
  const name = modelId.trim() || "this model";
  const advice = "Try a smaller prompt, another model, or send again.";
  if (kind === "ttfb") {
    return `No first token from ${name} after ${seconds}s (timeout). ${advice}`;
  }
  return `No stream events from ${name} for ${seconds}s after it started (timeout). ${advice}`;
}

export function armStreamWatchdog(
  modelId: string,
  abort: AbortController,
  override?: Partial<StreamWatchdogLimits>,
  now: () => number = Date.now,
  locale: AppLocale = "en",
): { touch: () => void; touchOutput: () => void; close: () => void } {
  const limits = streamWatchdogLimits(modelId, override);
  const startedAt = now();
  let lastEventAt: number | null = null;
  let streaming = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fire = (kind: StreamWatchdogKind, waitedMs: number) => {
    if (abort.signal.aborted) {
      return;
    }
    abort.abort(new Error(formatStreamWatchdogError(modelId, kind, waitedMs, locale)));
  };

  const arm = () => {
    if (timer) {
      clearTimeout(timer);
    }
    const { kind, dueAt, since } = streamWatchdogDeadline({ startedAt, lastEventAt, streaming }, limits);
    timer = setTimeout(() => fire(kind, now() - since), Math.max(0, dueAt - now()));
  };

  arm();
  return {
    /** A frame arrived on the wire, model output or not. */
    touch() {
      lastEventAt = now();
      arm();
    },
    /** The model produced output, so the first-token budget is spent and the idle one takes over. */
    touchOutput() {
      lastEventAt = now();
      streaming = true;
      arm();
    },
    close() {
      if (timer) {
        clearTimeout(timer);
      }
    },
  };
}

const ABORT_FALLBACK: Record<AppLocale, string> = {
  en: "The model stream timed out",
  id: "Stream model habis waktu",
};

export function abortErrorMessage(error: unknown, locale: AppLocale = "en"): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return ABORT_FALLBACK[parseAppLocale(locale)];
}

function rejectOnAbort(abort: AbortController, locale: AppLocale = "en"): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () =>
      reject(
        abort.signal.reason instanceof Error
          ? abort.signal.reason
          : new Error(abortErrorMessage(abort.signal.reason, locale)),
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
  locale: AppLocale = "en",
): AsyncGenerator<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  try {
    while (true) {
      const result = await Promise.race([iterator.next(), rejectOnAbort(abort, locale)]);
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

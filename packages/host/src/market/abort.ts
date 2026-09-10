/** Every adapter call gives up after this long, whatever the caller's own signal says. */
export const ADAPTER_TIMEOUT_MS = 15_000;

export type LinkedSignal = {
  signal: AbortSignal;
  /** Clear the timer and detach from the caller's signal. Call in `finally`. */
  dispose: () => void;
};

/**
 * A signal that aborts when the caller's signal aborts or the timeout elapses,
 * whichever comes first. Same shape as `linkSignals` in core's safe-fetch.
 */
export function withTimeout(outer: AbortSignal | undefined, timeoutMs = ADAPTER_TIMEOUT_MS): LinkedSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
  const forward = () => controller.abort(outer?.reason);
  if (outer?.aborted) {
    forward();
  } else {
    outer?.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", forward);
    },
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "Unknown error";
}

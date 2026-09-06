export function errorFromAbortSignal(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.message.trim()) {
    return reason;
  }
  if (typeof reason === "string" && reason.trim()) {
    return new Error(reason);
  }
  return new DOMException("The operation was aborted.", "AbortError");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw errorFromAbortSignal(signal);
  }
}

export function onAbort(signal: AbortSignal | undefined, fn: () => void): () => void {
  if (!signal) {
    return () => undefined;
  }
  if (signal.aborted) {
    fn();
    return () => undefined;
  }
  signal.addEventListener("abort", fn, { once: true });
  return () => signal.removeEventListener("abort", fn);
}

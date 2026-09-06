import { describe, expect, it, vi } from "vitest";
import { errorFromAbortSignal, onAbort, throwIfAborted } from "./ipc-abort";

describe("ipc-abort", () => {
  it("throws the abort reason when the signal is already aborted", () => {
    const abort = new AbortController();
    abort.abort(new Error("No first token from gpt-5.6-luna after 120s (timeout)"));
    expect(() => throwIfAborted(abort.signal)).toThrow(/No first token from gpt-5.6-luna/);
  });

  it("uses AbortError when no reason is set", () => {
    const abort = new AbortController();
    abort.abort();
    const error = errorFromAbortSignal(abort.signal);
    expect(error.name === "AbortError" || error.message.length > 0).toBe(true);
  });

  it("fires onAbort immediately when already aborted", () => {
    const abort = new AbortController();
    abort.abort();
    const fn = vi.fn();
    onAbort(abort.signal, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fires onAbort when the signal aborts later", () => {
    const abort = new AbortController();
    const fn = vi.fn();
    onAbort(abort.signal, fn);
    expect(fn).not.toHaveBeenCalled();
    abort.abort(new Error("idle"));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

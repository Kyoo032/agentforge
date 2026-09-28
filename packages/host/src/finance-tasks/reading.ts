/**
 * A reading that did not come back as sections is asked for once more.
 *
 * An empty answer and a body that is not the sections are the same failure: the model was handed
 * the facts and did not write the reading. One more ask uses those same facts. A second failure
 * is the error the desk already shows.
 */
import { ApiError } from "@agentforge/core";

/** 502 from a narration that was empty or not the sections this task asked for. */
export function isUnreadReading(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 502 &&
    (error.code === "invalid_finance" || error.code === "generation_failed")
  );
}

/**
 * Run `ask` once, and once more only when the answer was not a reading.
 *
 * `onRetry` fires before the second ask so the desk can say the reading was requested again.
 * Anything that is not that 502 — a closed gate, a missing input — is not retried.
 */
export async function askForReading<T>(ask: () => Promise<T>, onRetry: () => void): Promise<T> {
  try {
    return await ask();
  } catch (error) {
    if (!isUnreadReading(error)) {
      throw error;
    }
    onRetry();
    return ask();
  }
}

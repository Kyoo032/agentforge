/**
 * Test support for worker-thread isolation: how many worker threads this process has alive, and a
 * poll helper. `process.report` is the only place Node exposes that count — the parent holds no
 * other handle on a worker it has spawned.
 */

/** Live worker threads in this process, read from the diagnostic report. */
export function liveWorkers(): number {
  const report = process.report.getReport() as { workers?: readonly unknown[] };
  return report.workers?.length ?? 0;
}

/** Polls `predicate` until it holds or the window closes; true when it held in time. */
export async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) {
      return true;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

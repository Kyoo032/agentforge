/**
 * Registry of child processes the host spawned (today: ffmpeg / ffprobe for Edit).
 *
 * Windows exits through `taskkill /T`, which takes the whole tree down. macOS and Linux
 * exit through `app.quit()`, which leaves children running: ffmpeg would keep encoding
 * after Cmd+Q. The Electron main process calls `killTrackedChildren()` on `before-quit`.
 * Children unregister themselves on exit, so the set only ever holds live processes.
 */

/** The subset of `ChildProcess` this registry needs; keeps tests free of real processes. */
export type TrackableChild = {
  readonly pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "exit", listener: (...args: unknown[]) => void): unknown;
};

const DEFAULT_SIGNAL: NodeJS.Signals = "SIGTERM";

const live = new Set<TrackableChild>();

function hasExited(child: TrackableChild): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function trackChild(child: TrackableChild): void {
  if (!child.pid || hasExited(child) || live.has(child)) {
    return;
  }
  live.add(child);
  child.once("exit", () => {
    live.delete(child);
  });
}

export function trackedChildCount(): number {
  return live.size;
}

/** Signals every live child and forgets it. Never throws: a child that already died is fine. */
export function killTrackedChildren(signal: NodeJS.Signals = DEFAULT_SIGNAL): number {
  const targets = [...live];
  live.clear();
  let killed = 0;
  for (const child of targets) {
    try {
      child.kill(signal);
      killed += 1;
    } catch {
      // ESRCH or similar: the process is already gone.
    }
  }
  return killed;
}

export function resetTrackedChildrenForTests(): void {
  live.clear();
}

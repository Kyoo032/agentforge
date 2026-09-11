import type { SidecarHandle, SidecarStatus } from "../supervisor";

/**
 * A sidecar that is already running somewhere else — the fake server, or a real binary an
 * integration run started. It spawns nothing, so the whole backend can be exercised on a machine
 * that has no WeKnora build, which is every machine until the CI lane produces one.
 */
export function stubSidecar(baseUrl: string): SidecarHandle {
  let stopped = false;
  const status = (): SidecarStatus => ({
    running: !stopped,
    ready: !stopped,
    pid: stopped ? null : 1,
    port: stopped ? null : Number(new URL(baseUrl).port),
    baseUrl: stopped ? null : baseUrl,
    startedAt: stopped ? null : 0,
    lastError: null,
  });
  return {
    baseUrl: async () => {
      if (stopped) {
        throw new Error("stub sidecar stopped");
      }
      return baseUrl;
    },
    status,
    stop: async () => {
      stopped = true;
    },
  };
}

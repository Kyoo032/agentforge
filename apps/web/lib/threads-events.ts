export const THREADS_CHANGED_EVENT = "agentforge:threads-changed";

export function notifyThreadsChanged() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(THREADS_CHANGED_EVENT));
}

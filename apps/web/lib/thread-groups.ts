/** How many Chat sessions the left rail shows before the `All sessions` toggle expands it. */
export const RAIL_RECENT_THREADS = 4;

/**
 * Head of an already newest-first list, as a new array — the rail never reorders or
 * mutates what the host returned. A non-positive or non-finite `count` yields nothing.
 */
export function takeRecentThreads<T>(items: readonly T[], count: number = RAIL_RECENT_THREADS): T[] {
  if (!Number.isFinite(count) || count <= 0) {
    return [];
  }
  return items.slice(0, Math.floor(count));
}

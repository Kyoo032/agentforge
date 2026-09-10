/**
 * `Promise.allSettled` with at most `limit` tasks in flight. Results keep the
 * input order. Used by the packet builder so a 15-ticker watchlist does not
 * open 15 sockets to the same vendor at once.
 */
export const MAP_LIMIT_DEFAULT = 4;

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const width = Math.max(1, Math.floor(limit) || 1);
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await task(items[index] as T, index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return results;
}

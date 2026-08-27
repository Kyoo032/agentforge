export type DayGroup = "Today" | "Yesterday" | "Earlier";

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function dayGroupLabel(createdAt: Date, now = new Date()): DayGroup {
  const day = startOfLocalDay(createdAt);
  const today = startOfLocalDay(now);
  const yesterday = today - 86_400_000;
  if (day === today) {
    return "Today";
  }
  if (day === yesterday) {
    return "Yesterday";
  }
  return "Earlier";
}

export function groupThreadsByDay<T extends { createdAt: Date | string }>(
  items: T[],
  now = new Date(),
): Array<{ label: DayGroup; threads: T[] }> {
  const buckets: Record<DayGroup, T[]> = { Today: [], Yesterday: [], Earlier: [] };
  for (const item of items) {
    const date = typeof item.createdAt === "string" ? new Date(item.createdAt) : item.createdAt;
    buckets[dayGroupLabel(date, now)].push(item);
  }
  const groups: Array<{ label: DayGroup; threads: T[] }> = [];
  for (const label of ["Today", "Yesterday", "Earlier"] as const) {
    if (buckets[label].length > 0) {
      groups.push({ label, threads: buckets[label] });
    }
  }
  return groups;
}

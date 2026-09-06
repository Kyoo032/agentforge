import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";

export type EditMetricEvent = {
  at: string;
  projectId?: string;
  runId?: string;
  cardId?: string;
  jobId?: string;
  event: string;
  data?: Record<string, unknown>;
};

const RANGES: Record<string, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

function metricsPath(): string {
  return resolve(localDataDir(), "edit", "metrics.jsonl");
}

export function appendEditMetric(event: Omit<EditMetricEvent, "at"> & { at?: string }): void {
  const row: EditMetricEvent = {
    at: event.at ?? new Date().toISOString(),
    event: event.event,
    ...(event.projectId ? { projectId: event.projectId } : {}),
    ...(event.runId ? { runId: event.runId } : {}),
    ...(event.cardId ? { cardId: event.cardId } : {}),
    ...(event.jobId ? { jobId: event.jobId } : {}),
    ...(event.data ? { data: event.data } : {}),
  };
  const dir = resolve(localDataDir(), "edit");
  mkdirSync(dir, { recursive: true });
  appendFileSync(metricsPath(), `${JSON.stringify(row)}\n`, "utf8");
}

export function foldEditMetrics(range: "day" | "week" | "month" = "week"): {
  range: string;
  counts: Record<string, number>;
  events: EditMetricEvent[];
} {
  const windowMs = RANGES[range] ?? RANGES.week;
  const since = Date.now() - windowMs;
  const events: EditMetricEvent[] = [];
  if (existsSync(metricsPath())) {
    const raw = readFileSync(metricsPath(), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as EditMetricEvent;
        if (parsed.at && new Date(parsed.at).getTime() >= since) {
          events.push(parsed);
        }
      } catch {
        // skip bad line
      }
    }
  }
  const counts: Record<string, number> = {};
  for (const item of events) {
    counts[item.event] = (counts[item.event] ?? 0) + 1;
  }
  return { range, counts, events };
}

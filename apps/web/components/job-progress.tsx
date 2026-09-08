"use client";

import type { JobProgress } from "@agentforge/core/jobs";

type Props = {
  progress: JobProgress;
  busy: boolean;
  testId?: string;
};

const SOURCE_STATUS_LABEL: Record<string, string> = {
  found: "found",
  read: "read",
  unreachable: "unreachable",
};

/** Streamed phase list for job modes: planning → searching 3/5 → reading 7/10 → drafting. */
export function JobProgressList({ progress, busy, testId = "job-progress" }: Props) {
  if (progress.phases.length === 0 && !busy) {
    return null;
  }
  return (
    <div className="rounded-lg border border-mist bg-mist/30 px-4 py-3 text-sm" data-testid={testId} aria-live="polite">
      {progress.phases.length === 0 ? <p className="text-ink/60">Starting…</p> : null}
      {progress.round ? (
        <p className="mb-1 text-xs font-medium text-navy" data-testid={`${testId}-round`}>
          Round {progress.round.round} of {progress.round.total} · {progress.round.label}
        </p>
      ) : null}
      <ol className="space-y-1">
        {progress.phases.map((phase) => {
          const last = phase.steps.at(-1);
          const count = last?.total ? ` ${last.current ?? phase.steps.length}/${last.total}` : "";
          return (
            <li key={phase.phase} className="flex items-baseline gap-2" data-testid={`${testId}-phase`}>
              <span className={phase.status === "active" ? "text-navy" : "text-ink/45"} aria-hidden>
                {phase.status === "active" ? "●" : "✓"}
              </span>
              <span className={phase.status === "active" ? "font-medium text-ink" : "text-ink/70"}>
                {phase.label}
                {count}
              </span>
              {phase.status === "active" && last?.label ? (
                <span className="truncate text-xs text-ink/50">{last.detail ?? last.label}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {progress.sources.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-ink/60" data-testid={`${testId}-sources`}>
          {progress.sources.map((source) => (
            <li key={source.id} className="truncate">
              <span className="font-mono">{source.id}</span> {source.title || source.url}{" "}
              <span className="text-ink/40">({SOURCE_STATUS_LABEL[source.status] ?? source.status})</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

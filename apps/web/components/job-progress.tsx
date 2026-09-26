"use client";

import type { JobProgress } from "@agentforge/core/jobs";
import { MascotSlot } from "@/components/mascot-slot";
import { t } from "@/lib/i18n";
import type { MascotMode } from "@/lib/mascot-states";
import { labeled } from "@/lib/ui-copy";

type Props = {
  progress: JobProgress;
  busy: boolean;
  /** Which desk this job belongs to, so the mascot beside it matches the work. */
  mode: MascotMode;
  testId?: string;
  /**
   * The reader's name for a phase label. Finance streams the phase *id* ("narrate-guard-export")
   * because the host has no locale for one; other modes send a sentence and pass nothing here.
   */
  labelFor?: (label: string) => string;
};

/** Known source states get catalog copy; anything else the host sends is shown as-is. */
function sourceStatusLabel(status: string): string {
  return labeled(`common.jobProgress.source.${status}`, status);
}

/** Streamed phase list for job modes: planning → searching 3/5 → reading 7/10 → drafting. */
export function JobProgressList({ progress, busy, mode, testId = "job-progress", labelFor }: Props) {
  if (progress.phases.length === 0 && !busy) {
    return null;
  }
  const active = progress.phases.find((phase) => phase.status === "active");
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm"
      data-testid={testId}
      aria-live="polite"
    >
      <MascotSlot
        mode={mode}
        placement="beside"
        phase={active?.phase}
        busy={busy}
        failed={Boolean(progress.error)}
        done={progress.done && !progress.error}
      />
      <div className="min-w-0 flex-1">
        {progress.phases.length === 0 ? <p className="text-[var(--text-2)]">{t("common.jobProgress.starting")}</p> : null}
      {progress.round ? (
        <p className="mb-1 text-xs font-medium text-[var(--accent)]" data-testid={`${testId}-round`}>
          {t("common.jobProgress.round", {
            round: progress.round.round,
            total: progress.round.total,
            label: progress.round.label,
          })}
        </p>
      ) : null}
      <ol className="space-y-1">
        {progress.phases.map((phase) => {
          const last = phase.steps.at(-1);
          const count = last?.total ? ` ${last.current ?? phase.steps.length}/${last.total}` : "";
          return (
            <li key={phase.phase} className="flex items-baseline gap-2" data-testid={`${testId}-phase`}>
              <span className={phase.status === "active" ? "text-[var(--accent)]" : "text-[var(--text-3)]"} aria-hidden>
                {phase.status === "active" ? "●" : "✓"}
              </span>
              <span className={phase.status === "active" ? "font-medium text-[var(--text)]" : "text-[var(--text-2)]"}>
                {labelFor ? labelFor(phase.label) : phase.label}
                {count}
              </span>
              {phase.status === "active" && last?.label ? (
                <span className="truncate text-xs text-[var(--text-3)]">{last.detail ?? last.label}</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {progress.sources.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-[var(--text-2)]" data-testid={`${testId}-sources`}>
          {progress.sources.map((source) => (
            <li key={source.id} className="truncate">
              <span className="font-mono">{source.id}</span> {source.title || source.url}{" "}
              <span className="text-[var(--text-3)]">({sourceStatusLabel(source.status)})</span>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
    </div>
  );
}

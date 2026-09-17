"use client";

import { t } from "@/lib/i18n";
import { FINANCE_PHASE_KINDS, type FinancePhaseId } from "@/lib/finance-task";

/**
 * The steps this task actually walks, in its own order.
 *
 * Each Finance task has its own flow rather than one pipeline with different
 * labels, so the strip is read straight off the task's `phases` — a task that
 * gains or loses a step changes here without anyone editing a component.
 *
 * The kind is the flow graph's legend, and it is the only thing the dot colour
 * says: a step computed in code reads differently from one that waits on the
 * user, which is what makes "numbers are computed in code" visible on screen.
 */
const DOT: Readonly<Record<string, string>> = {
  shared: "bg-[var(--text-3)]",
  input: "bg-[var(--accent)]",
  math: "bg-[var(--ok)]",
};

export function FinancePhaseStrip({ phases }: { phases: readonly FinancePhaseId[] }) {
  return (
    <ol
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--text-3)]"
      aria-label={t("finance.phaseStripAria")}
      data-testid="finance-phase-strip"
    >
      {phases.map((phase, index) => (
        <li
          key={phase}
          className="flex items-center gap-1.5"
          data-testid={`finance-phase-${phase}`}
          data-phase-kind={FINANCE_PHASE_KINDS[phase]}
        >
          {index > 0 ? (
            <span aria-hidden="true" className="text-[var(--line)]">
              /
            </span>
          ) : null}
          <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[FINANCE_PHASE_KINDS[phase]]}`} />
          <span className="truncate">{t(`finance.phases.${phase}`)}</span>
        </li>
      ))}
    </ol>
  );
}

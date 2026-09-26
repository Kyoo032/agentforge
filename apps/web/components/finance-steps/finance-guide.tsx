"use client";

import type { ReactNode } from "react";
import { Link } from "@/lib/nav";
import { FINANCE_TASKS, financeTaskHref, type FinanceTask } from "@/lib/finance-task";
import { t } from "@/lib/i18n";

const STEPS = ["choose", "numbers", "result"] as const;

/** The first screen: one question, five plain-language choices. The URL still owns the task. */
export function FinanceChooser() {
  return (
    <div className="mx-auto w-full max-w-[var(--content-max)]">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="finance-guide-choices">
        {FINANCE_TASKS.map((id) => (
          <Choice key={id} id={id} />
        ))}
      </div>
    </div>
  );
}

function Choice({ id }: { id: FinanceTask }) {
  return (
    <Link
      href={financeTaskHref(id)}
      className="card-live enter-rise flex items-start px-4 py-4 text-left"
      data-testid={`finance-guide-${id}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--text)]">{t(`finance.tasks.${id}.label`)}</span>
        <span className="mt-0.5 block text-xs text-[var(--text-3)]">{t(`finance.tasks.${id}.hint`)}</span>
      </span>
    </Link>
  );
}

/** Where you are on the three-step path. The first step is the chooser, reached by the change link. */
export function FinanceStepTrail({ step }: { step: "numbers" | "result" }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="finance-guide-steps">
      {STEPS.map((id, index) => (
        <li
          key={id}
          className={id === step ? "font-medium text-[var(--accent)]" : "text-[var(--text-3)]"}
          data-testid={`finance-guide-step-${id}`}
          aria-current={id === step ? "step" : undefined}
        >
          {index > 0 ? <span className="mr-2 text-[var(--text-3)]">·</span> : null}
          {t(`finance.guide.steps.${id}`)}
        </li>
      ))}
    </ol>
  );
}

/** Optional levers for one task. Closed until the reader asks. */
export function FinanceFold({ children, testId = "finance-task-advanced" }: { children: ReactNode; testId?: string }) {
  return (
    <details className="rounded-lg border border-[var(--line)] px-3 py-2" data-testid={testId}>
      <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
        {t("finance.guide.more")}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

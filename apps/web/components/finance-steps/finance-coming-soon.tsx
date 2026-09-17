"use client";

import { Link } from "@/lib/nav";
import { t } from "@/lib/i18n";
import {
  DEFAULT_FINANCE_TASK,
  financeTaskHref,
  financeTaskLabel,
  financeTaskSampleFigures,
  type FinanceTask,
  type FinanceTaskLanguage,
} from "@/lib/finance-task";

/**
 * What a task that is not built yet shows instead of the brief's inputs.
 *
 * The row stays in the rail — hiding it would be less honest than saying the
 * flow is on its way — so this panel has to be calm rather than an error: it
 * names the task, shows the shape of the figures that task will ask for, and
 * offers the one task that does run today. Nothing here can be submitted, so
 * there is no way to start a run the host would refuse.
 */
export function FinanceComingSoon({ task, locale }: { task: FinanceTask; locale: FinanceTaskLanguage }) {
  const name = financeTaskLabel(task, locale);
  return (
    <div
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-8 text-center text-[var(--text-2)]"
      role="status"
      data-testid="finance-task-coming-soon"
    >
      <p className="text-sm font-medium text-[var(--text)]">{t("finance.comingSoon.title", { task: name })}</p>
      <p className="mx-auto mt-2 max-w-md text-sm">{t("finance.comingSoon.body")}</p>
      <p className="mx-auto mt-4 max-w-md text-xs text-[var(--text-3)]">
        {t("finance.comingSoon.sampleLabel")}
        <span className="mt-1 block font-mono text-[11px]" data-testid="finance-task-sample">
          {financeTaskSampleFigures(task, locale)}
        </span>
      </p>
      <Link href={financeTaskHref(DEFAULT_FINANCE_TASK)} className="btn mt-5" data-testid="finance-coming-soon-back">
        {t("finance.comingSoon.cta", { task: financeTaskLabel(DEFAULT_FINANCE_TASK, locale) })}
      </Link>
    </div>
  );
}

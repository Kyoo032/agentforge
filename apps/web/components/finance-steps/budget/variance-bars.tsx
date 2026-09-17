"use client";

/**
 * The variance bars: one row per line, spread either side of the budget.
 *
 * A bar to the right is spending or earning above budget, a bar to the left below it, and a flagged
 * line is drawn in the danger colour so "what broke the limit" is answerable at a glance. The colour
 * is read off the report's own first series, which is the flagged one — the screen never decides for
 * itself which line is in trouble.
 *
 * Direction is marked in words beside the figure rather than by the colour, because favourable and
 * flagged are different questions: a cost line well under budget is flagged *and* good news.
 */
import type { ReportChart, ReportLocale } from "@agentforge/core/finance";
import { formatBudgetAmount } from "@agentforge/core/finance";
import { budgetBars } from "@/lib/finance-budget";
import { t } from "@/lib/i18n";

export function BudgetVarianceBars({
  chart,
  locale,
  currency,
}: {
  chart: ReportChart | undefined;
  locale: ReportLocale;
  currency: string;
}) {
  const bars = budgetBars(chart);
  if (bars.length === 0) {
    return null;
  }
  return (
    <figure
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="budget-variance-bars"
    >
      <figcaption className="text-sm font-medium text-[var(--text)]">{chart?.title}</figcaption>
      <ul className="mt-3 space-y-1">
        {bars.map((bar) => (
          <li key={bar.label} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-2 text-[11px]">
            <span className="truncate text-[var(--text-2)]" title={bar.label}>
              {bar.label}
            </span>
            <span className="flex h-3 items-stretch" aria-hidden="true">
              <span className="flex w-1/2 justify-end">
                {bar.side === "left" ? (
                  <span
                    className={`block rounded-l ${bar.flagged ? "bg-[var(--danger)]" : "bg-[var(--text-3)]"}`}
                    style={{ width: `${bar.widthPercent}%` }}
                  />
                ) : null}
              </span>
              <span className="w-px bg-[var(--line)]" />
              <span className="flex w-1/2 justify-start">
                {bar.side === "right" ? (
                  <span
                    className={`block rounded-r ${bar.flagged ? "bg-[var(--danger)]" : "bg-[var(--text-3)]"}`}
                    style={{ width: `${bar.widthPercent}%` }}
                  />
                ) : null}
              </span>
            </span>
            <span className={bar.flagged ? "text-[var(--danger)]" : "text-[var(--text-2)]"}>
              {formatBudgetAmount(bar.value, locale, currency)}
              {bar.flagged ? ` · ${t("finance.budget.chart.flagged")}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {chart?.note ? <figcaption className="mt-2 text-xs text-[var(--text-2)]">{chart.note}</figcaption> : null}
    </figure>
  );
}

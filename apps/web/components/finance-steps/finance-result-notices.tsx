"use client";

import type { FinanceResult } from "@/lib/finance-client";
import { t } from "@/lib/i18n";

/**
 * Two quiet facts about the run that just finished: what was hidden before it left the desk, and
 * which model actually answered when the one that was asked for could not be reached.
 *
 * Both fields are optional on the wire. A run with nothing to report — and an older host that
 * answers without them — draws nothing at all, so this never becomes a row of empty notices.
 */
export function FinanceResultNotices({ result }: { result: FinanceResult }) {
  const pii = result.pii?.count ?? 0;
  const fallback = result.notice?.code === "model_fallback" ? result.notice : null;
  if (pii === 0 && !fallback) {
    return null;
  }
  return (
    <div className="space-y-0.5 text-xs text-[var(--text-3)]" role="status">
      {pii > 0 ? <p data-testid="finance-result-pii">{t("finance.notice.pii", { n: pii })}</p> : null}
      {fallback ? (
        <p data-testid="finance-result-model-fallback">
          {t("finance.notice.modelFallback", { from: fallback.from, to: fallback.to })}
        </p>
      ) : null}
    </div>
  );
}

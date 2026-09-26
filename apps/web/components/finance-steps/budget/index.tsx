"use client";

/**
 * Budget versus actual: the inputs half.
 *
 * The flow graph this panel draws is budget + actuals → parse both sets → match the line pairs, and
 * it draws them in that order down the panel. The pairing is the step that matters: the matcher only
 * ever *proposes*, and nothing is computed until the owner has looked at the table and — if they
 * disagree — re-bound a line. The two limits sit above it because changing a threshold changes which
 * lines get a paragraph, and the reader should see that number before they see the flags.
 *
 * The counts under the table come from the very same `computeBudget` the host will run, so the panel
 * can never promise a different answer from the report. It costs nothing and reaches nothing.
 */
import { useMemo, useState } from "react";
import { formatBudgetAmount } from "@agentforge/core/finance";
import { FinanceFileUpload } from "@/components/finance-file-upload";
import { mergeFigures } from "@/lib/finance-brief";
import {
  DEFAULT_BUDGET_FLAG_ABS,
  DEFAULT_BUDGET_FLAG_PCT,
  EMPTY_BUDGET_PROPOSAL,
  budgetPairsForRequest,
  budgetPreview,
  withBudgetThreshold,
  type BudgetProposal,
  type BudgetProposalState,
  type BudgetUiParams,
} from "@/lib/finance-budget";
import { parseBudgetFigures } from "@/lib/finance-budget-client";
import type { LineItem } from "@/lib/finance-client";
import { getLocale, t } from "@/lib/i18n";
import { FinanceFold } from "../finance-guide";
import { useFinanceRead } from "../finance-read";
import type { FinanceStepDraft, FinanceStepEntry, FinanceStepProps } from "../types";
import { BudgetPairingTable } from "./pairing-table";
import { BudgetResult } from "./result";

/** This task's view of the studio's draft bag. The studio owns the state; this names its shape. */
export type BudgetStepDraft = {
  readonly figures: string;
  readonly items: LineItem[];
  readonly params: BudgetUiParams;
  readonly parsing: boolean;
};

function ThresholdField({
  id,
  label,
  hint,
  value,
  locked,
  onValue,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  locked: boolean;
  onValue: (raw: string) => void;
}) {
  return (
    <label htmlFor={id} className="text-xs text-[var(--text-2)]" title={hint}>
      {label}
      <input
        id={id}
        type="number"
        step="any"
        className="input mt-1 px-2 py-1 text-xs"
        value={value}
        onChange={(event) => onValue(event.target.value)}
        disabled={locked}
        data-testid={id}
      />
    </label>
  );
}

function Preview({ items, params }: { items: readonly LineItem[]; params: BudgetUiParams }) {
  const locale = getLocale();
  const computed = useMemo(() => budgetPreview(items, params), [items, params]);
  if (!computed) {
    return <p className="text-xs text-[var(--text-3)]">{t("finance.budget.preview.empty")}</p>;
  }
  return (
    <ul className="space-y-1 text-xs" data-testid="budget-preview">
      <li className="flex justify-between gap-3">
        <span className="text-[var(--text-3)]">{t("finance.budget.preview.lines")}</span>
        <span className="font-medium">{computed.lines}</span>
      </li>
      <li className="flex justify-between gap-3">
        <span className="text-[var(--text-3)]">{t("finance.budget.preview.flagged")}</span>
        <span className="font-medium">{computed.flagged}</span>
      </li>
      <li className="flex justify-between gap-3">
        <span className="text-[var(--text-3)]">{t("finance.budget.preview.unmatched")}</span>
        <span className="font-medium">{computed.unmatched}</span>
      </li>
      <li className="flex justify-between gap-3">
        <span className="text-[var(--text-3)]">{t("finance.budget.preview.result")}</span>
        <span className="font-medium">{formatBudgetAmount(computed.resultVariance, locale, computed.currency)}</span>
      </li>
      {computed.periods.length > 1 ? (
        <li className="pt-1 text-[11px] text-[var(--text-3)]">
          {t("finance.budget.preview.periods", { periods: computed.periods.join(", ") })}
        </li>
      ) : null}
    </ul>
  );
}

export function BudgetInputs({ locked, model, draft, setDraft }: FinanceStepProps) {
  // The registry holds five tasks whose drafts have nothing in common, so each narrows its own once.
  const budget = draft as unknown as BudgetStepDraft;
  const { figures, items, params } = budget;
  const [proposal, setProposal] = useState<BudgetProposalState>(EMPTY_BUDGET_PROPOSAL);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = locked || reading;

  function patchParams(next: BudgetUiParams): void {
    setDraft({ params: next } as unknown as FinanceStepDraft);
  }

  function onPairs(next: BudgetProposal[]): void {
    setProposal({ ...proposal, pairs: next });
    // What the table shows is what the report will compute: the confirmed pairing travels with the run.
    patchParams({ ...params, pairs: budgetPairsForRequest(next) });
  }

  async function onRead(): Promise<void> {
    if (!figures.trim() || busy) {
      return;
    }
    setReading(true);
    setError(null);
    try {
      const answer = await parseBudgetFigures(figures, {
        model,
        params,
        fallbackError: t("finance.budget.errors.read"),
      });
      setProposal(answer.proposal);
      setDraft({
        items: answer.items,
        params: { ...params, pairs: budgetPairsForRequest(answer.proposal.pairs) },
      } as unknown as FinanceStepDraft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("finance.budget.errors.read"));
    } finally {
      setReading(false);
    }
  }

  useFinanceRead(() => {
    void onRead();
  }, reading);

  return (
    <section
      className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="finance-inputs"
    >
      <FinanceFileUpload onFigures={(text) => setDraft({ figures: mergeFigures(figures, text) })} disabled={busy} />
      <div>
        <label htmlFor="budget-figures" className="panel-label">
          {t("finance.budget.figures")}
        </label>
        <textarea
          id="budget-figures"
          rows={5}
          value={figures}
          onChange={(event) => setDraft({ figures: event.target.value })}
          className="input mt-2 text-[13px]"
          placeholder={t("finance.budget.figuresPlaceholder")}
          disabled={busy}
          data-testid="finance-figures-input"
        />
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.budget.readHint")}</p>
      </div>
      {error ? (
        <p className="text-xs text-[var(--danger)]" role="alert" data-testid="budget-error">
          {error}
        </p>
      ) : null}
      <FinanceFold>
        <div>
          <p className="panel-label">{t("finance.budget.thresholds")}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <ThresholdField
              id="budget-flag-pct"
              label={t("finance.budget.flagPct")}
              hint={t("finance.budget.flagPctHint")}
              value={String(params.flagPct ?? DEFAULT_BUDGET_FLAG_PCT)}
              locked={busy}
              onValue={(raw) => patchParams(withBudgetThreshold(params, "flagPct", raw))}
            />
            <ThresholdField
              id="budget-flag-abs"
              label={t("finance.budget.flagAbs")}
              hint={t("finance.budget.flagAbsHint")}
              value={String(params.flagAbs ?? DEFAULT_BUDGET_FLAG_ABS)}
              locked={busy}
              onValue={(raw) => patchParams(withBudgetThreshold(params, "flagAbs", raw))}
            />
          </div>
          <label htmlFor="budget-flag-mode" className="mt-2 block text-xs text-[var(--text-2)]">
            {t("finance.budget.flagMode")}
            <select
              id="budget-flag-mode"
              className="input mt-1 px-2 py-1 text-xs"
              value={params.flagMode ?? "and"}
              onChange={(event) => patchParams({ ...params, flagMode: event.target.value === "or" ? "or" : "and" })}
              disabled={busy}
              data-testid="budget-flag-mode"
            >
              <option value="and">{t("finance.budget.flagModeAnd")}</option>
              <option value="or">{t("finance.budget.flagModeOr")}</option>
            </select>
          </label>
        </div>
      </FinanceFold>
      <div>
        <p className="panel-label">{t("finance.budget.pairing.heading")}</p>
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.budget.pairing.hint")}</p>
        <div className="mt-2">
          <BudgetPairingTable state={proposal} locked={busy} onPairs={onPairs} />
        </div>
      </div>
      <div>
        <p className="panel-label">{t("finance.budget.preview.heading")}</p>
        <div className="mt-2">
          <Preview items={items} params={params} />
        </div>
      </div>
    </section>
  );
}

export const BUDGET_STEPS: FinanceStepEntry = {
  Inputs: BudgetInputs,
  // A task that owns its maths answers with a report and no brief, so it renders its own result.
  Result: BudgetResult,
};

"use client";

/**
 * Cash flow and runway — the inputs the studio renders for this task.
 *
 * The flow on screen is the flow in the graph: paste or upload a cash book, read it into periods in
 * code, confirm those periods and what each source row was read as, then turn the what-if levers and
 * watch every figure recompute. Nothing on this panel is a model's answer; the live figures come from
 * the same `computeCashflow` the host runs, so the panel and the report cannot disagree.
 */
import { useEffect } from "react";
import { FinanceFileUpload } from "@/components/finance-file-upload";
import { mergeFigures } from "@/lib/finance-brief";
import type { FinanceParams, LineItem } from "@/lib/finance-client";
import {
  cashflowClassification,
  cashflowItemsOf,
  cashflowPreview,
  lineItemsOf,
  normaliseCashflowItems,
  openingCashOf,
  withCashflowParams,
  withCategoryBehaviour,
} from "@/lib/finance-cashflow";
import { formatCashflowValue, type CashflowItem, type CostBehaviour } from "@agentforge/core/finance";
import { getLocale, t } from "@/lib/i18n";
import { CashflowPeriodsTable } from "./periods-table";
import { CashflowResult } from "./result";
import { CashflowWhatIf } from "./what-if-panel";
import type { FinanceStepEntry, FinanceStepProps } from "../types";

/** The slice of the studio's draft this task reads. The shell owns the state; this names its shape. */
export type CashflowStepDraft = {
  readonly figures: string;
  readonly items: LineItem[];
  readonly params: FinanceParams;
  readonly parsing: boolean;
};

const BEHAVIOURS: readonly CostBehaviour[] = ["variable", "fixed", "oneOff"];
/** Below this the rules were guessing and the row is marked for the reader. */
const CONFIRM_BELOW = 0.8;

function Summary({ items, params }: { items: readonly CashflowItem[]; params: FinanceParams }) {
  const locale = getLocale() === "en" ? "en" : "id";
  const preview = cashflowPreview(items, params);
  if (!preview) {
    return null;
  }
  const money = (value: number | null) => formatCashflowValue(value, "currency", locale, preview.currency);
  const tiles: ReadonlyArray<readonly [string, string]> = [
    [t("finance.cashflow.closingCash"), money(preview.closingCash)],
    [t("finance.cashflow.netBurn"), money(preview.primaryBurn.netBurn)],
    [t("finance.cashflow.runway"), formatCashflowValue(preview.primaryBurn.runwayMonths, "months", locale)],
    [t("finance.cashflow.breakeven"), money(preview.breakeven.revenuePerPeriod)],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 text-xs" data-testid="cashflow-summary">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-[var(--line)] px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">{label}</div>
          <div className="tabular-nums text-[var(--text)]">{value}</div>
        </div>
      ))}
    </div>
  );
}

function Classification({
  items,
  onItems,
  disabled,
}: {
  items: readonly CashflowItem[];
  onItems: (next: CashflowItem[]) => void;
  disabled: boolean;
}) {
  const categories = cashflowClassification(items);
  if (categories.length === 0) {
    return null;
  }
  return (
    <div data-testid="cashflow-classification">
      <p className="panel-label">{t("finance.cashflow.classification")}</p>
      <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.cashflow.classificationHint")}</p>
      <ul className="mt-2 space-y-1">
        {categories.map((category) => (
          <li key={category.label} className="flex items-center gap-2 text-xs">
            <span className="flex-1 truncate text-[var(--text-2)]" title={category.label}>
              {category.label}
            </span>
            <span className="text-[10px] text-[var(--text-3)]">
              {t(`finance.cashflow.${category.kind}`)}
              {category.confidence < CONFIRM_BELOW ? ` · ${t("finance.cashflow.needsConfirming")}` : ""}
            </span>
            {category.kind === "outflow" ? (
              <select
                className="input w-28 px-1 py-0.5 text-[11px]"
                aria-label={`${t("finance.cashflow.costBehaviour")}: ${category.label}`}
                value={category.behaviour ?? "fixed"}
                onChange={(event) =>
                  onItems(withCategoryBehaviour(items, category.label, event.target.value as CostBehaviour))
                }
                disabled={disabled}
                data-testid={`cashflow-behaviour-${category.label}`}
              >
                {BEHAVIOURS.map((behaviour) => (
                  <option key={behaviour} value={behaviour}>
                    {t(`finance.cashflow.${behaviour}`)}
                  </option>
                ))}
              </select>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CashflowInputs({ locked, draft, setDraft, onGenerate }: FinanceStepProps) {
  // The registry holds five tasks whose drafts have nothing in common, so each narrows its own once.
  const cashflow = draft as unknown as CashflowStepDraft;
  const items = cashflowItemsOf(cashflow.items);
  const preview = cashflowPreview(items, cashflow.params);
  const setItems = (next: CashflowItem[]) => setDraft({ items: lineItemsOf(next) });
  const language = getLocale() === "en" ? "en" : "id";

  /*
   * Rows that never went through this task's parse — typed by hand, or left over from the brief's
   * line-item read — are folded into the one-row-per-side-per-period shape this panel edits, once.
   */
  useEffect(() => {
    if (items.length > 0 && items.some((item) => item.kind === undefined)) {
      setItems(normaliseCashflowItems(items, language));
    }
  });

  return (
    <section
      className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="finance-inputs"
    >
      <div>
        <label htmlFor="cashflow-figures" className="panel-label">
          {t("finance.cashflow.figures")}
        </label>
        <textarea
          id="cashflow-figures"
          rows={5}
          value={cashflow.figures}
          onChange={(event) => setDraft({ figures: event.target.value })}
          className="input mt-2 text-[13px]"
          placeholder={t("finance.cashflow.figuresPlaceholder")}
          disabled={locked}
          data-testid="finance-figures-input"
        />
        <button
          type="button"
          className="btn mt-2"
          onClick={() => onGenerate({ kind: "parse" })}
          disabled={locked || !cashflow.figures.trim()}
          data-testid="finance-parse"
        >
          {cashflow.parsing ? t("finance.cashflow.reading") : t("finance.cashflow.read")}
        </button>
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.cashflow.readHint")}</p>
      </div>
      {/* An upload only fills the box above; the owner still reads it and confirms every period. */}
      <FinanceFileUpload
        onFigures={(text) => setDraft({ figures: mergeFigures(cashflow.figures, text) })}
        disabled={locked}
      />
      <div>
        <label htmlFor="cashflow-opening" className="panel-label">
          {t("finance.cashflow.openingCash")}
        </label>
        <input
          id="cashflow-opening"
          type="number"
          step="any"
          className="input mt-2 px-2 py-1 text-xs"
          value={openingCashOf(items, cashflow.params)}
          onChange={(event) =>
            setDraft({
              params: withCashflowParams(cashflow.params, {
                openingCash: event.target.value === "" ? undefined : Number(event.target.value),
              }),
            })
          }
          disabled={locked}
          data-testid="cashflow-opening-cash"
        />
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.cashflow.openingCashHint")}</p>
      </div>
      <div>
        <p className="panel-label">{t("finance.cashflow.periods")}</p>
        <div className="mt-2">
          <CashflowPeriodsTable items={items} onItems={setItems} preview={preview} disabled={locked} />
        </div>
      </div>
      <Classification items={items} onItems={setItems} disabled={locked} />
      <Summary items={items} params={cashflow.params} />
      <CashflowWhatIf
        params={cashflow.params}
        onParams={(next) => setDraft({ params: next })}
        preview={preview}
        disabled={locked}
      />
    </section>
  );
}

export const CASHFLOW_STEPS: FinanceStepEntry = { Inputs: CashflowInputs, Result: CashflowResult };

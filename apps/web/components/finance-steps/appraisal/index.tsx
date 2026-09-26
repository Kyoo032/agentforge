"use client";

/**
 * The investment appraisal's steps: the flows, the rate, the grid axes, and what they already imply.
 *
 * The flow graph this panel draws is outlay + yearly flows → set discount rate → confirm flows, and
 * it draws them in that order down the panel. Every figure under "computed now" is produced by the
 * same core functions the report will use, so nothing on this screen can disagree with the memo the
 * model is later asked to write over it — and none of it costs a token.
 */
import { useMemo } from "react";
import { appraisalAmount, appraisalPercent, appraisalRatio, appraisalYears } from "@agentforge/core/finance";
import { FinanceFileUpload } from "@/components/finance-file-upload";
import type { DatasetSummary } from "@/lib/data-client";
import { mergeFigures } from "@/lib/finance-brief";
import type { LineItem } from "@/lib/finance-client";
import {
  addNextYear,
  appraisalPreview,
  appraisalYearRows,
  formatNumberList,
  gridAxes,
  parseNumberList,
  prefilledRate,
  removeYear,
  setYearAmount,
  type AppraisalParams,
} from "@/lib/finance-appraisal";
import { getLocale, t } from "@/lib/i18n";
import type { FinanceSource } from "../finance-inputs-panel";
import { AppraisalResult } from "./result";
import { FinanceFold } from "../finance-guide";
import type { FinanceStepDraft, FinanceStepEntry, FinanceStepProps } from "../types";

/** The appraisal's own view of the studio's draft bag. The studio owns the state; this names it. */
export type AppraisalStepDraft = {
  readonly figures: string;
  readonly items: LineItem[];
  readonly params: AppraisalParams;
  readonly source: FinanceSource;
  readonly datasets: readonly DatasetSummary[];
  readonly parsing: boolean;
};

const CELL = "border-b border-[var(--line)] px-2 py-1 text-[var(--text)]";

function YearTable({
  items,
  currency,
  locked,
  onItems,
}: {
  items: LineItem[];
  currency: string;
  locked: boolean;
  onItems: (next: LineItem[]) => void;
}) {
  const locale = getLocale();
  const rows = appraisalYearRows(items);
  const netLabel = t("finance.appraisal.amount");
  return (
    <table className="w-full text-left text-xs" data-testid="appraisal-flows">
      <thead>
        <tr className="text-[var(--text-3)]">
          <th className={CELL}>{t("finance.items.period")}</th>
          <th className={CELL}>{netLabel}</th>
          <th className={CELL} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.period}>
            <td className={CELL}>
              <span className="font-medium">{row.period}</span>
              {row.components.length > 1 ? (
                <span className="mt-0.5 block text-[10px] text-[var(--text-3)]">
                  {t("finance.appraisal.components")}:{" "}
                  {row.components
                    .map((part) => `${part.label} ${appraisalAmount(part.amount, locale, "")}`)
                    .join(" · ")}
                </span>
              ) : null}
            </td>
            <td className={CELL}>
              <input
                type="number"
                step="any"
                className="input px-2 py-1 text-xs"
                value={row.amount}
                aria-label={t("finance.appraisal.yearAria", { period: row.period })}
                onChange={(event) => onItems(setYearAmount(items, row.period, Number(event.target.value), netLabel))}
                disabled={locked}
                data-testid={`appraisal-flow-${row.year}`}
              />
            </td>
            <td className={CELL}>
              <button
                type="button"
                className="text-[var(--text-3)] hover:text-[var(--danger)]"
                onClick={() => onItems(removeYear(items, row.period))}
                disabled={locked}
                aria-label={t("finance.appraisal.removeYearAria", { period: row.period })}
              >
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td className="px-2 py-2" colSpan={3}>
            <button
              type="button"
              className="btn"
              onClick={() => onItems(addNextYear(items, netLabel))}
              disabled={locked}
              data-testid="appraisal-add-year"
            >
              {t("finance.appraisal.addYear")}
            </button>
            <span className="ml-2 text-[10px] text-[var(--text-3)]">{currency}</span>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  locked,
  onValue,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  locked: boolean;
  onValue: (raw: string) => void;
}) {
  return (
    <label htmlFor={id} className="text-xs text-[var(--text-2)]" title={hint}>
      {label}
      <input
        id={id}
        className="input mt-1 px-2 py-1 text-xs"
        value={value}
        onChange={(event) => onValue(event.target.value)}
        disabled={locked}
        data-testid={id}
      />
    </label>
  );
}

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--text-3)]">{label}</span>
      <span className="font-medium text-[var(--text)]">{value}</span>
    </div>
  );
}

/** What the confirmed rows already say, computed in code before anything is narrated. */
function Preview({ items, params, figures }: { items: LineItem[]; params: AppraisalParams; figures: string }) {
  const locale = getLocale();
  const computed = useMemo(() => appraisalPreview(items, params, figures), [items, params, figures]);
  if (!computed) {
    return <p className="text-xs text-[var(--text-3)]">{t("finance.appraisal.empty")}</p>;
  }
  const money = computed.currency;
  const cells = computed.ratePercents.length * computed.shiftPercents.length;
  return (
    <div className="space-y-1 text-xs" data-testid="appraisal-preview">
      <PreviewLine
        label={t("finance.appraisal.npv", { rate: formatNumberList([computed.discountRatePercent]) })}
        value={appraisalAmount(computed.npv, locale, money)}
      />
      <PreviewLine
        label={t("finance.appraisal.irr")}
        value={
          computed.irr.unique ? appraisalPercent(computed.irr.irrPercent, locale) : t("finance.appraisal.notAvailable")
        }
      />
      <PreviewLine
        label={t("finance.appraisal.payback")}
        value={`${appraisalYears(computed.paybackYears, locale)} ${t("finance.appraisal.years")}`}
      />
      <PreviewLine
        label={t("finance.appraisal.discountedPayback")}
        value={`${appraisalYears(computed.discountedPaybackYears, locale)} ${t("finance.appraisal.years")}`}
      />
      <PreviewLine
        label={t("finance.appraisal.profitabilityIndex")}
        value={appraisalRatio(computed.profitabilityIndex, locale)}
      />
      {computed.irr.unique ? null : (
        <p className="pt-1 text-[11px] text-[var(--danger)]">
          {t("finance.appraisal.irrNotUnique", { count: computed.irr.crossings })}
        </p>
      )}
      {computed.negativeCells.length > 0 ? (
        <p className="pt-1 text-[11px] text-[var(--text-2)]" data-testid="appraisal-negative-cells">
          {t("finance.appraisal.negativeCells", { count: computed.negativeCells.length, total: cells })}
        </p>
      ) : null}
      {computed.negativeYears.length > 0 ? (
        <p className="text-[11px] text-[var(--text-2)]">
          {t("finance.appraisal.negativeYears", {
            periods: computed.negativeYears.map((year) => year.period).join(", "),
          })}
        </p>
      ) : null}
    </div>
  );
}

export function AppraisalInputs({ locked, draft, setDraft }: FinanceStepProps) {
  // The registry holds five tasks whose drafts have nothing in common, so each narrows its own once.
  const appraisal = draft as unknown as AppraisalStepDraft;
  const { figures, items, params } = appraisal;
  const rate = prefilledRate(params, figures);
  const axes = gridAxes(params, rate);
  const rows = appraisalYearRows(items);

  function patchParams(patch: Partial<AppraisalParams>): void {
    setDraft({ params: { ...params, ...patch } } as FinanceStepDraft);
  }

  return (
    <section
      className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="finance-inputs"
    >
      <FinanceFileUpload onFigures={(text) => setDraft({ figures: mergeFigures(figures, text) })} disabled={locked} />
      <div>
        <label htmlFor="appraisal-figures" className="panel-label">
          {t("finance.appraisal.figures")}
        </label>
        <textarea
          id="appraisal-figures"
          rows={5}
          value={figures}
          onChange={(event) => setDraft({ figures: event.target.value })}
          className="input mt-2 text-[13px]"
          placeholder={t("finance.appraisal.figuresPlaceholder")}
          disabled={locked}
          data-testid="finance-figures-input"
        />
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.appraisal.flowsHint")}</p>
      </div>
      <FinanceFold>
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            id="appraisal-discount-rate"
            label={t("finance.appraisal.discountRate")}
            hint={t("finance.appraisal.discountRateHint")}
            value={params.discountRatePercent === undefined ? "" : String(params.discountRatePercent)}
            locked={locked}
            onValue={(raw) => patchParams({ discountRatePercent: raw === "" ? undefined : Number(raw) })}
          />
          <NumberField
            id="appraisal-rate-scenarios"
            label={t("finance.appraisal.rateScenarios")}
            hint={t("finance.appraisal.axesHint")}
            value={formatNumberList(axes.ratePercents)}
            locked={locked}
            onValue={(raw) => patchParams({ rateScenarios: parseNumberList(raw) })}
          />
          <NumberField
            id="appraisal-cash-flow-shifts"
            label={t("finance.appraisal.cashFlowShifts")}
            hint={t("finance.appraisal.axesHint")}
            value={formatNumberList(axes.shiftPercents)}
            locked={locked}
            onValue={(raw) => patchParams({ cashFlowShifts: parseNumberList(raw) })}
          />
        </div>
      </FinanceFold>
      <div>
        <p className="panel-label">
          {t("finance.appraisal.flows")}
          {rows.length > 0 ? ` · ${t("finance.appraisal.confirmed", { count: rows.length })}` : ""}
        </p>
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.appraisal.flowsHint")}</p>
        <div className="mt-2">
          <YearTable
            items={items}
            currency={items[0]?.currency ?? ""}
            locked={locked}
            onItems={(next) => setDraft({ items: next })}
          />
        </div>
      </div>
      <div>
        <p className="panel-label">{t("finance.appraisal.preview")}</p>
        <div className="mt-2">
          <Preview items={items} params={params} figures={figures} />
        </div>
      </div>
    </section>
  );
}

export const APPRAISAL_STEPS: FinanceStepEntry = {
  Inputs: AppraisalInputs,
  // A task that owns its maths answers with a report and no brief, so it renders its own result.
  Result: AppraisalResult,
};

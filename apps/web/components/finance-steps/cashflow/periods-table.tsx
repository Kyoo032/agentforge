"use client";

/**
 * The cash book, editable.
 *
 * One row per period with the two sides on it, the running balance beside them, and the cost
 * behaviour under the outflow. The reader retypes anything that is wrong here, and the figures under
 * the panel move with it: this table *is* the confirm step, not a preview of one.
 */
import {
  formatCashflowValue,
  type CashflowComputed,
  type CashflowItem,
  type CostBehaviour,
} from "@agentforge/core/finance";
import {
  cashflowPeriodRows,
  withBreakdownSlice,
  withPeriodAmount,
  type CashflowEditField,
} from "@/lib/finance-cashflow";
import { getLocale } from "@/lib/i18n";
import { t } from "@/lib/i18n";

export type CashflowPeriodsTableProps = {
  readonly items: readonly CashflowItem[];
  readonly onItems: (next: CashflowItem[]) => void;
  readonly preview: CashflowComputed | null;
  readonly disabled: boolean;
};

const SLICES: readonly CostBehaviour[] = ["variable", "fixed", "oneOff"];

function AmountInput({
  value,
  label,
  disabled,
  onChange,
  testId,
}: {
  value: number;
  label: string;
  disabled: boolean;
  onChange: (next: number) => void;
  testId: string;
}) {
  return (
    <input
      type="number"
      step="any"
      aria-label={label}
      className="input px-2 py-1 text-right text-xs"
      value={Number.isFinite(value) ? value : 0}
      onChange={(event) => onChange(event.target.value === "" ? 0 : Number(event.target.value))}
      disabled={disabled}
      data-testid={testId}
    />
  );
}

export function CashflowPeriodsTable({ items, onItems, preview, disabled }: CashflowPeriodsTableProps) {
  const rows = cashflowPeriodRows(items);
  const locale = getLocale() === "en" ? "en" : "id";
  const currency = preview?.currency ?? "";
  const walked = preview?.periods ?? [];
  const edit = (period: string, field: CashflowEditField) => (next: number) =>
    onItems(withPeriodAmount(items, period, field, next));

  if (rows.length === 0) {
    return (
      <p className="text-xs text-[var(--text-3)]" data-testid="cashflow-no-periods">
        {t("finance.cashflow.noPeriods")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto" data-testid="cashflow-periods">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[var(--text-3)]">
            <th className="py-1 pr-2 font-medium">{t("finance.cashflow.period")}</th>
            <th className="py-1 pr-2 text-right font-medium">{t("finance.cashflow.cashIn")}</th>
            <th className="py-1 pr-2 text-right font-medium">{t("finance.cashflow.cashOut")}</th>
            <th className="py-1 pr-2 text-right font-medium">{t("finance.cashflow.financing")}</th>
            <th className="py-1 pr-2 text-right font-medium">{t("finance.cashflow.net")}</th>
            <th className="py-1 text-right font-medium">{t("finance.cashflow.closing")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, at) => {
            const computed = walked[at];
            return (
              <tr key={row.period} className="border-t border-[var(--line)] align-top">
                <td className="py-1 pr-2 text-[var(--text-2)]">{row.period}</td>
                <td className="py-1 pr-2">
                  <AmountInput
                    value={row.cashIn}
                    label={`${t("finance.cashflow.cashIn")} ${row.period}`}
                    disabled={disabled}
                    onChange={edit(row.period, "cashIn")}
                    testId={`cashflow-in-${at}`}
                  />
                </td>
                <td className="py-1 pr-2">
                  <AmountInput
                    value={row.cashOut}
                    label={`${t("finance.cashflow.cashOut")} ${row.period}`}
                    disabled={disabled}
                    onChange={edit(row.period, "cashOut")}
                    testId={`cashflow-out-${at}`}
                  />
                  <div className="mt-1 flex flex-wrap gap-1">
                    {SLICES.map((slice) => (
                      <label key={slice} className="text-[10px] text-[var(--text-3)]">
                        {t(`finance.cashflow.${slice}`)}
                        <input
                          type="number"
                          step="any"
                          aria-label={`${t(`finance.cashflow.${slice}`)} ${row.period}`}
                          className="input w-20 px-1 py-0.5 text-right text-[10px]"
                          value={row.breakdown[slice]}
                          onChange={(event) =>
                            onItems(
                              withBreakdownSlice(
                                items,
                                row.period,
                                slice,
                                event.target.value === "" ? 0 : Number(event.target.value),
                              ),
                            )
                          }
                          disabled={disabled}
                          data-testid={`cashflow-${slice}-${at}`}
                        />
                      </label>
                    ))}
                  </div>
                </td>
                <td className="py-1 pr-2">
                  <AmountInput
                    value={row.financingIn}
                    label={`${t("finance.cashflow.financing")} ${row.period}`}
                    disabled={disabled}
                    onChange={edit(row.period, "financingIn")}
                    testId={`cashflow-financing-${at}`}
                  />
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-2)]">
                  {formatCashflowValue(computed?.netOperating ?? null, "currency", locale, currency)}
                </td>
                <td className="py-1 text-right tabular-nums text-[var(--text)]">
                  {formatCashflowValue(computed?.closingCash ?? null, "currency", locale, currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

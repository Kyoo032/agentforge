"use client";

import { LINE_ITEM_CATEGORIES, emptyLineItem, type LineItem, type LineItemCategory } from "@/lib/finance-client";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";

type Props = {
  items: LineItem[];
  onChange: (next: LineItem[]) => void;
  disabled?: boolean;
  testId?: string;
};

const CELL = "input px-2 py-1 text-xs";

/** Editable line items. Every figure the brief may use comes from these rows. */
export function LineItemEditor({ items, onChange, disabled = false, testId = "finance-items" }: Props) {
  function update(index: number, patch: Partial<LineItem>) {
    onChange(items.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-3)]">
              <th className="pr-2 font-medium">{t("finance.items.label")}</th>
              <th className="pr-2 font-medium">{t("finance.items.period")}</th>
              <th className="pr-2 font-medium">{t("finance.items.amount")}</th>
              <th className="pr-2 font-medium">{t("finance.items.currency")}</th>
              <th className="pr-2 font-medium">{t("finance.items.category")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${index}-${items.length}`} data-testid={`${testId}-row`}>
                <td className="pr-2 py-0.5">
                  <input
                    className={CELL}
                    value={item.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                    disabled={disabled}
                    aria-label={t("finance.items.label")}
                    data-testid={`${testId}-label`}
                  />
                </td>
                <td className="pr-2 py-0.5">
                  <input
                    className={`${CELL} w-24`}
                    value={item.period}
                    onChange={(event) => update(index, { period: event.target.value })}
                    disabled={disabled}
                    aria-label={t("finance.items.period")}
                  />
                </td>
                <td className="pr-2 py-0.5">
                  <input
                    className={`${CELL} w-32 text-right`}
                    type="number"
                    step="any"
                    value={Number.isFinite(item.amount) ? item.amount : ""}
                    onChange={(event) => update(index, { amount: Number(event.target.value) })}
                    disabled={disabled}
                    aria-label={t("finance.items.amount")}
                    data-testid={`${testId}-amount`}
                  />
                </td>
                <td className="pr-2 py-0.5">
                  <input
                    className={`${CELL} w-16 uppercase`}
                    value={item.currency}
                    maxLength={8}
                    onChange={(event) => update(index, { currency: event.target.value.toUpperCase() })}
                    disabled={disabled}
                    aria-label={t("finance.items.currency")}
                  />
                </td>
                <td className="pr-2 py-0.5">
                  <select
                    className={CELL}
                    value={item.category}
                    onChange={(event) => update(index, { category: event.target.value as LineItemCategory })}
                    disabled={disabled}
                    aria-label={t("finance.items.category")}
                  >
                    {LINE_ITEM_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {labeled(`finance.category.${category}`, category)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-0.5">
                  <button
                    type="button"
                    className="text-xs text-[var(--danger)] hover:underline disabled:opacity-50"
                    onClick={() => onChange(items.filter((_, at) => at !== index))}
                    disabled={disabled}
                    aria-label={t("finance.items.removeAria")}
                  >
                    {t("finance.items.remove")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn text-xs"
        onClick={() => onChange([...items, emptyLineItem()])}
        disabled={disabled}
        data-testid={`${testId}-add`}
      >
        {t("finance.items.add")}
      </button>
    </div>
  );
}

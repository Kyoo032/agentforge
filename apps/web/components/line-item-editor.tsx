"use client";

import { LINE_ITEM_CATEGORIES, emptyLineItem, type LineItem, type LineItemCategory } from "@/lib/finance-client";

type Props = {
  items: LineItem[];
  onChange: (next: LineItem[]) => void;
  disabled?: boolean;
  testId?: string;
};

const CELL = "input px-2 py-1 text-[12px]";

/** Editable line items. Every figure the brief may use comes from these rows. */
export function LineItemEditor({ items, onChange, disabled = false, testId = "finance-items" }: Props) {
  function update(index: number, patch: Partial<LineItem>) {
    onChange(items.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[color-mix(in_srgb,var(--color-text)_50%,transparent)]">
              <th className="pr-2 font-medium">Label</th>
              <th className="pr-2 font-medium">Period</th>
              <th className="pr-2 font-medium">Amount</th>
              <th className="pr-2 font-medium">Currency</th>
              <th className="pr-2 font-medium">Category</th>
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
                    aria-label="Label"
                    data-testid={`${testId}-label`}
                  />
                </td>
                <td className="pr-2 py-0.5">
                  <input
                    className={`${CELL} w-24`}
                    value={item.period}
                    onChange={(event) => update(index, { period: event.target.value })}
                    disabled={disabled}
                    aria-label="Period"
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
                    aria-label="Amount"
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
                    aria-label="Currency"
                  />
                </td>
                <td className="pr-2 py-0.5">
                  <select
                    className={CELL}
                    value={item.category}
                    onChange={(event) => update(index, { category: event.target.value as LineItemCategory })}
                    disabled={disabled}
                    aria-label="Category"
                  >
                    {LINE_ITEM_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-0.5">
                  <button
                    type="button"
                    className="text-xs text-red-700 hover:underline disabled:opacity-50"
                    onClick={() => onChange(items.filter((_, at) => at !== index))}
                    disabled={disabled}
                    aria-label="Remove line item"
                  >
                    Remove
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
        Add line item
      </button>
    </div>
  );
}

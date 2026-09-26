"use client";

import { FinanceFileUpload } from "@/components/finance-file-upload";
import { LineItemEditor } from "@/components/line-item-editor";
import type { DatasetSummary } from "@/lib/data-client";
import { mergeFigures } from "@/lib/finance-brief";
import { FINANCE_PARAM_FIELDS, type FinanceParams, type LineItem, type StatedFact } from "@/lib/finance-client";
import { t } from "@/lib/i18n";
import { labeled } from "@/lib/ui-copy";
import { StatedFactsList } from "./brief/stated-facts-list";

/** Where the line items come from: the rows on screen, or a saved dataset. */
export type FinanceSource = { kind: "items" } | { kind: "dataset"; id: string };

export type FinanceInputsPanelProps = {
  figures: string;
  /** The second argument is a document's prose, when the upload had one to hand over. */
  onFigures: (value: string, proseText?: string) => void;
  locked: boolean;
  datasets: readonly DatasetSummary[];
  source: FinanceSource;
  onSource: (next: FinanceSource) => void;
  items: LineItem[];
  onItems: (next: LineItem[]) => void;
  params: FinanceParams;
  onParams: (next: FinanceParams) => void;
  confirmedCount: number;
  /** Figures the document stated in a sentence. Absent for every task that does not read documents. */
  statedFacts?: readonly StatedFact[];
  onStatedFacts?: (next: StatedFact[]) => void;
};

/** Drop a parameter when its box is cleared; never mutate the object we were given. */
function nextParams(params: FinanceParams, key: keyof FinanceParams, raw: string): FinanceParams {
  const { [key]: _dropped, ...rest } = params;
  return raw === "" ? rest : { ...rest, [key]: Number(raw) };
}

/**
 * The brief's inputs: pasted figures, the spreadsheet upload that fills them, the optional
 * saved dataset, the confirmed line items, and the optional parameters. Split out of `finance-studio` so the
 * studio itself stays a shell that picks which steps a task renders.
 */
export function FinanceInputsPanel({
  figures,
  onFigures,
  locked,
  datasets,
  source,
  onSource,
  items,
  onItems,
  params,
  onParams,
  confirmedCount,
  statedFacts = [],
  onStatedFacts,
}: FinanceInputsPanelProps) {
  return (
    <section
      className="space-y-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"
      data-testid="finance-inputs"
    >
      {/* The file is the first action. Using it fills the box below; the footer reads the numbers. */}
      <FinanceFileUpload onFigures={(text, prose) => onFigures(mergeFigures(figures, text), prose)} disabled={locked} />
      <div>
        <label htmlFor="finance-figures-input" className="panel-label">
          {t("finance.pasteFigures")}
        </label>
        <textarea
          id="finance-figures-input"
          rows={5}
          value={figures}
          onChange={(event) => onFigures(event.target.value)}
          className="input mt-2 text-[13px]"
          placeholder={t("finance.figuresPlaceholder")}
          disabled={locked}
          data-testid="finance-figures-input"
        />
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.parseHint")}</p>
      </div>
      {onStatedFacts ? <StatedFactsList facts={statedFacts} onChange={onStatedFacts} disabled={locked} /> : null}
      {datasets.length > 0 ? (
        <div>
          <label htmlFor="finance-dataset" className="panel-label">
            {t("finance.orDataset")}
          </label>
          <select
            id="finance-dataset"
            className="input mt-2"
            value={source.kind === "dataset" ? source.id : ""}
            onChange={(event) =>
              onSource(event.target.value ? { kind: "dataset", id: event.target.value } : { kind: "items" })
            }
            disabled={locked}
            data-testid="finance-dataset"
          >
            <option value="">{t("finance.lineItemsBelow")}</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {t("finance.datasetOption", { name: dataset.name, rows: dataset.rows })}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div>
        <p className="panel-label">
          {confirmedCount > 0 ? t("finance.lineItemsCount", { count: confirmedCount }) : t("finance.lineItems")}
          {source.kind === "dataset" ? t("finance.fromDataset") : ""}
        </p>
        <div className="mt-2">
          <LineItemEditor items={items} onChange={onItems} disabled={locked} />
        </div>
      </div>
      {/*
        Parameters stay next to the rows, but folded: they are optional levers on the maths
        (a discount rate, a price and a variable cost) and most runs want none of them. Open
        by default, four number boxes read as "you must fill this in" when the answer is
        "only if you want NPV or breakeven" (owner report 2026-09-23).
      */}
      <details className="rounded-lg border border-[var(--line)] px-3 py-2" data-testid="finance-parameters">
        <summary className="cursor-pointer select-none text-xs font-medium text-[var(--text-2)]">
          {t("finance.advanced")}
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {FINANCE_PARAM_FIELDS.map((field) => (
            <label
              key={field.key}
              className="text-xs text-[var(--text-2)]"
              title={labeled(`finance.params.${field.key}Hint`, field.hint)}
            >
              {labeled(`finance.params.${field.key}`, field.label)}
              <input
                type="number"
                step="any"
                className="input mt-1 px-2 py-1 text-xs"
                value={params[field.key] ?? ""}
                onChange={(event) => onParams(nextParams(params, field.key, event.target.value))}
                disabled={locked}
                data-testid={`finance-param-${field.key}`}
              />
            </label>
          ))}
        </div>
      </details>
    </section>
  );
}

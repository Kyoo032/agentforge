"use client";

/**
 * The what-if, and the figures it moves.
 *
 * Structured controls only: each lever writes a typed adjustment and the maths is recomputed in code
 * on every keystroke, so what the reader sees here is exactly what the report will say. No model is
 * asked anything, and nothing below is a forecast — it is the same book, arithmetic done again.
 */
import { formatCashflowValue, type CashflowComputed, type CashflowParams } from "@agentforge/core/finance";
import type { FinanceParams } from "@/lib/finance-client";
import { cashflowParamsOf, withCashflowParams } from "@/lib/finance-cashflow";
import { getLocale, t } from "@/lib/i18n";

export type CashflowWhatIfProps = {
  readonly params: FinanceParams;
  readonly onParams: (next: FinanceParams) => void;
  readonly preview: CashflowComputed | null;
  readonly disabled: boolean;
};

type LeverKey = "salesLiftPct" | "rentCutPct" | "newHires" | "costPerHire" | "recurringCostPerPeriod" | "oneOffCost";

const LEVERS: ReadonlyArray<{ readonly key: LeverKey; readonly copy: string }> = Object.freeze([
  { key: "salesLiftPct", copy: "salesLift" },
  { key: "rentCutPct", copy: "rentCut" },
  { key: "newHires", copy: "hires" },
  { key: "costPerHire", copy: "costPerHire" },
  { key: "recurringCostPerPeriod", copy: "recurring" },
  { key: "oneOffCost", copy: "oneOffCost" },
]);

function Figure({ label, value, display }: { label: string; value: number | null; display: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">{label}</div>
      <div className="tabular-nums text-[var(--text)]" data-testid={`cashflow-figure-${label}`}>
        {value === null ? t("finance.cashflow.notAvailable") : display}
      </div>
    </div>
  );
}

export function CashflowWhatIf({ params, onParams, preview, disabled }: CashflowWhatIfProps) {
  const locale = getLocale() === "en" ? "en" : "id";
  const current: CashflowParams = cashflowParamsOf(params);
  const outcome = preview?.outcomes.find((entry) => entry.basis === "recentAverage") ?? preview?.outcomes[0] ?? null;
  const money = (value: number | null) => formatCashflowValue(value, "currency", locale, preview?.currency ?? "");
  const months = (value: number | null) => formatCashflowValue(value, "months", locale);

  return (
    <div className="space-y-3" data-testid="cashflow-what-if">
      <div>
        <p className="panel-label">{t("finance.cashflow.whatIf")}</p>
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.cashflow.whatIfHint")}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {LEVERS.map((lever) => (
          <label key={lever.key} className="text-xs text-[var(--text-2)]">
            {t(`finance.cashflow.${lever.copy}`)}
            <input
              type="number"
              step="any"
              className="input mt-1 px-2 py-1 text-xs"
              value={current[lever.key] ?? ""}
              onChange={(event) =>
                onParams(
                  withCashflowParams(params, {
                    [lever.key]: event.target.value === "" ? undefined : Number(event.target.value),
                  }),
                )
              }
              disabled={disabled}
              data-testid={`cashflow-lever-${lever.key}`}
            />
          </label>
        ))}
      </div>
      {outcome ? (
        <div className="grid grid-cols-2 gap-2 text-xs" data-testid="cashflow-what-if-figures">
          <Figure label={t("finance.cashflow.net")} value={outcome.netOperating} display={money(outcome.netOperating)} />
          <Figure label={t("finance.cashflow.netBurn")} value={outcome.netBurn} display={money(outcome.netBurn)} />
          <Figure
            label={t("finance.cashflow.grossBurn")}
            value={outcome.grossBurn}
            display={money(outcome.grossBurn)}
          />
          <Figure
            label={t("finance.cashflow.scenarioRunway")}
            value={outcome.runwayMonths}
            display={months(outcome.runwayMonths)}
          />
        </div>
      ) : (
        <p className="text-xs text-[var(--text-3)]">{t("finance.cashflow.whatIfEmpty")}</p>
      )}
    </div>
  );
}

"use client";

/**
 * The thresholds, on screen and editable.
 *
 * A band is a convention, not a fact about this company, so it is shown rather than applied
 * silently — and the heading says "rule of thumb" in both languages before a single colour appears.
 * An owner who reads manufacturing balance sheets all day should be able to move the line and watch
 * the scorecard move with it.
 */
import { RATIO_RATIO_METRICS, sayRatioText, type FinanceParams } from "@agentforge/core/finance";
import { ratiosBands, withRatiosBand, withoutRatiosBands } from "@/lib/finance-ratios-draft";
import { getLocale, t } from "@/lib/i18n";

const TD = "border-b border-[var(--line)] px-2 py-1";

export type RatiosBandsEditorProps = {
  readonly params: FinanceParams;
  readonly onParams: (next: FinanceParams) => void;
  readonly disabled: boolean;
};

function labelFor(metric: string, locale: "id" | "en"): string {
  const meta = RATIO_RATIO_METRICS.find((entry) => entry.key === metric);
  return meta ? sayRatioText(meta.label, locale) : metric;
}

export function RatiosBandsEditor({ params, onParams, disabled }: RatiosBandsEditorProps) {
  const locale = getLocale() === "id" ? "id" : "en";
  const bands = ratiosBands(params);
  return (
    <details className="rounded-lg border border-[var(--line)] px-3 py-2" data-testid="finance-ratios-bands">
      <summary className="cursor-pointer text-xs font-medium text-[var(--text-2)]">
        {t("finance.ratios.bands.heading")}
      </summary>
      <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.ratios.bands.hint")}</p>
      <div className="mt-2 max-h-56 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={`${TD} text-left font-medium text-[var(--text-2)]`}>
                {t("finance.ratios.scorecard.metric")}
              </th>
              <th className={`${TD} text-left font-medium text-[var(--text-2)]`}>
                {t("finance.ratios.bands.healthy")}
              </th>
              <th className={`${TD} text-left font-medium text-[var(--text-2)]`}>{t("finance.ratios.bands.watch")}</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((rule) => (
              <tr key={rule.metric}>
                <td className={`${TD} text-[var(--text)]`}>{labelFor(rule.metric, locale)}</td>
                <td className={TD}>
                  <input
                    type="number"
                    step="any"
                    className="input px-1 py-0.5 text-xs"
                    value={rule.healthy}
                    onChange={(event) =>
                      onParams(withRatiosBand(params, rule.metric, Number(event.target.value), rule.watch))
                    }
                    disabled={disabled}
                    aria-label={t("finance.ratios.bands.healthyAria", { metric: labelFor(rule.metric, locale) })}
                  />
                </td>
                <td className={TD}>
                  <input
                    type="number"
                    step="any"
                    className="input px-1 py-0.5 text-xs"
                    value={rule.watch}
                    onChange={(event) =>
                      onParams(withRatiosBand(params, rule.metric, rule.healthy, Number(event.target.value)))
                    }
                    disabled={disabled}
                    aria-label={t("finance.ratios.bands.watchAria", { metric: labelFor(rule.metric, locale) })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="btn mt-2 px-2 py-1 text-xs"
        onClick={() => onParams(withoutRatiosBands(params))}
        disabled={disabled}
        data-testid="finance-ratios-bands-reset"
      >
        {t("finance.ratios.bands.reset")}
      </button>
    </details>
  );
}

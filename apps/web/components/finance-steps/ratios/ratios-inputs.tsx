"use client";

/**
 * The ratio task's inputs: a statement in, every row classified, the balance checked, then generate.
 *
 * The order on screen is the order of the flow graph — paste or upload, read, confirm the buckets,
 * pick the period, and only then the scorecard. The parse call is this panel's own rather than the
 * studio's, because the studio's answer is rows alone and this task confirms rows *and* buckets.
 */
import { useState } from "react";
import type { RatioBucket } from "@agentforge/core/finance";
import { FinanceFileUpload } from "@/components/finance-file-upload";
import { mergeFigures } from "@/lib/finance-brief";
import type { FinanceParams, LineItem } from "@/lib/finance-client";
import { parseRatiosStatement, type RatiosParsed } from "@/lib/finance-ratios-client";
import {
  ratiosBalance,
  ratiosOverrides,
  ratiosPeriods,
  ratiosReadPeriod,
  withBucketChange,
  withRatiosNumber,
  withRatiosParams,
  type RatiosBucketChanges,
  type RatiosClassifiedRow,
} from "@/lib/finance-ratios-draft";
import { t } from "@/lib/i18n";
import { FinanceFold } from "../finance-guide";
import { useFinanceRead } from "../finance-read";
import type { FinanceStepProps } from "../types";
import { RatiosBalanceBanner } from "./balance-banner";
import { RatiosBandsEditor } from "./bands-editor";
import { RatiosBucketTable, unplacedCount } from "./bucket-table";

/** The draft this task reads out of the studio's bag. The same three fields the brief uses. */
export type RatiosStepDraft = {
  readonly figures: string;
  readonly items: LineItem[];
  readonly params: FinanceParams;
};

const SUPPORTING_FIELDS = ["depreciation", "principalRepayment", "daysPerYear"] as const;

function assistNotice(parsed: RatiosParsed | null): string | null {
  if (!parsed?.modelAssist) {
    return null;
  }
  const { asked, placed, error } = parsed.modelAssist;
  return error ? t("finance.ratios.modelAssistFailed", { asked }) : t("finance.ratios.modelAssist", { asked, placed });
}

export function RatiosInputs({ locked, model, draft, setDraft }: FinanceStepProps) {
  // The registry holds five tasks whose drafts have nothing in common, so each narrows its own once.
  const ratios = draft as RatiosStepDraft;
  const [parsed, setParsed] = useState<RatiosParsed | null>(null);
  const [changes, setChanges] = useState<RatiosBucketChanges>({});
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows: readonly RatiosClassifiedRow[] = parsed?.buckets ?? [];
  const currency = ratios.items.find((item) => item.currency)?.currency ?? "";
  const periods = ratiosPeriods(ratios.items);
  const readPeriod = ratiosReadPeriod(ratios.items, ratios.params);
  const unplaced = unplacedCount(rows, changes);
  const busy = locked || reading;

  function onBucket(row: RatiosClassifiedRow, bucket: RatioBucket): void {
    const next = withBucketChange(changes, row, bucket);
    setChanges(next);
    setDraft({ params: withRatiosParams(ratios.params, { buckets: ratiosOverrides(next) }) });
  }

  async function onRead(): Promise<void> {
    if (!ratios.figures.trim() || busy) {
      return;
    }
    setReading(true);
    setError(null);
    try {
      const answer = await parseRatiosStatement(ratios.figures, model, t("finance.ratios.errors.parse"));
      setParsed(answer);
      setChanges({});
      // `buckets: []` is "classify as you proposed"; `stated` is what the sheet's own subtotals said,
      // which the maths holds its figures against rather than adding to them.
      setDraft({
        items: answer.items,
        params: withRatiosParams(ratios.params, { buckets: [], stated: answer.stated }),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("finance.ratios.errors.parse"));
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
      data-testid="finance-ratios-inputs"
    >
      <FinanceFileUpload
        onFigures={(text) => setDraft({ figures: mergeFigures(ratios.figures, text) })}
        disabled={busy}
      />
      <div>
        <label htmlFor="finance-ratios-figures" className="panel-label">
          {t("finance.ratios.paste")}
        </label>
        <textarea
          id="finance-ratios-figures"
          rows={6}
          value={ratios.figures}
          onChange={(event) => setDraft({ figures: event.target.value })}
          className="input mt-2 text-[13px]"
          placeholder={t("finance.ratios.pastePlaceholder")}
          disabled={busy}
          data-testid="finance-ratios-figures"
        />
        <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.ratios.parseHint")}</p>
      </div>
      {error ? (
        <p className="text-sm text-[var(--danger)]" role="alert" data-testid="finance-ratios-error">
          {error}
        </p>
      ) : null}
      {parsed ? (
        <p className="text-xs text-[var(--text-2)]" data-testid="finance-ratios-read">
          {t("finance.ratios.readCount", { rows: parsed.items.length, periods: parsed.periods.length })}
          {parsed.subtotalsIgnored > 0
            ? ` ${t("finance.ratios.subtotalsIgnored", { count: parsed.subtotalsIgnored })}`
            : ""}
        </p>
      ) : null}
      {assistNotice(parsed) ? (
        <p className="text-xs text-[var(--text-2)]" data-testid="finance-ratios-assist">
          {assistNotice(parsed)}
        </p>
      ) : null}
      {ratios.items.length > 0 ? (
        <RatiosBalanceBanner rows={ratiosBalance(ratios.items, changes)} currency={currency} />
      ) : null}
      {periods.length > 0 ? (
        <div>
          <label htmlFor="finance-ratios-period" className="panel-label">
            {t("finance.ratios.period")}
          </label>
          <select
            id="finance-ratios-period"
            className="input mt-2"
            value={readPeriod}
            onChange={(event) => setDraft({ params: withRatiosParams(ratios.params, { period: event.target.value }) })}
            disabled={busy}
            data-testid="finance-ratios-period"
          >
            {periods.map((period) => (
              <option key={period} value={period}>
                {period || "—"}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.ratios.periodHint")}</p>
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div>
          <p className="panel-label">{t("finance.ratios.classification")}</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.ratios.classificationHint")}</p>
          {unplaced > 0 ? (
            <p className="mt-1 text-xs text-[var(--danger)]" role="alert" data-testid="finance-ratios-unplaced">
              {t("finance.ratios.unplaced", { count: unplaced })}
            </p>
          ) : null}
          <div className="mt-2">
            <RatiosBucketTable rows={rows} changes={changes} onBucket={onBucket} disabled={busy} currency={currency} />
          </div>
        </div>
      ) : null}
      <FinanceFold>
        <div>
          <p className="panel-label">{t("finance.ratios.supporting.heading")}</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">{t("finance.ratios.supporting.hint")}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {SUPPORTING_FIELDS.map((field) => (
              <label key={field} className="text-xs text-[var(--text-2)]">
                {t(`finance.ratios.supporting.${field}`)}
                <input
                  type="number"
                  step="any"
                  className="input mt-1 px-2 py-1 text-xs"
                  value={((ratios.params as Record<string, unknown>)[field] as number | undefined) ?? ""}
                  onChange={(event) => setDraft({ params: withRatiosNumber(ratios.params, field, event.target.value) })}
                  disabled={busy}
                  data-testid={`finance-ratios-${field}`}
                />
              </label>
            ))}
          </div>
        </div>
        <RatiosBandsEditor params={ratios.params} onParams={(next) => setDraft({ params: next })} disabled={busy} />
      </FinanceFold>
    </section>
  );
}

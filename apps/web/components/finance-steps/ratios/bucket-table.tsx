"use client";

/**
 * Every line of the statement, the bucket it was put in, and the evidence behind that — with a
 * dropdown beside each one.
 *
 * This is the confirm step of this task's flow. The classification is deterministic, but "the code
 * was confident" is not the same thing as "the owner agrees", and a row in the wrong bucket is the
 * single most expensive mistake this task can make: it moves a term loan out of interest-bearing
 * debt, or a prepayment out of current assets, and every ratio below quietly changes. So the whole
 * table is shown, grouped by statement, with the low-confidence rows marked and nothing hidden.
 */
import { RATIO_BUCKET_STATEMENT, formatRatioValue, type RatioBucket } from "@agentforge/core/finance";
import {
  RATIOS_BUCKET_OPTIONS,
  displayedBucket,
  groupRatiosRows,
  isChanged,
  ratiosRowKey,
  type RatiosBucketChanges,
  type RatiosClassifiedRow,
} from "@/lib/finance-ratios-draft";
import { getLocale, t } from "@/lib/i18n";

/** Below this the row is drawn as needing a look: a section guess, a category guess, or a model's. */
export const RATIOS_LOW_CONFIDENCE = 0.8;

const TH = "border-b border-[var(--line)] px-2 py-1 text-left font-medium text-[var(--text-2)]";
const TD = "border-b border-[var(--line)] px-2 py-1 align-middle";

export type RatiosBucketTableProps = {
  readonly rows: readonly RatiosClassifiedRow[];
  readonly changes: RatiosBucketChanges;
  readonly onBucket: (row: RatiosClassifiedRow, bucket: RatioBucket) => void;
  readonly disabled: boolean;
  readonly currency: string;
};

function evidence(row: RatiosClassifiedRow): string {
  const source = t(`finance.ratios.evidence.${row.source}`);
  return `${source} · ${row.reason}${row.section ? ` · ${row.section}` : ""}`;
}

type BucketCellProps = Omit<RatiosBucketTableProps, "rows" | "currency"> & { readonly row: RatiosClassifiedRow };

function BucketCell({ row, changes, onBucket, disabled }: BucketCellProps) {
  const bucket = displayedBucket(row, changes);
  return (
    <select
      className="input px-1 py-0.5 text-xs"
      value={bucket}
      onChange={(event) => onBucket(row, event.target.value as RatioBucket)}
      disabled={disabled}
      aria-label={t("finance.ratios.columns.bucketAria", { label: row.label })}
      data-testid={`finance-ratios-bucket-${ratiosRowKey(row.label, row.period)}`}
    >
      {RATIOS_BUCKET_OPTIONS.map((option) => (
        <option key={option} value={option}>
          {t(`finance.ratios.bucket.${option}`)}
        </option>
      ))}
    </select>
  );
}

function Row({ row, changes, onBucket, disabled, currency }: RatiosBucketTableProps & { row: RatiosClassifiedRow }) {
  const locale = getLocale() === "id" ? "id" : "en";
  const low = row.confidence < RATIOS_LOW_CONFIDENCE && !isChanged(row, changes);
  return (
    <tr className={low ? "bg-[var(--surface-2)]" : undefined}>
      <td className={`${TD} text-[var(--text)]`}>{row.label}</td>
      <td className={`${TD} text-[var(--text-2)]`}>{row.period || "—"}</td>
      <td className={`${TD} text-right tabular-nums text-[var(--text-2)]`}>
        {formatRatioValue(row.amount, "currency", locale, currency)}
      </td>
      <td className={TD}>
        <BucketCell row={row} changes={changes} onBucket={onBucket} disabled={disabled} />
      </td>
      <td className={`${TD} text-[var(--text-3)]`} title={evidence(row)}>
        {isChanged(row, changes) ? t("finance.ratios.evidence.override") : `${Math.round(row.confidence * 100)}%`}
      </td>
    </tr>
  );
}

/** One table per statement, in the order the statements were printed. */
export function RatiosBucketTable(props: RatiosBucketTableProps) {
  const groups = groupRatiosRows(props.rows, props.changes);
  if (groups.length === 0) {
    return <p className="text-xs text-[var(--text-3)]">{t("finance.ratios.emptyRows")}</p>;
  }
  return (
    <div className="space-y-3" data-testid="finance-ratios-buckets">
      {groups.map((group) => (
        <div key={group.statement}>
          <p className="panel-label">{t(`finance.ratios.statement.${group.statement}`)}</p>
          <div className="mt-1 max-h-72 overflow-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className={TH}>{t("finance.ratios.columns.label")}</th>
                  <th className={TH}>{t("finance.ratios.columns.period")}</th>
                  <th className={`${TH} text-right`}>{t("finance.ratios.columns.amount")}</th>
                  <th className={TH}>{t("finance.ratios.columns.bucket")}</th>
                  <th className={TH}>{t("finance.ratios.columns.confidence")}</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <Row key={ratiosRowKey(row.label, row.period)} {...props} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Exported so the panel can say how many rows are still sitting in no bucket at all. */
export function unplacedCount(rows: readonly RatiosClassifiedRow[], changes: RatiosBucketChanges): number {
  return rows.filter((row) => RATIO_BUCKET_STATEMENT[displayedBucket(row, changes)] === "none").length;
}

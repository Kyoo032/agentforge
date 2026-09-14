"use client";

import type { ColumnProfile, TableProfile } from "@agentforge/core/tabular";
import { formatTick } from "@/lib/chart-scale";
import { t } from "@/lib/i18n";

type Props = { profile: TableProfile; testId?: string };

const TOP_VALUES = 3;
const EM_DASH = "—";
const HEADER_CLASS =
  "border-b border-[var(--line)] px-3 py-2 text-left text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-2)]";
const CELL_CLASS = "border-b border-[var(--line)] px-3 py-1.5 align-top text-[var(--text)]";

function statText(value: number | string | undefined): string {
  if (value === undefined) {
    return EM_DASH;
  }
  return typeof value === "number" ? formatTick(value) : value;
}

function TypeBadge({ type }: { type: ColumnProfile["type"] }) {
  return (
    <span className="inline-block rounded-sm border border-[var(--line)] px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-[var(--text-2)]">
      {type}
    </span>
  );
}

function TopValues({ topK }: { topK: ColumnProfile["topK"] }) {
  const chips = topK.slice(0, TOP_VALUES);
  if (chips.length === 0) {
    return <span className="text-[var(--text-3)]">{EM_DASH}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((entry) => (
        <span
          key={entry.value}
          className="inline-block max-w-[140px] truncate rounded-sm bg-[var(--line)] px-1.5 py-0.5 text-xs text-[var(--text)]"
          title={`${entry.value} (${entry.count})`}
        >
          {entry.value || EM_DASH} <span className="text-[var(--text-3)]">×{entry.count}</span>
        </span>
      ))}
    </span>
  );
}

function ColumnRow({ column }: { column: ColumnProfile }) {
  return (
    <tr>
      <td className={`${CELL_CLASS} font-medium text-[var(--text)]`}>{column.name}</td>
      <td className={CELL_CLASS}>
        <TypeBadge type={column.type} />
      </td>
      <td className={`${CELL_CLASS} text-right font-mono tabular-nums`}>{formatTick(column.nulls)}</td>
      <td className={`${CELL_CLASS} text-right font-mono tabular-nums`}>{formatTick(column.distinct)}</td>
      <td className={`${CELL_CLASS} text-right font-mono tabular-nums`}>{statText(column.min)}</td>
      <td className={`${CELL_CLASS} text-right font-mono tabular-nums`}>{statText(column.max)}</td>
      <td className={`${CELL_CLASS} text-right font-mono tabular-nums`}>{statText(column.mean)}</td>
      <td className={CELL_CLASS}>
        <TopValues topK={column.topK} />
      </td>
    </tr>
  );
}

/** Compact per-column summary of a profiled table. */
export function DatasetProfile({ profile, testId }: Props) {
  return (
    <div data-testid={testId}>
      <p className="text-sm font-semibold text-[var(--text)]">
        {t("data.profile.meta", { rows: formatTick(profile.rowCount), cols: formatTick(profile.columnCount) })}
      </p>
      <div className="mt-2 overflow-auto rounded-lg border border-[var(--line)]">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={HEADER_CLASS}>
                {t("data.profile.column")}
              </th>
              <th scope="col" className={HEADER_CLASS}>
                {t("data.profile.type")}
              </th>
              <th scope="col" className={`${HEADER_CLASS} text-right`}>
                {t("data.profile.nulls")}
              </th>
              <th scope="col" className={`${HEADER_CLASS} text-right`}>
                {t("data.profile.distinct")}
              </th>
              <th scope="col" className={`${HEADER_CLASS} text-right`}>
                {t("data.profile.min")}
              </th>
              <th scope="col" className={`${HEADER_CLASS} text-right`}>
                {t("data.profile.max")}
              </th>
              <th scope="col" className={`${HEADER_CLASS} text-right`}>
                {t("data.profile.mean")}
              </th>
              <th scope="col" className={HEADER_CLASS}>
                {t("data.profile.topValues")}
              </th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((column, index) => (
              <ColumnRow key={`${column.name}-${index}`} column={column} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

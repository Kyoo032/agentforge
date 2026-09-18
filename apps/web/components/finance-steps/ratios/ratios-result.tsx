"use client";

/**
 * The finished scorecard on screen.
 *
 * This task answers with a `FinanceReport` and no `FinanceBrief` behind it — its maths never went
 * near the brief's metric shape — so it renders that report directly: the banded tiles, the gauges,
 * the scorecard table with each ratio's threshold and last year's figure beside it, the flags, and
 * the guarded prose. The same object is what the workbook and the deck export, so the screen and the
 * file cannot disagree about a number.
 */
import { reportTable, type FinanceReport, type ReportFlagLevel, type ReportKpi } from "@agentforge/core/finance";
import { ArtifactActions } from "@/components/artifact-actions";
import { FinanceReportCharts } from "@/components/finance-charts";
import type { FinanceResultPanelProps } from "../finance-result-panel";
import { t } from "@/lib/i18n";

const FLAG_TONE: Record<ReportFlagLevel, string> = {
  good: "border-[var(--line)] text-[var(--text-2)]",
  watch: "border-[var(--warn,var(--line))] text-[var(--text)]",
  risk: "border-[var(--danger)] text-[var(--danger)]",
};

const TH = "border-b border-[var(--line)] px-2 py-1 text-left font-medium text-[var(--text-2)]";
const TD = "border-b border-[var(--line)] px-2 py-1";

function KpiTile({ kpi }: { kpi: ReportKpi }) {
  const tone = kpi.flag ? FLAG_TONE[kpi.flag] : "border-[var(--line)] text-[var(--text-2)]";
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <p className="text-xs text-[var(--text-3)]">{kpi.label}</p>
      <p className="text-lg font-medium tabular-nums text-[var(--text)]">
        {kpi.value === null ? "—" : `${kpi.value}${kpi.unit === "x" || kpi.unit === "%" ? kpi.unit : ""}`}
      </p>
    </div>
  );
}

function Scorecard({ report }: { report: FinanceReport }) {
  const table = reportTable(report, "scorecard");
  if (!table || table.rows.length === 0) {
    return <p className="text-xs text-[var(--text-3)]">{t("finance.ratios.scorecard.empty")}</p>;
  }
  return (
    <section data-testid="finance-ratios-scorecard">
      <h3 className="text-sm font-semibold text-[var(--text)]">{table.title}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th key={column} className={TH}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={String(row[0])}>
                {row.map((cell, index) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: a report cell has no id of its own
                    key={`${String(row[0])}-${index}`}
                    className={`${TD} ${index === 0 ? "text-[var(--text)]" : "tabular-nums text-[var(--text-2)]"}`}
                  >
                    {cell === null ? "—" : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RatiosResult({ result, disabled }: FinanceResultPanelProps) {
  const report = result.report ?? null;
  if (!report) {
    return (
      <p className="text-sm text-[var(--text-2)]" data-testid="finance-ratios-no-report">
        {t("finance.ratios.scorecard.empty")}
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="finance-ratios-result">
      <ArtifactActions
        title={report.title}
        markdown={result.markdown}
        artifactId={result.artifactId}
        kbType="Brief"
        disabled={disabled}
        testIdPrefix="finance"
      />
      {report.subtitle ? <p className="text-xs text-[var(--text-3)]">{report.subtitle}</p> : null}
      {report.summary.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="finance-ratios-kpis">
          {report.summary.map((kpi) => (
            <KpiTile key={kpi.label} kpi={kpi} />
          ))}
        </div>
      ) : null}
      {report.flags.length > 0 ? (
        <ul className="space-y-1" data-testid="finance-ratios-flags">
          {report.flags.map((flag) => (
            <li key={flag.text} className={`rounded-lg border px-3 py-1.5 text-xs ${FLAG_TONE[flag.level]}`}>
              {flag.text}
            </li>
          ))}
        </ul>
      ) : null}
      <Scorecard report={report} />
      <FinanceReportCharts report={report} />
      {report.notes.map((note) => (
        <section key={note.heading}>
          <h3 className="text-sm font-semibold text-[var(--text)]">{note.heading}</h3>
          {note.body.split("\n\n").map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="mt-1.5 whitespace-pre-wrap text-sm text-[var(--text-2)]">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

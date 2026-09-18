"use client";

/**
 * The appraisal's finished memo on screen.
 *
 * A task that owns its own maths answers with a `FinanceReport` and no `FinanceBrief`, so the
 * brief's result panel — which reads `result.brief` for its title and its per-section rewrite — has
 * nothing to render from. This shows the same three things in the same order instead: the artifact
 * bar, the report's own charts, then the guarded prose. Every number here is a field of the report;
 * nothing on this screen is computed in the browser.
 */
import { ArtifactActions } from "@/components/artifact-actions";
import { FinanceReportCharts } from "@/components/finance-charts";
import type { FinanceReport } from "@/lib/finance-client";
import { t } from "@/lib/i18n";
import type { FinanceResultPanelProps } from "../finance-result-panel";

const FLAG_TONE: Record<string, string> = {
  good: "text-[var(--ok,var(--text-2))]",
  watch: "text-[var(--warn,var(--text-2))]",
  risk: "text-[var(--danger)]",
};

function KpiRow({ report }: { report: FinanceReport }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="appraisal-kpis">
      {report.summary.map((kpi) => (
        <li key={kpi.label} className="rounded-lg border border-[var(--line)] px-3 py-2">
          <span className="block text-[11px] text-[var(--text-3)]">{kpi.label}</span>
          <span className={`text-sm font-medium ${kpi.flag ? (FLAG_TONE[kpi.flag] ?? "") : "text-[var(--text)]"}`}>
            {kpi.value === null ? t("finance.appraisal.notAvailable") : kpi.value}
            {kpi.unit ? ` ${kpi.unit}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Flags({ report }: { report: FinanceReport }) {
  if (report.flags.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1 text-xs" data-testid="appraisal-flags">
      {report.flags.map((flag) => (
        <li key={`${flag.level}-${flag.text}`} className={FLAG_TONE[flag.level] ?? "text-[var(--text-2)]"}>
          {flag.text}
        </li>
      ))}
    </ul>
  );
}

function Notes({ report }: { report: FinanceReport }) {
  return (
    <div className="space-y-4" data-testid="appraisal-notes">
      {report.notes.map((note) => (
        <section key={note.heading}>
          <h4 className="text-sm font-medium text-[var(--text)]">{note.heading}</h4>
          {note.body.split(/\n{2,}/).map((paragraph) => (
            <p key={paragraph.slice(0, 48)} className="mt-1.5 whitespace-pre-line text-sm text-[var(--text-2)]">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** The appraisal memo: KPIs, the two charts, what to watch, then the sections the model wrote. */
export function AppraisalResult({ result, disabled }: FinanceResultPanelProps) {
  const report = result.report;
  if (!report) {
    // The host answered without a report; saying so beats rendering an empty memo.
    return (
      <p className="text-sm text-[var(--danger)]" role="alert" data-testid="appraisal-no-report">
        {t("finance.appraisal.noReport")}
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="appraisal-result">
      <ArtifactActions
        title={report.title}
        markdown={result.markdown}
        artifactId={result.artifactId}
        kbType="Memo"
        disabled={disabled}
        testIdPrefix="finance"
      />
      <div>
        <h3 className="text-lg font-medium text-[var(--text)]">{report.title}</h3>
        {report.subtitle ? <p className="text-xs text-[var(--text-3)]">{report.subtitle}</p> : null}
      </div>
      <KpiRow report={report} />
      <FinanceReportCharts report={report} />
      <Flags report={report} />
      <Notes report={report} />
    </div>
  );
}

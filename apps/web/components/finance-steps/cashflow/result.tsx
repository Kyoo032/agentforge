"use client";

/**
 * A finished cash-flow read.
 *
 * This task answers with a `FinanceReport` rather than a brief, so the result side is rendered from
 * the report itself: the KPI tiles, the balance line with its runway marker, the flags, then the
 * guarded prose. The export menu in the studio header sends this same report to the host, so the
 * screen, the workbook and the deck can never disagree about a number.
 */
import { financeReportFromMarkdown, type FinanceReport } from "@agentforge/core/finance";
import { ArtifactActions } from "@/components/artifact-actions";
import { FinanceReportCharts } from "@/components/finance-charts";
import type { FinanceResultPanelProps } from "../finance-result-panel";
import { t } from "@/lib/i18n";

const FLAG_CLASS: Readonly<Record<string, string>> = {
  risk: "text-[var(--danger)]",
  watch: "text-[var(--warn,var(--text-2))]",
  good: "text-[var(--text-2)]",
};

function Kpis({ report }: { report: FinanceReport }) {
  if (report.summary.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="cashflow-result-kpis">
      {report.summary.map((kpi) => (
        <div key={kpi.label} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">{kpi.label}</div>
          <div className={`tabular-nums ${FLAG_CLASS[kpi.flag ?? "good"] ?? ""}`}>
            {kpi.value === null ? "—" : String(kpi.value)}
            {kpi.unit && typeof kpi.value === "number" ? ` ${kpi.unit}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function Flags({ report }: { report: FinanceReport }) {
  if (report.flags.length === 0) {
    return null;
  }
  return (
    <section data-testid="cashflow-result-flags">
      <h3 className="text-sm font-semibold text-[var(--text)]">{t("finance.cashflow.warnings")}</h3>
      <ul className="mt-1 space-y-1 text-xs">
        {report.flags.map((flag) => (
          <li key={`${flag.level}-${flag.text}`} className={FLAG_CLASS[flag.level] ?? ""}>
            {flag.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CashflowResult({ result, task, locale, disabled }: FinanceResultPanelProps) {
  // The host sends the report this task computed. A stored result that only kept its markdown still
  // renders as prose rather than as an empty panel.
  const report: FinanceReport =
    result.report ?? financeReportFromMarkdown(result.markdown, { title: result.markdown.split("\n")[0] ?? task, task, locale });

  return (
    <div className="space-y-4" data-testid="cashflow-result">
      <ArtifactActions
        title={report.title}
        markdown={result.markdown}
        artifactId={result.artifactId}
        kbType="Brief"
        disabled={disabled}
        testIdPrefix="finance"
      />
      <Kpis report={report} />
      <FinanceReportCharts report={report} />
      <Flags report={report} />
      <article className="space-y-3" data-testid="cashflow-result-notes">
        {report.notes.map((note) => (
          <section key={note.heading}>
            <h3 className="text-sm font-semibold text-[var(--text)]">{note.heading}</h3>
            {note.body.split("\n\n").map((paragraph) => (
              <p key={paragraph.slice(0, 40)} className="mt-1 whitespace-pre-line text-sm text-[var(--text-2)]">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}

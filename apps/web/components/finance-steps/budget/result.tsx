"use client";

/**
 * The finished budget-versus-actual read on screen.
 *
 * A task that owns its own maths answers with a `FinanceReport` and no `FinanceBrief`, so the brief's
 * result panel — which reads `result.brief` for its title and its per-section rewrite — has nothing
 * to render from. This shows the same things in the same order instead, plus the two this task needs:
 * the variance bars with the flagged lines in the danger colour, and a period switcher for a sheet
 * that was read by quarter. Every number here is a field of the report; nothing is computed here.
 */
import { useState } from "react";
import type { FinanceReport, ReportTable } from "@agentforge/core/finance";
import { ArtifactActions } from "@/components/artifact-actions";
import { budgetPeriodTables } from "@/lib/finance-budget";
import { getLocale, t } from "@/lib/i18n";
import type { FinanceResultPanelProps } from "../finance-result-panel";
import { BudgetVarianceBars } from "./variance-bars";

const FLAG_TONE: Record<string, string> = {
  good: "text-[var(--ok,var(--text-2))]",
  watch: "text-[var(--warn,var(--text-2))]",
  risk: "text-[var(--danger)]",
};

const CELL = "border-b border-[var(--line)] px-2 py-1 text-[var(--text)]";

function Kpis({ report }: { report: FinanceReport }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="budget-kpis">
      {report.summary.map((kpi) => (
        <li key={kpi.label} className="rounded-lg border border-[var(--line)] px-3 py-2">
          <span className="block text-[11px] text-[var(--text-3)]">{kpi.label}</span>
          <span className={`text-sm font-medium ${kpi.flag ? (FLAG_TONE[kpi.flag] ?? "") : "text-[var(--text)]"}`}>
            {kpi.value === null ? t("finance.budget.notAvailable") : kpi.value}
            {kpi.unit ? ` ${kpi.unit}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Table({ table }: { table: ReportTable }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" data-testid={`budget-table-${table.id}`}>
        <caption className="pb-1 text-left text-[11px] text-[var(--text-3)]">{table.title}</caption>
        <thead>
          <tr className="text-[var(--text-3)]">
            {table.columns.map((column) => (
              <th key={column} className={CELL}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={String(row[0])}>
              {row.map((cell, at) => (
                <td key={`${String(row[0])}-${table.columns[at] ?? at}`} className={CELL}>
                  {cell === null ? t("finance.budget.notAvailable") : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Whole period first, then each period the sheet was read by. The report already holds both. */
function PeriodSwitcher({ report }: { report: FinanceReport }) {
  const periodTables = budgetPeriodTables(report.tables);
  const whole = report.tables.find((table) => table.id === "variance");
  const [shown, setShown] = useState("variance");
  const table = [whole, ...periodTables].find((entry) => entry?.id === shown) ?? whole;
  if (!whole) {
    return null;
  }
  return (
    <section className="space-y-2" data-testid="budget-periods">
      {periodTables.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {[whole, ...periodTables].map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`rounded px-2 py-1 text-[11px] ${entry.id === shown ? "bg-[var(--surface-2,var(--surface))] text-[var(--text)]" : "text-[var(--text-3)]"}`}
              onClick={() => setShown(entry.id)}
              data-testid={`budget-period-${entry.id}`}
            >
              {entry.title}
            </button>
          ))}
        </div>
      ) : null}
      {table ? <Table table={table} /> : null}
    </section>
  );
}

function Flags({ report }: { report: FinanceReport }) {
  if (report.flags.length === 0) {
    return null;
  }
  return (
    <ul className="space-y-1 text-xs" data-testid="budget-flags">
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
    <div className="space-y-4" data-testid="budget-notes">
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

export function BudgetResult({ result, disabled }: FinanceResultPanelProps) {
  const report = result.report;
  if (!report) {
    // The host answered without a report; saying so beats rendering an empty comparison.
    return (
      <p className="text-sm text-[var(--danger)]" role="alert" data-testid="budget-no-report">
        {t("finance.budget.noReport")}
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="budget-result">
      <ArtifactActions
        title={report.title}
        markdown={result.markdown}
        artifactId={result.artifactId}
        kbType="Brief"
        disabled={disabled}
        testIdPrefix="finance"
      />
      <div>
        <h3 className="text-lg font-medium text-[var(--text)]">{report.title}</h3>
        {report.subtitle ? <p className="text-xs text-[var(--text-3)]">{report.subtitle}</p> : null}
      </div>
      <Kpis report={report} />
      <BudgetVarianceBars
        chart={report.charts.find((chart) => chart.id === "variance-bars")}
        locale={getLocale()}
        currency={report.currency ?? ""}
      />
      <PeriodSwitcher report={report} />
      <Flags report={report} />
      <Notes report={report} />
    </div>
  );
}

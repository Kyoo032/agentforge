"use client";

import type { DataAnalysis, DataFinding } from "@agentforge/core/artifacts";
import { DataGrid } from "@/components/data-grid";
import { FormattedText } from "@/components/formatted-text";
import { SvgChart } from "@/components/svg-chart";

type Props = { analysis: DataAnalysis; testIdPrefix?: string };

const EVIDENCE_MAX_ROWS = 50;

function Evidence({ evidence, prefix }: { evidence: NonNullable<DataFinding["evidence"]>; prefix: string }) {
  return (
    <details
      open
      className="mt-3 rounded-lg border border-mist bg-paper/60 px-3 py-2"
      data-testid={`${prefix}-evidence`}
    >
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.12em] text-ink/55">Evidence</summary>
      {evidence.sql.trim() ? (
        <pre
          className="mt-2 overflow-auto rounded-md bg-mist/60 px-3 py-2 font-mono text-[12px] leading-relaxed text-ink/85"
          data-testid={`${prefix}-evidence-sql`}
        >
          {evidence.sql.trim()}
        </pre>
      ) : null}
      <div className="mt-2">
        <DataGrid
          columns={evidence.table.columns}
          rows={evidence.table.rows}
          maxRows={EVIDENCE_MAX_ROWS}
          testId={`${prefix}-evidence-table`}
        />
      </div>
    </details>
  );
}

function Finding({ finding, prefix }: { finding: DataFinding; prefix: string }) {
  return (
    <section data-testid={`${prefix}-finding`}>
      <h3 className="text-[14px] font-medium text-[var(--text)]">{finding.heading}</h3>
      <FormattedText text={finding.body} className="mt-3 text-sm leading-relaxed text-ink/85" />
      {finding.evidence ? <Evidence evidence={finding.evidence} prefix={prefix} /> : null}
    </section>
  );
}

/** Article card for a DataAnalysis artifact: summary, findings with evidence, charts, tables. */
export function DataAnalysisView({ analysis, testIdPrefix = "data" }: Props) {
  return (
    <article
      className="rounded-xl border border-mist bg-paper px-8 py-10 shadow-sm"
      data-testid={`${testIdPrefix}-analysis`}
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink/45">Data analysis</p>
      <h2 className="mt-2 text-3xl font-medium tracking-tight text-ink">{analysis.title}</h2>
      <FormattedText
        text={analysis.summary}
        className="mt-4 text-sm leading-relaxed text-ink/80"
        testId={`${testIdPrefix}-summary`}
      />
      <div className="mt-8 space-y-8">
        {analysis.findings.map((finding, index) => (
          <Finding key={`${finding.heading}-${index}`} finding={finding} prefix={testIdPrefix} />
        ))}
      </div>
      {analysis.charts.length > 0 ? (
        <div className="mt-8 space-y-6" data-testid={`${testIdPrefix}-charts`}>
          {analysis.charts.map((chart, index) => (
            <SvgChart key={`${chart.title}-${index}`} chart={chart} testId={`${testIdPrefix}-chart`} />
          ))}
        </div>
      ) : null}
      {analysis.tables.length > 0 ? (
        <div className="mt-8 space-y-6" data-testid={`${testIdPrefix}-tables`}>
          {analysis.tables.map((table, index) => (
            <DataGrid
              key={`${table.name}-${index}`}
              columns={table.columns}
              rows={table.rows}
              caption={table.name}
              testId={`${testIdPrefix}-table`}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

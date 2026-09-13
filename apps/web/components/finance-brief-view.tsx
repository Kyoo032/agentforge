"use client";

import { useState } from "react";
import { formatMetricValue } from "@agentforge/core/artifacts";
import { DataGrid } from "@/components/data-grid";
import { FormattedText } from "@/components/formatted-text";
import { JobRegenPanel, type JobRegenSubmit } from "@/components/job-regen-panel";
import type { FinanceBrief, GuardReport } from "@/lib/finance-client";
import type { JobStudioModel } from "@/lib/use-job-model";

type Props = {
  brief: FinanceBrief;
  guard: GuardReport;
  models?: JobStudioModel[];
  defaultModel?: string;
  regeneratingIndex?: number | null;
  onRegenerate?: (index: number, payload: JobRegenSubmit) => void;
  testIdPrefix?: string;
};

export function FinanceBriefView({
  brief,
  guard,
  models = [],
  defaultModel = "",
  regeneratingIndex = null,
  onRegenerate,
  testIdPrefix = "finance",
}: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const metricRows = brief.computed.metrics.map((metric) => [
    metric.label,
    formatMetricValue(metric),
    metric.period,
    metric.formula,
  ]);

  return (
    <article
      className="rounded-xl border border-mist bg-paper px-8 py-10 shadow-sm"
      data-testid={`${testIdPrefix}-preview`}
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-ink/45">Finance brief</p>
      <h2 className="mt-2 text-3xl font-medium tracking-tight text-ink">{brief.title}</h2>
      {guard.total > 0 ? (
        <p
          className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          data-testid={`${testIdPrefix}-guard`}
        >
          {guard.total} figure{guard.total === 1 ? "" : "s"} the model wrote could not be traced to your inputs or the
          computed metrics and were replaced with “[unverified figure]”:{" "}
          {guard.flagged.map((item) => item.text).join(", ")}.
        </p>
      ) : (
        <p className="mt-3 text-xs text-ink/55" data-testid={`${testIdPrefix}-guard`}>
          Every figure in this brief traces to a line item or a computed metric.
        </p>
      )}
      <div className="mt-8 space-y-8">
        {brief.sections.map((section, index) => (
          <section key={`${section.heading}-${index}`} data-testid={`${testIdPrefix}-section`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="text-[14px] font-medium text-[var(--text)]">{section.heading}</h3>
              {onRegenerate ? (
                <button
                  type="button"
                  className="rounded-md border border-mist px-3 py-1 text-xs font-medium text-ink disabled:opacity-50"
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  disabled={regeneratingIndex !== null}
                  data-testid={`${testIdPrefix}-section-regen`}
                >
                  {regeneratingIndex === index ? "Rewriting…" : "Rewrite"}
                </button>
              ) : null}
            </div>
            <FormattedText text={section.body} className="mt-3 text-sm leading-relaxed text-ink/85" />
            {section.metrics.length > 0 ? (
              <p className="mt-2 text-[12px] text-ink/45">Uses: {section.metrics.join(", ")}</p>
            ) : null}
            {section.tables.map((table, tableIndex) => (
              <div key={`${index}-${tableIndex}`} className="mt-3">
                <DataGrid columns={table.columns} rows={table.rows} maxRows={50} />
              </div>
            ))}
            {onRegenerate && openIndex === index ? (
              <JobRegenPanel
                testIdPrefix="finance"
                models={models}
                defaultModel={defaultModel}
                submitting={regeneratingIndex === index}
                onCancel={() => setOpenIndex(null)}
                onSubmit={(payload) => {
                  setOpenIndex(null);
                  onRegenerate(index, payload);
                }}
              />
            ) : null}
          </section>
        ))}
      </div>
      {metricRows.length > 0 ? (
        <section className="mt-10" data-testid={`${testIdPrefix}-metrics`}>
          <h3 className="text-[14px] font-medium text-[var(--text)]">Computed metrics</h3>
          <div className="mt-3">
            <DataGrid columns={["Metric", "Value", "Period", "Formula"]} rows={metricRows} maxRows={100} />
          </div>
        </section>
      ) : null}
      {brief.computed.tables.map((table) => (
        <section key={table.name} className="mt-8" data-testid={`${testIdPrefix}-table`}>
          <h3 className="text-[14px] font-medium text-[var(--text)]">{table.name}</h3>
          <div className="mt-3">
            <DataGrid columns={table.columns} rows={table.rows} maxRows={100} />
          </div>
        </section>
      ))}
      <section className="mt-10" data-testid={`${testIdPrefix}-assumptions`}>
        <h3 className="text-[14px] font-medium text-[var(--text)]">Assumptions</h3>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink/80">
          {(brief.assumptions.length > 0 ? brief.assumptions : ["None stated."]).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </article>
  );
}

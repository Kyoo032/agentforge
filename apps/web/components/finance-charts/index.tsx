"use client";

import type { FinanceReport, ReportChart } from "@agentforge/core/finance";
import { t } from "@/lib/i18n";
import { BarChart } from "./bar-chart";
import { Gauge } from "./gauge";
import { HeatGrid } from "./heat-grid";
import { LineChart } from "./line-chart";

export { BarChart, Gauge, HeatGrid, LineChart };

function ChartByKind({ chart }: { chart: ReportChart }) {
  if (chart.kind === "line") {
    return <LineChart chart={chart} />;
  }
  if (chart.kind === "heat") {
    return <HeatGrid chart={chart} />;
  }
  if (chart.kind === "gauge") {
    return <Gauge chart={chart} />;
  }
  return <BarChart chart={chart} />;
}

/** Every chart the report carries, in its own order. The deck and the workbook read the same list. */
export function FinanceReportCharts({ report }: { report: FinanceReport }) {
  if (report.charts.length === 0) {
    return (
      <p className="text-xs text-[var(--text-2)]" data-testid="finance-charts-empty">
        {t("finance.charts.empty")}
      </p>
    );
  }
  return (
    <section className="space-y-4" data-testid="finance-charts">
      <h3 className="text-sm font-semibold text-[var(--text)]">{t("finance.charts.heading")}</h3>
      {report.charts.map((chart) => (
        <ChartByKind key={chart.id} chart={chart} />
      ))}
    </section>
  );
}

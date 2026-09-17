"use client";

import type { ReportChart } from "@agentforge/core/finance";
import { buildBarLayout } from "@/lib/chart-scale";
import { reportChartAsData } from "@/lib/finance-chart-geometry";
import { ChartFrame, XLabels, YAxis, formatTick, layout, seriesColor } from "./chart-frame";

const BAR_RADIUS = 2;

type Props = { chart: ReportChart; testId?: string };

export function BarChart({ chart, testId }: Props) {
  const { bars, ticks, xLabels } = buildBarLayout(reportChartAsData(chart, "bar"), layout);
  return (
    <ChartFrame chart={chart} testId={testId}>
      <YAxis ticks={ticks} />
      <XLabels labels={xLabels} />
      {bars.map((bar) => (
        <rect
          key={`${bar.label}-${bar.seriesIndex}`}
          x={bar.x}
          y={bar.y}
          width={bar.width}
          height={bar.height}
          rx={BAR_RADIUS}
          fill={seriesColor(bar.seriesIndex)}
        >
          <title>{`${chart.series[bar.seriesIndex]?.name ?? ""}: ${formatTick(bar.value)} (${bar.label})`}</title>
        </rect>
      ))}
    </ChartFrame>
  );
}

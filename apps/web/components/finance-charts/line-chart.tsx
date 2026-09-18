"use client";

import type { ReportChart } from "@agentforge/core/finance";
import { buildLineLayout } from "@/lib/chart-scale";
import { reportChartAsData } from "@/lib/finance-chart-geometry";
import { ChartFrame, XLabels, YAxis, formatTick, layout, seriesColor } from "./chart-frame";

/** Beyond this many points a marker per point is clutter; the line alone reads better. */
const MAX_MARKER_POINTS = 40;
const LINE_WIDTH = 2;
const MARKER_RADIUS = 4;

type Props = { chart: ReportChart; testId?: string };

export function LineChart({ chart, testId }: Props) {
  const { lines, ticks, xLabels } = buildLineLayout(reportChartAsData(chart, "line"), layout, false);
  return (
    <ChartFrame chart={chart} testId={testId}>
      <YAxis ticks={ticks} />
      <XLabels labels={xLabels} />
      {lines.map((line) => {
        const name = chart.series[line.seriesIndex]?.name ?? "";
        const color = seriesColor(line.seriesIndex);
        return (
          <g key={name || line.seriesIndex}>
            {line.path ? (
              <path
                d={line.path}
                fill="none"
                stroke={color}
                strokeWidth={LINE_WIDTH}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null}
            {line.points.length <= MAX_MARKER_POINTS
              ? line.points.map((point) => (
                  <circle
                    key={point.label}
                    cx={point.x}
                    cy={point.y}
                    r={MARKER_RADIUS}
                    fill={color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  >
                    <title>{`${name}: ${formatTick(point.value)} (${point.label})`}</title>
                  </circle>
                ))
              : null}
          </g>
        );
      })}
    </ChartFrame>
  );
}

"use client";

import type { ReportChart } from "@agentforge/core/finance";
import { gaugeArcPath, gaugeBands, gaugeFraction } from "@/lib/finance-chart-geometry";
import { ChartFrame, LEVEL_COLOR, TEXT_OPACITY, formatTick, layout, plot } from "./chart-frame";

const DIAL_WIDTH = 22;
const NEEDLE_WIDTH = 4;
const READING_FONT = 28;
const UNIT_FONT = 13;
const THIRD = 1 / 3;

type Props = { chart: ReportChart; testId?: string };

function reading(chart: ReportChart): { value: number | null; unit: string; max: number } {
  const values = chart.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null && Number.isFinite(value)),
  );
  const value = values[0] ?? null;
  const max = Math.max(1, ...values.map((entry) => Math.abs(entry)));
  return { value, unit: chart.series[0]?.name ?? "", max };
}

/**
 * A half dial with three bands. Nothing in the report carries thresholds yet, so the bands are even
 * thirds of the reading's own scale; the note under the dial is what says where the line really is.
 */
export function Gauge({ chart, testId }: Props) {
  const { value, unit, max } = reading(chart);
  const centre = { x: layout.width / 2, y: plot.y1 - 10 };
  const radius = Math.min((plot.x1 - plot.x0) / 2, plot.y1 - plot.y0 - 20);
  const fraction = value === null ? 0 : gaugeFraction(value, 0, max);
  const needle = gaugeArcPath(centre.x, centre.y, radius, Math.max(0, fraction - 0.005), fraction);
  return (
    <ChartFrame chart={chart} testId={testId}>
      {gaugeBands(max * THIRD, max * 2 * THIRD, 0, max).map((band) => (
        <path
          key={band.level}
          d={gaugeArcPath(centre.x, centre.y, radius, band.from, band.to)}
          fill="none"
          stroke={LEVEL_COLOR[band.level]}
          strokeOpacity={0.35}
          strokeWidth={DIAL_WIDTH}
        />
      ))}
      {needle ? (
        <path d={needle} fill="none" stroke="var(--text)" strokeWidth={NEEDLE_WIDTH} strokeLinecap="round" />
      ) : null}
      <text
        x={centre.x}
        y={centre.y - 10}
        textAnchor="middle"
        fill="currentColor"
        style={{ fontSize: READING_FONT, fontWeight: 600 }}
      >
        {value === null ? "" : formatTick(value)}
      </text>
      <text
        x={centre.x}
        y={centre.y + 14}
        textAnchor="middle"
        fill="currentColor"
        style={{ fontSize: UNIT_FONT, opacity: TEXT_OPACITY }}
      >
        {unit}
      </text>
    </ChartFrame>
  );
}

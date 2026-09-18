"use client";

import type { ReportChart } from "@agentforge/core/finance";
import { truncateLabel } from "@/lib/chart-scale";
import { heatCells } from "@/lib/finance-chart-geometry";
import { ChartFrame, LEVEL_COLOR, TEXT_OPACITY, TICK_FONT, formatTick, plot } from "./chart-frame";

/** Below this the cell is neutral: a grid that colours noise reads as noise. */
const NEUTRAL_BAND = 0.2;
const CELL_RADIUS = 2;
const MIN_ALPHA = 0.15;

function cellFill(intensity: number): string {
  if (Math.abs(intensity) < NEUTRAL_BAND) {
    return "var(--surface)";
  }
  return intensity > 0 ? LEVEL_COLOR.good : LEVEL_COLOR.risk;
}

function cellOpacity(intensity: number): number {
  return Math.abs(intensity) < NEUTRAL_BAND ? 1 : MIN_ALPHA + Math.abs(intensity) * (1 - MIN_ALPHA);
}

type Props = { chart: ReportChart; testId?: string };

/** A sensitivity grid: one rectangle per series and category, shaded by how far the number swings. */
export function HeatGrid({ chart, testId }: Props) {
  const cells = heatCells(chart);
  const rowHeight = chart.series.length > 0 ? (plot.y1 - plot.y0) / chart.series.length : 0;
  const columnWidth = chart.categories.length > 0 ? (plot.x1 - plot.x0) / chart.categories.length : 0;
  return (
    <ChartFrame chart={chart} testId={testId}>
      {cells.map((cell) => (
        <g key={`${cell.row}-${cell.column}`}>
          <rect
            x={cell.x}
            y={cell.y}
            width={cell.width}
            height={cell.height}
            rx={CELL_RADIUS}
            fill={cellFill(cell.intensity)}
            fillOpacity={cellOpacity(cell.intensity)}
            stroke="var(--line)"
          >
            <title>{`${cell.row} / ${cell.column}: ${cell.value === null ? "" : formatTick(cell.value)}`}</title>
          </rect>
          <text
            x={cell.x + cell.width / 2}
            y={cell.y + cell.height / 2 + 4}
            textAnchor="middle"
            fill="currentColor"
            style={{ fontSize: TICK_FONT }}
          >
            {cell.value === null ? "" : formatTick(cell.value)}
          </text>
        </g>
      ))}
      {chart.series.map((series, index) => (
        <text
          key={series.name}
          x={plot.x0 - 6}
          y={plot.y0 + index * rowHeight + rowHeight / 2 + 4}
          textAnchor="end"
          fill="currentColor"
          style={{ fontSize: TICK_FONT, opacity: TEXT_OPACITY }}
        >
          <title>{series.name}</title>
          {truncateLabel(series.name, 8)}
        </text>
      ))}
      {chart.categories.map((category, index) => (
        <text
          key={category}
          x={plot.x0 + index * columnWidth + columnWidth / 2}
          y={plot.y1 + 16}
          textAnchor="middle"
          fill="currentColor"
          style={{ fontSize: TICK_FONT, opacity: TEXT_OPACITY }}
        >
          <title>{category}</title>
          {truncateLabel(category, 10)}
        </text>
      ))}
    </ChartFrame>
  );
}

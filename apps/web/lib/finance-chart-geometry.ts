/**
 * Geometry behind the Finance report charts.
 *
 * Line and bar reuse the shared `chart-scale` helpers by way of `reportChartAsData`; the heat grid
 * and the gauge have no equivalent there, so their maths lives here. Everything in this file is
 * pure so it can be unit tested — `apps/web` runs vitest without a DOM.
 */
import type { DataChart } from "@agentforge/core/artifacts";
import type { ReportChart } from "@agentforge/core/finance";
import { DEFAULT_CHART_LAYOUT, plotArea, type ChartLayout } from "./chart-scale";

export const FINANCE_CHART_LAYOUT: ChartLayout = {
  width: DEFAULT_CHART_LAYOUT.width,
  height: 260,
  padding: { top: 16, right: 16, bottom: 40, left: 52 },
};

/** Gap between heat cells, in viewBox units. */
export const HEAT_CELL_GAP = 2;
/** The gauge is a half dial: 180 degrees, left to right, over the top. */
export const GAUGE_START_DEGREES = 180;
export const GAUGE_SWEEP_DEGREES = 180;

const DEGREES_TO_RADIANS = Math.PI / 180;
const PATH_DECIMALS = 2;

function round(value: number): number {
  return Number(value.toFixed(PATH_DECIMALS));
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * A report chart seen as the `DataChart` the shared scale helpers already understand. A missing
 * value becomes NaN on purpose: every helper there skips non-finite numbers, so a gap stays a gap.
 */
export function reportChartAsData(chart: ReportChart, type: "line" | "bar"): DataChart {
  return {
    type,
    title: chart.title,
    x: { label: "", values: [...chart.categories] },
    series: chart.series.map((series) => ({
      name: series.name,
      values: chart.categories.map((_category, index) => series.values[index] ?? Number.NaN),
    })),
  };
}

/** The largest absolute value in the grid; 1 when there is nothing to scale against. */
export function heatExtreme(chart: ReportChart): number {
  const magnitudes = chart.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null && Number.isFinite(value)).map(Math.abs),
  );
  return magnitudes.length === 0 ? 1 : Math.max(1e-9, ...magnitudes);
}

/** Where a cell sits between the worst and the best number in the grid, as -1 .. 1. */
export function heatIntensity(value: number, extreme: number): number {
  if (!Number.isFinite(value) || extreme <= 0) {
    return 0;
  }
  return clamp(value / extreme, -1, 1);
}

export type HeatCell = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: number | null;
  readonly row: string;
  readonly column: string;
  readonly intensity: number;
};

/** One rectangle per series/category pair, laid out as an even grid inside the plot area. */
export function heatCells(chart: ReportChart, layout: ChartLayout = FINANCE_CHART_LAYOUT): HeatCell[] {
  const plot = plotArea(layout);
  const columns = chart.categories.length;
  const rows = chart.series.length;
  if (columns === 0 || rows === 0) {
    return [];
  }
  const cellWidth = (plot.x1 - plot.x0) / columns;
  const cellHeight = (plot.y1 - plot.y0) / rows;
  const extreme = heatExtreme(chart);
  return chart.series.flatMap((series, rowIndex) =>
    chart.categories.map((column, columnIndex) => {
      const value = series.values[columnIndex] ?? null;
      return {
        x: round(plot.x0 + columnIndex * cellWidth + HEAT_CELL_GAP / 2),
        y: round(plot.y0 + rowIndex * cellHeight + HEAT_CELL_GAP / 2),
        width: round(Math.max(0, cellWidth - HEAT_CELL_GAP)),
        height: round(Math.max(0, cellHeight - HEAT_CELL_GAP)),
        value,
        row: series.name,
        column,
        intensity: value === null ? 0 : heatIntensity(value, extreme),
      };
    }),
  );
}

/** Where a reading sits on the dial, as 0 .. 1. An inverted or flat range reads as empty. */
export function gaugeFraction(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return 0;
  }
  return clamp((value - min) / (max - min), 0, 1);
}

export function polarPoint(cx: number, cy: number, radius: number, degrees: number): { x: number; y: number } {
  const radians = degrees * DEGREES_TO_RADIANS;
  return { x: round(cx + radius * Math.cos(radians)), y: round(cy + radius * Math.sin(radians)) };
}

/** An arc of the half dial between two fractions, drawn left to right over the top. */
export function gaugeArcPath(cx: number, cy: number, radius: number, from: number, to: number): string {
  const start = GAUGE_START_DEGREES + clamp(from, 0, 1) * GAUGE_SWEEP_DEGREES;
  const end = GAUGE_START_DEGREES + clamp(to, 0, 1) * GAUGE_SWEEP_DEGREES;
  if (end <= start) {
    return "";
  }
  const a = polarPoint(cx, cy, radius, start);
  const b = polarPoint(cx, cy, radius, end);
  const largeArc = end - start > GAUGE_SWEEP_DEGREES ? 1 : 0;
  return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${largeArc} 1 ${b.x} ${b.y}`;
}

/** The three bands a gauge is read against, as fractions of the dial. */
export type GaugeBand = { readonly from: number; readonly to: number; readonly level: "risk" | "watch" | "good" };

export function gaugeBands(riskBelow: number, watchBelow: number, min: number, max: number): GaugeBand[] {
  const risk = gaugeFraction(riskBelow, min, max);
  const watch = gaugeFraction(watchBelow, min, max);
  return [
    { from: 0, to: risk, level: "risk" },
    { from: risk, to: Math.max(risk, watch), level: "watch" },
    { from: Math.max(risk, watch), to: 1, level: "good" },
  ].filter((band) => band.to > band.from) as GaugeBand[];
}

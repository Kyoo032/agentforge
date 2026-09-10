import type { DataChart } from "@agentforge/core/artifacts";

export type ChartLayout = {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
};

export const DEFAULT_CHART_LAYOUT: ChartLayout = {
  width: 640,
  height: 280,
  padding: { top: 16, right: 16, bottom: 40, left: 48 },
};

/**
 * Brand-neutral categorical palette, validated (dataviz skill validator) against the app
 * surfaces #f6f8fb (light) and #2b2b2d (dark): lightness band, chroma floor, adjacent-pair
 * CVD separation and normal-vision floor all pass in both modes. Order is the CVD-safety
 * mechanism; assign by series index, never re-sort.
 */
export const CHART_PALETTE = ["#3987e5", "#e0602c", "#1aa675", "#c98500", "#d55181", "#7a6bd8"] as const;

export const DEFAULT_TICK_COUNT = 5;
export const MAX_LABEL_CHARS = 14;
const BAND_PADDING = 0.2;
const GROUP_PADDING = 0.1;
const THOUSAND = 1_000;
const MILLION = 1_000_000;
const BILLION = 1_000_000_000;
const COMPACT_FROM = 10_000;

export type PlotArea = { x0: number; x1: number; y0: number; y1: number };

export type BarMark = {
  x: number;
  y: number;
  width: number;
  height: number;
  seriesIndex: number;
  label: string;
  value: number;
};
export type LinePoint = { x: number; y: number; value: number; label: string };
export type LineMark = { seriesIndex: number; points: LinePoint[]; path: string };
export type ScatterPoint = { x: number; y: number; xValue: number; yValue: number; seriesIndex: number };
export type YTick = { y: number; label: string };
export type XTick = { x: number; label: string };

export type BarLayout = { bars: BarMark[]; ticks: YTick[]; xLabels: XTick[] };
export type LineLayout = { lines: LineMark[]; ticks: YTick[]; xLabels: XTick[] };
export type ScatterLayout = { points: ScatterPoint[]; xTicks: XTick[]; yTicks: YTick[] };

export function chartPalette(index: number): string {
  const size = CHART_PALETTE.length;
  const safe = Number.isFinite(index) ? Math.trunc(index) : 0;
  return CHART_PALETTE[((safe % size) + size) % size];
}

export function plotArea(layout: ChartLayout = DEFAULT_CHART_LAYOUT): PlotArea {
  return {
    x0: layout.padding.left,
    x1: layout.width - layout.padding.right,
    y0: layout.padding.top,
    y1: layout.height - layout.padding.bottom,
  };
}

export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  if (span === 0 || !Number.isFinite(span)) {
    const mid = (r0 + r1) / 2;
    return () => mid;
  }
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
}

function niceStep(rawStep: number): number {
  const exponent = Math.floor(Math.log10(rawStep));
  const base = 10 ** exponent;
  const fraction = rawStep / base;
  if (fraction >= 7.07) {
    return 10 * base;
  }
  if (fraction >= 3.16) {
    return 5 * base;
  }
  if (fraction >= 1.41) {
    return 2 * base;
  }
  return base;
}

function roundToStep(value: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return Number(value.toFixed(decimals));
}

/** "Nice" ticks (1/2/5 × 10^k) covering [min, max]; includes 0 when the domain crosses it. */
export function niceTicks(min: number, max: number, count = DEFAULT_TICK_COUNT): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }
  if (min === max) {
    return [min];
  }
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const step = niceStep((hi - lo) / Math.max(1, count - 1));
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const total = Math.round((end - start) / step);
  return Array.from({ length: total + 1 }, (_, index) => roundToStep(start + index * step, step));
}

export function bandScale(
  count: number,
  range: [number, number],
  paddingRatio = BAND_PADDING,
): { bandWidth: number; position: (index: number) => number } {
  const [r0, r1] = range;
  if (count <= 0) {
    return { bandWidth: 0, position: () => r0 };
  }
  const step = (r1 - r0) / count;
  const bandWidth = step * (1 - paddingRatio);
  const inset = (step * paddingRatio) / 2;
  return { bandWidth, position: (index) => r0 + index * step + inset };
}

/** Finite min/max across every series; empty → [0, 1]. */
export function seriesExtent(series: Array<{ values: number[] }>, includeZero = true): [number, number] {
  const finite = series.flatMap((row) => row.values.filter((value) => Number.isFinite(value)));
  if (finite.length === 0) {
    return [0, 1];
  }
  const min = includeZero ? Math.min(0, ...finite) : Math.min(...finite);
  const max = includeZero ? Math.max(0, ...finite) : Math.max(...finite);
  return [min, max];
}

/** A zero-width extent cannot be scaled; widen it symmetrically (or to [0, 1] at zero). */
function widenFlat([lo, hi]: [number, number]): [number, number] {
  if (lo !== hi) {
    return [lo, hi];
  }
  if (lo === 0) {
    return [0, 1];
  }
  const pad = Math.abs(lo) / 2;
  return [lo - pad, hi + pad];
}

function trimZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** Compact tick label: 1234567 → "1.23M", 12345 → "12.3k", 0.5 → "0.5", 7 → "7". */
export function formatTick(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const compact = (divisor: number, suffix: string) => `${sign}${trimZeros((abs / divisor).toPrecision(3))}${suffix}`;
  if (abs >= BILLION) {
    return compact(BILLION, "B");
  }
  if (abs >= MILLION) {
    return compact(MILLION, "M");
  }
  if (abs >= COMPACT_FROM) {
    return compact(THOUSAND, "k");
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  if (abs < 0.01) {
    return `${sign}${trimZeros(abs.toPrecision(2))}`;
  }
  return trimZeros(value.toFixed(2));
}

export function truncateLabel(label: string, max = MAX_LABEL_CHARS): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

type Axis = { ticks: number[]; domain: [number, number]; scale: (v: number) => number };

/** Nice ticks over a widened extent; the scale domain snaps to the outer ticks. */
function axisFor(extent: [number, number], range: [number, number]): Axis {
  const [lo, hi] = widenFlat(extent);
  const ticks = niceTicks(lo, hi);
  const first = ticks[0] ?? lo;
  const last = ticks[ticks.length - 1] ?? hi;
  const domain: [number, number] = ticks.length >= 2 ? [first, last] : [lo, hi];
  return { ticks, domain, scale: linearScale(domain, range) };
}

function yTicks(axis: Axis): YTick[] {
  return axis.ticks.map((tick) => ({ y: axis.scale(tick), label: formatTick(tick) }));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Grouped bars: one band per x value, one bar per series inside the band. */
export function buildBarLayout(chart: DataChart, layout: ChartLayout = DEFAULT_CHART_LAYOUT): BarLayout {
  const plot = plotArea(layout);
  const axis = axisFor(seriesExtent(chart.series, true), [plot.y1, plot.y0]);
  const baseline = axis.scale(clamp(0, axis.domain[0], axis.domain[1]));
  const outer = bandScale(chart.x.values.length, [plot.x0, plot.x1], BAND_PADDING);
  const inner = bandScale(chart.series.length, [0, outer.bandWidth], GROUP_PADDING);
  const bars = chart.x.values.flatMap((category, index) =>
    chart.series.flatMap((series, seriesIndex) => {
      const value = series.values[index];
      if (value === undefined || !Number.isFinite(value)) {
        return [];
      }
      const top = axis.scale(value);
      return [
        {
          x: outer.position(index) + inner.position(seriesIndex),
          y: Math.min(top, baseline),
          width: inner.bandWidth,
          height: Math.abs(top - baseline),
          seriesIndex,
          label: String(category),
          value,
        },
      ];
    }),
  );
  const xLabels = thinXLabels(
    chart.x.values.map((category, index) => ({
      x: outer.position(index) + outer.bandWidth / 2,
      label: String(category),
    })),
  );
  return { bars, ticks: yTicks(axis), xLabels };
}

function pathFor(points: LinePoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`).join(" ");
}

/**
 * Lines over evenly spaced categories (index-based x). `includeZero` anchors the
 * y axis at zero; price charts pass false so a 900-dollar stock is not a flat line.
 */
export function buildLineLayout(
  chart: DataChart,
  layout: ChartLayout = DEFAULT_CHART_LAYOUT,
  includeZero = true,
): LineLayout {
  const plot = plotArea(layout);
  const axis = axisFor(seriesExtent(chart.series, includeZero), [plot.y1, plot.y0]);
  const count = chart.x.values.length;
  const xScale = linearScale([0, Math.max(0, count - 1)], [plot.x0, plot.x1]);
  const lines = chart.series.map((series, seriesIndex) => {
    const points = chart.x.values.flatMap((category, index) => {
      const value = series.values[index];
      if (value === undefined || !Number.isFinite(value)) {
        return [];
      }
      return [{ x: xScale(index), y: axis.scale(value), value, label: String(category) }];
    });
    return { seriesIndex, points, path: pathFor(points) };
  });
  const xLabels = thinXLabels(chart.x.values.map((category, index) => ({ x: xScale(index), label: String(category) })));
  return { lines, ticks: yTicks(axis), xLabels };
}

/** More labels than this overlap on a 600px plot; keep the first, the last, and evenly spaced ones between. */
export const MAX_X_LABELS = 8;

export function thinXLabels(labels: XTick[], max = MAX_X_LABELS): XTick[] {
  if (labels.length <= max) return labels;
  const last = labels.length - 1;
  const picked = new Set(Array.from({ length: max }, (_, i) => Math.round((i * last) / (max - 1))));
  return labels.filter((_, index) => picked.has(index));
}

function numericX(value: string | number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Scatter: numeric x only (non-numeric x values are skipped). */
export function buildScatterLayout(chart: DataChart, layout: ChartLayout = DEFAULT_CHART_LAYOUT): ScatterLayout {
  const plot = plotArea(layout);
  const xs = chart.x.values.map(numericX);
  const pairs = chart.series.flatMap((series, seriesIndex) =>
    xs.flatMap((xValue, index) => {
      const yValue = series.values[index];
      if (xValue === null || yValue === undefined || !Number.isFinite(yValue)) {
        return [];
      }
      return [{ xValue, yValue, seriesIndex }];
    }),
  );
  const xAxis = axisFor(seriesExtent([{ values: pairs.map((pair) => pair.xValue) }], false), [plot.x0, plot.x1]);
  const yAxis = axisFor(seriesExtent([{ values: pairs.map((pair) => pair.yValue) }], false), [plot.y1, plot.y0]);
  const points = pairs.map((pair) => ({ ...pair, x: xAxis.scale(pair.xValue), y: yAxis.scale(pair.yValue) }));
  const xTicks = xAxis.ticks.map((tick) => ({ x: xAxis.scale(tick), label: formatTick(tick) }));
  return { points, xTicks, yTicks: yTicks(yAxis) };
}

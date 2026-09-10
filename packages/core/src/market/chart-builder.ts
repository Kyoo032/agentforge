/**
 * Price chart per ticker: last `bars` closes plus SMA50 / SMA200 overlays.
 * The averages are computed over the full history and then sliced, so a
 * series is only included when every point of the window is a real number
 * (a 120-bar window needs 319 bars for SMA200: fetch 2y, not 1y).
 */
import type { DataChart } from "../artifacts/data-analysis";
import { barsAscending, smaSeries } from "./indicators";
import type { PriceHistory } from "./watch-schemas";

export const CHART_BARS_DEFAULT = 120;
export const CHART_SMA_PERIODS = [50, 200] as const;
const X_LABEL = "date";
const CLOSE_SERIES = "close";

export type PriceChartOptions = { bars?: number; title?: string };

/** The window of `values` from `from`, or null when it is empty or has a gap. */
function completeWindow(values: readonly (number | null)[], from: number): number[] | null {
  const window = values.slice(from);
  if (window.length === 0 || window.some((value) => value === null)) {
    return null;
  }
  return window as number[];
}

export function buildPriceChart(history: PriceHistory, opts: PriceChartOptions = {}): DataChart {
  const count = opts.bars ?? CHART_BARS_DEFAULT;
  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError(`buildPriceChart: bars must be a positive integer, got ${count}`);
  }
  const bars = barsAscending(history.bars);
  const closes = bars.map((bar) => bar.close);
  const from = Math.max(0, bars.length - count);
  const overlays = CHART_SMA_PERIODS.flatMap((period) => {
    const window = completeWindow(smaSeries(closes, period), from);
    return window === null ? [] : [{ name: `SMA${period}`, values: window }];
  });
  return {
    type: "line",
    title: opts.title ?? `${history.symbol} close (${history.interval})`,
    x: { label: X_LABEL, values: bars.slice(from).map((bar) => bar.date) },
    series: [{ name: CLOSE_SERIES, values: closes.slice(from) }, ...overlays],
  };
}

/** Windows the studio offers, in trading days: 1M ≈ 22, 3M ≈ 66, 6M ≈ 126, 1Y ≈ 252, 2Y ≈ 504. */
export const CHART_RANGES = [
  { id: "1m", label: "1M", bars: 22 },
  { id: "3m", label: "3M", bars: 66 },
  { id: "6m", label: "6M", bars: 126 },
  { id: "1y", label: "1Y", bars: 252 },
  { id: "2y", label: "2Y", bars: 504 },
] as const;
export type ChartRange = (typeof CHART_RANGES)[number];
export type ChartRangeId = ChartRange["id"];
export const CHART_RANGE_DEFAULT: ChartRangeId = "6m";

/** The named range, or the default for an id that is not one of ours. */
export function chartRange(id: string): ChartRange {
  return CHART_RANGES.find((range) => range.id === id) ?? chartRange(CHART_RANGE_DEFAULT);
}

/** The price chart cut to one named window; shorter when the history runs out of bars. */
export function buildRangeChart(history: PriceHistory, id: ChartRangeId, title?: string): DataChart {
  return buildPriceChart(history, { bars: chartRange(id).bars, title });
}

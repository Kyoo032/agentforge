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

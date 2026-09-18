/**
 * Swing points: the pivot highs and lows the Elliott Wave agent is allowed to
 * cite. Pure, deterministic, computed from the same daily bars the packet
 * already carries, so every level the model labels is a level code found.
 *
 * A bar is a pivot high when its high is strictly greater than the high of
 * every bar within `lookback` bars on both sides (and the mirror for a low).
 * Strict comparison means a plateau yields no pivot instead of several.
 */
import { barsAscending } from "./indicators";
import { SWING_POINTS_MAX, type PriceBar, type SwingPoint } from "./watch-schemas";

/** Bars either side that must be lower (higher) for a bar to count as a pivot. */
export const SWING_LOOKBACK_DEFAULT = 3;

function isPivot(bars: readonly PriceBar[], index: number, lookback: number, kind: SwingPoint["kind"]): boolean {
  const value = kind === "high" ? (bars[index] as PriceBar).high : (bars[index] as PriceBar).low;
  for (let at = index - lookback; at <= index + lookback; at += 1) {
    const other = bars[at];
    if (at === index || other === undefined) {
      continue;
    }
    const beaten = kind === "high" ? other.high >= value : other.low <= value;
    if (beaten) {
      return false;
    }
  }
  return true;
}

/**
 * Up to `max` most recent pivots, oldest first. Bars are sorted by date and
 * never mutated; too few bars for a full window on both sides yields nothing.
 */
export function swingPoints(
  bars: readonly PriceBar[],
  lookback: number = SWING_LOOKBACK_DEFAULT,
  max: number = SWING_POINTS_MAX,
): SwingPoint[] {
  const sorted = barsAscending(bars);
  const found: SwingPoint[] = [];
  for (let index = lookback; index < sorted.length - lookback; index += 1) {
    const bar = sorted[index] as PriceBar;
    if (isPivot(sorted, index, lookback, "high")) {
      found.push({ date: bar.date, price: bar.high, kind: "high" });
    } else if (isPivot(sorted, index, lookback, "low")) {
      found.push({ date: bar.date, price: bar.low, kind: "low" });
    }
  }
  return found.slice(Math.max(0, found.length - max));
}

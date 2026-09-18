/**
 * Trailing returns and the 1-month ranking, computed in code.
 *
 * The sector-rotation desk's whole job is "who led and who lagged", which is
 * arithmetic over bars, not narration. Doing it here means the ranking is the
 * same every run and the model only explains it.
 *
 * Windows are calendar days, not bar counts: a holiday-shortened week must not
 * quietly reach further back than a full one. The base close for a window is
 * the newest bar at or before the cutoff date; when no bar reaches that far,
 * the return is null rather than a shorter window pretending to be a longer
 * one. Pure and non-mutating.
 */
import { barsAscending } from "./indicators";
import type { MarketWatchPacket, PriceBar, RotationRow, TickerPacket } from "./watch-schemas";

/** Calendar days behind the newest bar that each window reaches back to. */
export const RET_1D_DAYS = 1;
export const RET_5D_DAYS = 7;
export const RET_1M_DAYS = 30;
export const RET_6M_DAYS = 182;
/** A return needs a "from" and a "to": fewer bars than this and the ticker is skipped. */
export const MIN_ROTATION_BARS = 2;

const DAY_MS = 86_400_000;
const PERCENT = 100;

/** The newest bar dated at or before `cutoffMs`, or null when the history starts later. */
function baseClose(bars: readonly PriceBar[], cutoffMs: number): number | null {
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const bar = bars[index] as PriceBar;
    if (Date.parse(bar.date) <= cutoffMs) {
      return bar.close;
    }
  }
  return null;
}

/** Percent move from the window's base close to the newest close; null when either leg is missing. */
function windowReturn(bars: readonly PriceBar[], latestMs: number, latest: number, days: number): number | null {
  const base = baseClose(bars, latestMs - days * DAY_MS);
  return base === null || base === 0 ? null : (latest / base - 1) * PERCENT;
}

/** The four trailing returns for one watchlist entry, or null when it has too little history. */
function returnsFor(ticker: TickerPacket): Omit<RotationRow, "rank1m"> | null {
  const bars = barsAscending(ticker.history?.bars ?? []);
  if (bars.length < MIN_ROTATION_BARS) {
    return null;
  }
  const newest = bars[bars.length - 1] as PriceBar;
  const latestMs = Date.parse(newest.date);
  if (Number.isNaN(latestMs)) {
    return null;
  }
  const at = (days: number): number | null => windowReturn(bars, latestMs, newest.close, days);
  return {
    ticker: ticker.symbol.yahoo,
    ret1dPct: at(RET_1D_DAYS),
    ret5dPct: at(RET_5D_DAYS),
    ret1mPct: at(RET_1M_DAYS),
    ret6mPct: at(RET_6M_DAYS),
  };
}

/** Best 1-month return first; a ticker without one sinks below every ticker that has one. */
function byOneMonthDesc(left: Omit<RotationRow, "rank1m">, right: Omit<RotationRow, "rank1m">): number {
  const a = left.ret1mPct;
  const b = right.ret1mPct;
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  return b === null ? -1 : b - a;
}

/**
 * The rotation table for a packet: one row per ticker that has at least two
 * bars, sorted by `rank1m` so the leaders read first. Ties keep the packet's
 * own ticker order.
 */
export function computeRotation(packet: MarketWatchPacket): RotationRow[] {
  const rows = packet.tickers.flatMap((ticker) => {
    const computed = returnsFor(ticker);
    return computed === null ? [] : [computed];
  });
  return [...rows].sort(byOneMonthDesc).map((row, index) => ({ ...row, rank1m: index + 1 }));
}

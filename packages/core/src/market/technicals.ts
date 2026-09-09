/**
 * Computed technicals for one ticker from its daily PriceHistory. Pure; the
 * host merges the TradingView rating in afterwards (`tradingview` starts null).
 * Every field is null when the history cannot support it, never guessed.
 */
import { barsAscending, ema, macd as macdOf, rsi, sma } from "./indicators";
import type { PriceBar, PriceHistory, Technical, WatchRef } from "./watch-schemas";

export const RSI_PERIOD = 14;
export const SMA_SHORT_PERIOD = 50;
export const SMA_LONG_PERIOD = 200;
export const EMA_LONG_PERIOD = 200;
export const CHANGE_5D_BARS = 5;
/** Trading days in a calendar month. */
export const CHANGE_1M_BARS = 21;
/** Calendar days in the 52-week window. */
export const WEEK_52_DAYS = 365;
/** Fewer bars than this inside the trailing year means the range is not a 52-week range. */
export const MIN_52W_BARS = 200;

const DAY_MS = 86_400_000;

type Range = { high: number | null; low: number | null };
const NO_RANGE: Range = { high: null, low: null };

/** Percent move from the close `barsBack` bars before the last one to the last close. */
function changePercent(closes: readonly number[], barsBack: number): number | null {
  const lastIndex = closes.length - 1;
  const baseIndex = lastIndex - barsBack;
  if (baseIndex < 0) {
    return null;
  }
  const base = closes[baseIndex];
  return base === 0 ? null : (closes[lastIndex] / base - 1) * 100;
}

function range52w(bars: readonly PriceBar[]): Range {
  const newest = bars[bars.length - 1];
  if (newest === undefined) {
    return NO_RANGE;
  }
  const cutoff = Date.parse(newest.date) - WEEK_52_DAYS * DAY_MS;
  const window = bars.filter((bar) => Date.parse(bar.date) >= cutoff);
  if (window.length < MIN_52W_BARS) {
    return NO_RANGE;
  }
  return {
    high: Math.max(...window.map((bar) => bar.high)),
    low: Math.min(...window.map((bar) => bar.low)),
  };
}

/** Technical row for `history.symbol`; `ref` is the computed-source attribution the host stamps. */
export function computeTechnical(history: PriceHistory, ref: WatchRef): Technical {
  const bars = barsAscending(history.bars);
  const closes = bars.map((bar) => bar.close);
  const macdResult = macdOf(closes);
  const range = range52w(bars);
  return {
    symbol: history.symbol,
    tradingview: null,
    rsi14: rsi(closes, RSI_PERIOD),
    sma50: sma(closes, SMA_SHORT_PERIOD),
    sma200: sma(closes, SMA_LONG_PERIOD),
    ema200: ema(closes, EMA_LONG_PERIOD),
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    change1dPercent: changePercent(closes, 1),
    change5dPercent: changePercent(closes, CHANGE_5D_BARS),
    change1mPercent: changePercent(closes, CHANGE_1M_BARS),
    high52w: range.high,
    low52w: range.low,
    ref,
  };
}

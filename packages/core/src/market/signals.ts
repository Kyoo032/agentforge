/**
 * The scanner's table, computed in code.
 *
 * A scanner desk used to be asked to spot RSI extremes and moving-average
 * breaks by reading a wall of numbers in the prompt, which is exactly the job
 * a model is worst at. These are the same observations, derived here from the
 * technicals and the daily bars the packet already carries, so the model only
 * has to narrate them.
 *
 * Pure and deterministic: the same packet always yields the same rows, ordered
 * by the packet's own ticker order and then by `MARKET_SIGNAL_KINDS`. Nothing
 * is mutated. Notes are phrased as observations of the chart, never as an
 * instruction, and every `value` is a figure the packet already carries so the
 * number guard accepts it.
 */
import { MACD_FAST_PERIOD, MACD_SIGNAL_PERIOD, MACD_SLOW_PERIOD, barsAscending, emaSeries, smaSeries } from "./indicators";
import { SMA_LONG_PERIOD, SMA_SHORT_PERIOD } from "./technicals";
import type { MarketSignal, MarketSignalKind, MarketWatchPacket, TickerPacket } from "./watch-schemas";

/** At or below this RSI is the oversold band; at or above RSI_OVERBOUGHT is the overbought band. */
export const RSI_OVERSOLD = 30;
export const RSI_OVERBOUGHT = 70;
/** A cross counts as news only if it happened within this many of the closing bars. */
export const CROSS_LOOKBACK_BARS = 3;
/** How close to the 52-week edge a close must sit, in percent, to count as being at it. */
export const RANGE_PROXIMITY_PCT = 1;
/** A daily move this many times the recent average absolute move is unusual. */
export const UNUSUAL_MOVE_MULTIPLE = 2.5;
/** Bars of recent history the average absolute move is taken over. */
export const UNUSUAL_MOVE_WINDOW_BARS = 20;

const PERCENT = 100;

const NOTES: Readonly<Record<MarketSignalKind, string>> = {
  "rsi-oversold": "RSI14 sits in the oversold band",
  "rsi-overbought": "RSI14 sits in the overbought band",
  "macd-bull-cross": "MACD line crossed above its signal line in the closing bars",
  "macd-bear-cross": "MACD line crossed below its signal line in the closing bars",
  "sma50-break-up": "close crossed above its SMA50",
  "sma50-break-down": "close crossed below its SMA50",
  "sma200-break-up": "close crossed above its SMA200",
  "sma200-break-down": "close crossed below its SMA200",
  "52w-high": "close sits within a hair of the 52-week high",
  "52w-low": "close sits within a hair of the 52-week low",
  "unusual-move": "daily move is far above this ticker's recent average move",
};

type Series = readonly (number | null)[];
type CrossDirection = "up" | "down";

function row(ticker: string, kind: MarketSignalKind, value: number): MarketSignal {
  return { ticker, kind, value, note: NOTES[kind] };
}

function isFigure(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Zero crossing of a difference series inside the closing window, or null when there is none. */
function crossDirection(diffs: Series, lookback: number): CrossDirection | null {
  const tail = diffs.slice(-(lookback + 1));
  if (tail.length < 2 || tail.some((value) => !isFigure(value))) {
    return null;
  }
  const values = tail as readonly number[];
  let found: CrossDirection | null = null;
  for (let index = 1; index < values.length; index += 1) {
    const before = values[index - 1];
    const after = values[index];
    if (before <= 0 && after > 0) {
      found = "up";
    } else if (before >= 0 && after < 0) {
      found = "down";
    }
  }
  return found;
}

/** MACD line minus its signal line, aligned to the closes (null until both windows fill). */
function macdDiffSeries(closes: readonly number[]): Series {
  const fast = emaSeries(closes, MACD_FAST_PERIOD);
  const slow = emaSeries(closes, MACD_SLOW_PERIOD);
  const line: (number | null)[] = closes.map((_, index) => {
    const fastValue = fast[index];
    const slowValue = slow[index];
    return isFigure(fastValue) && isFigure(slowValue) ? fastValue - slowValue : null;
  });
  const compact = line.filter(isFigure);
  const signal = emaSeries(compact, MACD_SIGNAL_PERIOD);
  const offset = line.length - compact.length;
  return line.map((value, index) => {
    const signalValue = signal[index - offset];
    return isFigure(value) && isFigure(signalValue) ? value - signalValue : null;
  });
}

/** Close minus its SMA, aligned to the closes. */
function smaDiffSeries(closes: readonly number[], period: number): Series {
  const averages = smaSeries(closes, period);
  return closes.map((close, index) => {
    const average = averages[index];
    return isFigure(average) ? close - average : null;
  });
}

function rsiSignals(ticker: string, rsi14: number | null): MarketSignal[] {
  if (!isFigure(rsi14)) {
    return [];
  }
  if (rsi14 <= RSI_OVERSOLD) {
    return [row(ticker, "rsi-oversold", rsi14)];
  }
  return rsi14 >= RSI_OVERBOUGHT ? [row(ticker, "rsi-overbought", rsi14)] : [];
}

function macdSignals(ticker: string, closes: readonly number[], macdNow: number | null): MarketSignal[] {
  const direction = crossDirection(macdDiffSeries(closes), CROSS_LOOKBACK_BARS);
  if (direction === null || !isFigure(macdNow)) {
    return [];
  }
  return [row(ticker, direction === "up" ? "macd-bull-cross" : "macd-bear-cross", macdNow)];
}

function smaBreak(
  ticker: string,
  closes: readonly number[],
  period: number,
  level: number | null,
  up: MarketSignalKind,
  down: MarketSignalKind,
): MarketSignal[] {
  const direction = crossDirection(smaDiffSeries(closes, period), CROSS_LOOKBACK_BARS);
  if (direction === null || !isFigure(level)) {
    return [];
  }
  return [row(ticker, direction === "up" ? up : down, level)];
}

function rangeSignals(ticker: string, close: number | null, high: number | null, low: number | null): MarketSignal[] {
  if (!isFigure(close)) {
    return [];
  }
  const band = RANGE_PROXIMITY_PCT / PERCENT;
  if (isFigure(high) && high > 0 && close >= high * (1 - band)) {
    return [row(ticker, "52w-high", high)];
  }
  if (isFigure(low) && low > 0 && close <= low * (1 + band)) {
    return [row(ticker, "52w-low", low)];
  }
  return [];
}

/** Bar-to-bar percent changes, oldest first; a zero base drops that step. */
function percentChanges(closes: readonly number[]): number[] {
  return closes.flatMap((close, index) => {
    const previous = closes[index - 1];
    return index === 0 || previous === 0 ? [] : [(close / previous - 1) * PERCENT];
  });
}

function unusualMove(ticker: string, closes: readonly number[]): MarketSignal[] {
  const changes = percentChanges(closes);
  const latest = changes[changes.length - 1];
  const window = changes.slice(-(UNUSUAL_MOVE_WINDOW_BARS + 1), -1);
  if (!isFigure(latest) || window.length < UNUSUAL_MOVE_WINDOW_BARS) {
    return [];
  }
  const average = window.reduce((sum, change) => sum + Math.abs(change), 0) / window.length;
  if (average <= 0 || Math.abs(latest) < UNUSUAL_MOVE_MULTIPLE * average) {
    return [];
  }
  return [row(ticker, "unusual-move", latest)];
}

/** Every observation for one watchlist entry, in `MARKET_SIGNAL_KINDS` order. */
function signalsForTicker(ticker: TickerPacket): MarketSignal[] {
  const name = ticker.symbol.yahoo;
  const technical = ticker.technical;
  const closes = barsAscending(ticker.history?.bars ?? []).map((bar) => bar.close);
  const latestClose = closes.length > 0 ? closes[closes.length - 1] : (ticker.quote?.price ?? null);
  if (technical === null) {
    return [];
  }
  return [
    ...rsiSignals(name, technical.rsi14),
    ...macdSignals(name, closes, technical.macd),
    ...smaBreak(name, closes, SMA_SHORT_PERIOD, technical.sma50, "sma50-break-up", "sma50-break-down"),
    ...smaBreak(name, closes, SMA_LONG_PERIOD, technical.sma200, "sma200-break-up", "sma200-break-down"),
    ...rangeSignals(name, latestClose, technical.high52w, technical.low52w),
    ...unusualMove(name, closes),
  ];
}

/**
 * The computed signals table for a packet. Ordered ticker by ticker in packet
 * order, and within a ticker in signal-group order. A ticker without a
 * technical row contributes nothing; nothing here guesses a missing figure.
 */
export function computeSignals(packet: MarketWatchPacket): MarketSignal[] {
  return packet.tickers.flatMap(signalsForTicker);
}

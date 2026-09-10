/**
 * Technical indicators over daily closes. Pure functions, no network.
 *
 * RSI uses Wilder smoothing (seed = simple mean of the first `period` changes,
 * then avg = (prev * (period - 1) + current) / period). Written as
 * 100 * gain / (gain + loss), which equals 100 - 100 / (1 + RS) and avoids the
 * divide-by-zero when there are no losses. A flat series (no gains, no losses)
 * reports the 50 midpoint: neither overbought nor oversold.
 *
 * EMA seeds with the simple average of the first `period` closes and then
 * applies the 2 / (period + 1) multiplier. MACD is EMA(fast) - EMA(slow) with
 * an EMA(signal) of that line. Series variants are aligned to the input (null
 * until the window fills) so chart windows can be sliced NaN-free.
 */
import type { PriceBar } from "./watch-schemas";

export const RSI_DEFAULT_PERIOD = 14;
export const MACD_FAST_PERIOD = 12;
export const MACD_SLOW_PERIOD = 26;
export const MACD_SIGNAL_PERIOD = 9;
const RSI_MIDPOINT = 50;
const RSI_MAX = 100;

export type MacdResult = { macd: number | null; signal: number | null; histogram: number | null };

const MACD_EMPTY: MacdResult = { macd: null, signal: null, histogram: null };

function requirePeriod(period: number): void {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError(`indicators: period must be a positive integer, got ${period}`);
  }
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const gainOf = (change: number): number => Math.max(change, 0);
const lossOf = (change: number): number => Math.max(-change, 0);

type Averages = { gain: number; loss: number };

function wilderStep(period: number) {
  return (average: Averages, change: number): Averages => ({
    gain: (average.gain * (period - 1) + gainOf(change)) / period,
    loss: (average.loss * (period - 1) + lossOf(change)) / period,
  });
}

function last<T>(values: readonly T[]): T | null {
  return values.length > 0 ? values[values.length - 1] : null;
}

/** Simple moving average of the last `period` closes; null when there are fewer closes. */
export function sma(closes: readonly number[], period: number): number | null {
  requirePeriod(period);
  if (closes.length < period) {
    return null;
  }
  return mean(closes.slice(-period));
}

/** SMA aligned to the input: null until the window fills, then the mean of the trailing `period` closes. */
export function smaSeries(closes: readonly number[], period: number): (number | null)[] {
  requirePeriod(period);
  return closes.map((_, index) => (index + 1 < period ? null : mean(closes.slice(index + 1 - period, index + 1))));
}

/** EMA aligned to the input: null until the seed window fills. */
export function emaSeries(closes: readonly number[], period: number): (number | null)[] {
  requirePeriod(period);
  const multiplier = 2 / (period + 1);
  const seedIndex = period - 1;
  let previous: number | null = null;
  return closes.map((close, index) => {
    if (index < seedIndex) {
      return null;
    }
    const value = previous === null ? mean(closes.slice(0, period)) : previous + multiplier * (close - previous);
    previous = value;
    return value;
  });
}

/** Exponential moving average of the closes; null when there are fewer closes than the period. */
export function ema(closes: readonly number[], period: number): number | null {
  return last(emaSeries(closes, period));
}

/** MACD line, signal line, and histogram at the last close; nulls where the windows never fill. */
export function macd(
  closes: readonly number[],
  fast = MACD_FAST_PERIOD,
  slow = MACD_SLOW_PERIOD,
  signal = MACD_SIGNAL_PERIOD,
): MacdResult {
  requirePeriod(fast);
  requirePeriod(slow);
  requirePeriod(signal);
  if (fast >= slow) {
    throw new RangeError(`indicators: macd fast period must be shorter than slow, got ${fast}/${slow}`);
  }
  const fastSeries = emaSeries(closes, fast);
  const slowSeries = emaSeries(closes, slow);
  const line = slowSeries.flatMap((slowValue, index) => {
    const fastValue = fastSeries[index];
    return slowValue === null || fastValue === null ? [] : [fastValue - slowValue];
  });
  const macdValue = last(line);
  if (macdValue === null) {
    return MACD_EMPTY;
  }
  const signalValue = ema(line, signal);
  return {
    macd: macdValue,
    signal: signalValue,
    histogram: signalValue === null ? null : macdValue - signalValue,
  };
}

/** Wilder RSI; null when fewer than period + 1 closes. */
export function rsi(closes: readonly number[], period = RSI_DEFAULT_PERIOD): number | null {
  requirePeriod(period);
  if (closes.length < period + 1) {
    return null;
  }
  const changes = closes.slice(1).map((close, index) => close - closes[index]);
  const seed = changes.slice(0, period);
  const initial: Averages = { gain: mean(seed.map(gainOf)), loss: mean(seed.map(lossOf)) };
  const { gain, loss } = changes.slice(period).reduce(wilderStep(period), initial);
  const total = gain + loss;
  return total === 0 ? RSI_MIDPOINT : (RSI_MAX * gain) / total;
}

/** Bars ordered by date ascending. Does not mutate the input. */
export function barsAscending(bars: readonly PriceBar[]): PriceBar[] {
  return [...bars].sort((left, right) => left.date.localeCompare(right.date));
}

/** Closes ordered by bar date ascending. Does not mutate the input. */
export function closesAscending(bars: readonly PriceBar[]): number[] {
  return barsAscending(bars).map((bar) => bar.close);
}

/** Close of the newest bar by date, or null when there are no bars. */
export function latestClose(bars: readonly PriceBar[]): number | null {
  return last(closesAscending(bars));
}

import { describe, expect, it } from "vitest";
import { closesAscending, ema, emaSeries, latestClose, macd, rsi, sma, smaSeries } from "./indicators";
import type { PriceBar } from "./watch-schemas";

/** StockCharts RSI worked example (14-period Wilder smoothing). */
const STOCKCHARTS_CLOSES = [
  44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614,
  46.282, 46.282, 46.0028,
];

function bar(date: string, close: number): PriceBar {
  return { date, open: close, high: close, low: close, close, volume: 1 };
}

describe("sma", () => {
  it("averages the last `period` closes", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(sma([10, 20], 2)).toBe(15);
  });

  it("returns null when there are fewer closes than the period", () => {
    expect(sma([1, 2], 3)).toBeNull();
    expect(sma([], 1)).toBeNull();
  });

  it("throws on a non-positive period", () => {
    expect(() => sma([1, 2, 3], 0)).toThrow(/period/);
  });
});

describe("rsi", () => {
  it("returns null with fewer than period + 1 closes", () => {
    expect(rsi([1, 2, 3], 3)).toBeNull();
    expect(rsi(STOCKCHARTS_CLOSES.slice(0, 14))).toBeNull();
  });

  it("matches the StockCharts worked example", () => {
    expect(rsi(STOCKCHARTS_CLOSES.slice(0, 15))).toBeCloseTo(70.53, 1);
    expect(rsi(STOCKCHARTS_CLOSES)).toBeCloseTo(66.32, 1);
  });

  it("applies Wilder smoothing on a small hand-computed series", () => {
    // changes +1, -1, +2, -1; first avg gain 1, avg loss 1/3; smoothed 2/3 and 5/9; RS 1.2.
    expect(rsi([10, 11, 10, 12, 11], 3)).toBeCloseTo(54.5454, 3);
  });

  it("is 100 on an all-gains series and 0 on an all-losses series", () => {
    expect(rsi([1, 2, 3, 4, 5], 3)).toBe(100);
    expect(rsi([5, 4, 3, 2, 1], 3)).toBe(0);
  });

  it("defaults to a 14 period", () => {
    expect(rsi(STOCKCHARTS_CLOSES.slice(0, 15), 14)).toBe(rsi(STOCKCHARTS_CLOSES.slice(0, 15)));
  });
});

describe("closesAscending / latestClose", () => {
  const bars = [bar("2026-09-03", 3), bar("2026-09-01", 1), bar("2026-09-02", 2)];

  it("orders closes by date without mutating the input", () => {
    expect(closesAscending(bars)).toEqual([1, 2, 3]);
    expect(bars.map((item) => item.date)).toEqual(["2026-09-03", "2026-09-01", "2026-09-02"]);
  });

  it("returns the close of the newest bar, or null when empty", () => {
    expect(latestClose(bars)).toBe(3);
    expect(latestClose([])).toBeNull();
  });
});

describe("smaSeries", () => {
  it("aligns to the input and is null before the window fills", () => {
    expect(smaSeries([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("is all null when the series is shorter than the period", () => {
    expect(smaSeries([1, 2], 3)).toEqual([null, null]);
  });
});

describe("ema", () => {
  it("seeds with the simple average then applies the 2/(n+1) multiplier", () => {
    // seed mean(1,2,3) = 2; k = 0.5; 4 -> 3; 5 -> 4
    expect(ema([1, 2, 3, 4, 5], 3)).toBe(4);
    expect(ema([1, 2, 3], 3)).toBe(2);
  });

  it("returns null with fewer closes than the period and throws on a bad period", () => {
    expect(ema([1, 2], 3)).toBeNull();
    expect(() => ema([1, 2, 3], 0)).toThrow(/period/);
  });

  it("emaSeries aligns to the input", () => {
    expect(emaSeries([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe("macd", () => {
  it("matches a hand-computed 2/3/2 case", () => {
    // EMA2: 1.5, 2.5, 3.5, 4.5, 5.5 (from index 1); EMA3: 2, 3, 4, 5 (from index 2)
    // MACD line from index 2: 0.5 x4; signal EMA2 of that: 0.5
    const result = macd([1, 2, 3, 4, 5, 6], 2, 3, 2);
    expect(result.macd).toBeCloseTo(0.5, 10);
    expect(result.signal).toBeCloseTo(0.5, 10);
    expect(result.histogram).toBeCloseTo(0, 10);
  });

  it("reports the line without a signal when there are too few macd points", () => {
    const result = macd([1, 2, 3], 2, 3, 2);
    expect(result.macd).toBeCloseTo(0.5, 10);
    expect(result.signal).toBeNull();
    expect(result.histogram).toBeNull();
  });

  it("is all null when the slow window never fills", () => {
    expect(macd([1, 2], 2, 3, 2)).toEqual({ macd: null, signal: null, histogram: null });
  });

  it("defaults to 12/26/9 and is flat on a constant series", () => {
    const flat = Array.from({ length: 40 }, () => 100);
    const result = macd(flat);
    expect(result.macd).toBe(0);
    expect(result.signal).toBe(0);
    expect(result.histogram).toBe(0);
    expect(macd(flat.slice(0, 30)).signal).toBeNull();
    expect(macd(flat.slice(0, 30)).macd).toBe(0);
  });
});

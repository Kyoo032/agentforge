import { describe, expect, it } from "vitest";
import { CHANGE_1M_BARS, CHANGE_5D_BARS, MIN_52W_BARS, computeTechnical } from "./technicals";
import { makeHistory, makeRef } from "./watch-fixtures";
import { technicalSchema } from "./watch-schemas";

const REF = makeRef("computed", "https://finance.yahoo.com/quote/MU/history");

describe("computeTechnical", () => {
  it("fills every field from a long ramp and validates against the schema", () => {
    const history = makeHistory("MU", 260);
    const tech = computeTechnical(history, REF);
    expect(technicalSchema.parse(tech)).toEqual(tech);
    expect(tech.symbol).toBe("MU");
    expect(tech.ref).toEqual(REF);
    expect(tech.tradingview).toBeNull();
    // closes 100..359: last close 359
    expect(tech.rsi14).toBe(100);
    expect(tech.sma50).toBeCloseTo((359 + 310) / 2, 10);
    expect(tech.sma200).toBeCloseTo((359 + 160) / 2, 10);
    expect(tech.ema200).not.toBeNull();
    expect(tech.macd).not.toBeNull();
    expect(tech.macdSignal).not.toBeNull();
    expect(tech.change1dPercent).toBeCloseTo((359 / 358 - 1) * 100, 10);
    expect(tech.change5dPercent).toBeCloseTo((359 / (359 - CHANGE_5D_BARS) - 1) * 100, 10);
    expect(tech.change1mPercent).toBeCloseTo((359 / (359 - CHANGE_1M_BARS) - 1) * 100, 10);
    // every bar of a 260-day history sits inside the trailing 365 days
    expect(tech.high52w).toBe(360);
    expect(tech.low52w).toBe(99);
  });

  it("uses bar highs and lows for the 52-week range", () => {
    const history = makeHistory("MU", 260, (index) => (index === 200 ? 1000 : 100));
    const tech = computeTechnical(history, REF);
    expect(tech.high52w).toBe(1001);
    expect(tech.low52w).toBe(99);
  });

  it("returns nulls for what a short history cannot support", () => {
    const tech = computeTechnical(makeHistory("MU", 30), REF);
    expect(tech.rsi14).toBe(100);
    expect(tech.sma50).toBeNull();
    expect(tech.sma200).toBeNull();
    expect(tech.ema200).toBeNull();
    expect(tech.macd).not.toBeNull();
    expect(tech.macdSignal).toBeNull();
    expect(tech.change1dPercent).not.toBeNull();
    expect(tech.change5dPercent).not.toBeNull();
    expect(tech.change1mPercent).not.toBeNull();
    expect(tech.high52w).toBeNull();
    expect(tech.low52w).toBeNull();
  });

  it("is all null on an empty or single-bar history", () => {
    for (const count of [0, 1]) {
      const tech = computeTechnical(makeHistory("MU", count), REF);
      expect(tech.rsi14).toBeNull();
      expect(tech.change1dPercent).toBeNull();
      expect(tech.change5dPercent).toBeNull();
      expect(tech.change1mPercent).toBeNull();
      expect(tech.high52w).toBeNull();
      expect(technicalSchema.safeParse(tech).success).toBe(true);
    }
  });

  it("needs MIN_52W_BARS inside the trailing year for the 52-week range", () => {
    expect(computeTechnical(makeHistory("MU", MIN_52W_BARS - 1), REF).high52w).toBeNull();
    expect(computeTechnical(makeHistory("MU", MIN_52W_BARS), REF).high52w).not.toBeNull();
  });

  it("tolerates unsorted bars and does not mutate the input", () => {
    const history = makeHistory("MU", 40);
    const reversed = { ...history, bars: [...history.bars].reverse() };
    const snapshot = JSON.stringify(reversed);
    expect(computeTechnical(reversed, REF).change1dPercent).toBeCloseTo(
      computeTechnical(history, REF).change1dPercent ?? Number.NaN,
      10,
    );
    expect(JSON.stringify(reversed)).toBe(snapshot);
  });
});

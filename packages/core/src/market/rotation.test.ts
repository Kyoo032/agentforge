import { describe, expect, it } from "vitest";
import { MIN_ROTATION_BARS, RET_1D_DAYS, RET_1M_DAYS, RET_5D_DAYS, RET_6M_DAYS, computeRotation } from "./rotation";
import { makeHistory, makePacket, makeTickerPacket } from "./watch-fixtures";
import { rotationRowSchema } from "./watch-schemas";

function only(...tickers: ReturnType<typeof makeTickerPacket>[]) {
  return makePacket({ tickers, macro: { quotes: [], failures: [] }, positionContext: "" });
}

/** `count` consecutive daily bars whose close doubles on the very last bar. */
const FLAT_THEN_DOUBLE = (count: number) => (index: number) => (index === count - 1 ? 200 : 100);

describe("computeRotation windows", () => {
  const bars = 400;
  const packet = only(makeTickerPacket("MU", { history: makeHistory("MU", bars, FLAT_THEN_DOUBLE(bars)) }));

  it("measures each window back by calendar days from the newest bar", () => {
    const [row] = computeRotation(packet);
    expect(row.ticker).toBe("MU");
    // Every window's base close is 100 (only the last bar jumped), so each return is +100%.
    expect(row.ret1dPct).toBeCloseTo(100, 9);
    expect(row.ret5dPct).toBeCloseTo(100, 9);
    expect(row.ret1mPct).toBeCloseTo(100, 9);
    expect(row.ret6mPct).toBeCloseTo(100, 9);
  });

  it("uses the documented calendar-day windows, widest last", () => {
    expect(RET_1D_DAYS).toBeLessThan(RET_5D_DAYS);
    expect(RET_5D_DAYS).toBeLessThan(RET_1M_DAYS);
    expect(RET_1M_DAYS).toBeLessThan(RET_6M_DAYS);
  });

  it("leaves a window null when the bars do not reach back that far", () => {
    const short = only(makeTickerPacket("MU", { history: makeHistory("MU", 10, (index) => 100 + index) }));
    const [row] = computeRotation(short);
    expect(row.ret1dPct).not.toBeNull();
    expect(row.ret5dPct).not.toBeNull();
    expect(row.ret1mPct).toBeNull();
    expect(row.ret6mPct).toBeNull();
  });

  it("reads the window base from the newest bar at or before the cutoff, not from a bar count", () => {
    // Bars on every other calendar day, closes 100, 102, ... 118 (newest 118).
    const gapped = makeHistory("MU", 20, (index) => 100 + index);
    const thinned = { ...gapped, bars: gapped.bars.filter((_, index) => index % 2 === 0) };
    const [row] = computeRotation(only(makeTickerPacket("MU", { history: thinned })));
    // RET_5D_DAYS calendar days back lands four bars back (close 110), not five (close 108).
    expect(row.ret5dPct).toBeCloseTo((118 / 110 - 1) * 100, 9);
    expect(row.ret5dPct).not.toBeCloseTo((118 / 108 - 1) * 100, 9);
    // The previous calendar day has no bar, so the 1-day window falls back to the bar before it.
    expect(row.ret1dPct).toBeCloseTo((118 / 116 - 1) * 100, 9);
  });
});

describe("computeRotation ranking", () => {
  const bars = 60;
  const laggard = makeTickerPacket("LAG", { history: makeHistory("LAG", bars, (index) => 200 - index) });
  const leader = makeTickerPacket("LED", { history: makeHistory("LED", bars, (index) => 100 + index * 3) });
  const middle = makeTickerPacket("MID", { history: makeHistory("MID", bars, (index) => 100 + index) });

  it("ranks 1-based by the 1-month return, best first", () => {
    const rows = computeRotation(only(laggard, middle, leader));
    expect(rows.map((row) => row.ticker)).toEqual(["LED", "MID", "LAG"]);
    expect(rows.map((row) => row.rank1m)).toEqual([1, 2, 3]);
  });

  it("sinks a ticker with no 1-month figure to the bottom of the ranking", () => {
    const shallow = makeTickerPacket("NEW", { history: makeHistory("NEW", 3, (index) => 100 + index) });
    const rows = computeRotation(only(shallow, middle));
    expect(rows.map((row) => row.ticker)).toEqual(["MID", "NEW"]);
    expect(rows[1].ret1mPct).toBeNull();
    expect(rows[1].rank1m).toBe(2);
  });
});

describe("computeRotation input handling", () => {
  it(`skips a ticker with fewer than ${MIN_ROTATION_BARS} bars or no history at all`, () => {
    const rows = computeRotation(
      only(
        makeTickerPacket("NONE", { history: null }),
        makeTickerPacket("ONE", { history: makeHistory("ONE", 1) }),
        makeTickerPacket("OK", { history: makeHistory("OK", 40) }),
      ),
    );
    expect(rows.map((row) => row.ticker)).toEqual(["OK"]);
  });

  it("is pure, deterministic, and emits rows the schema accepts", () => {
    const packet = only(
      makeTickerPacket("MU", { history: makeHistory("MU", 200, (index) => 100 + index) }),
      makeTickerPacket("INTC", { history: makeHistory("INTC", 200, (index) => 300 - index) }),
    );
    const snapshot = JSON.stringify(packet);
    expect(computeRotation(packet)).toEqual(computeRotation(packet));
    expect(JSON.stringify(packet)).toBe(snapshot);
    for (const row of computeRotation(packet)) {
      expect(rotationRowSchema.parse(row)).toEqual(row);
    }
  });

  it("returns nothing for an empty watchlist", () => {
    expect(computeRotation(only())).toEqual([]);
  });
});

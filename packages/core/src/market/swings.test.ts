import { describe, expect, it } from "vitest";
import { SWING_LOOKBACK_DEFAULT, swingPoints } from "./swings";
import { makeBars } from "./watch-fixtures";
import { SWING_POINTS_MAX, swingPointSchema } from "./watch-schemas";

/** Two clean peaks and one clean trough; makeBars puts high at close+1 and low at close-1. */
const ZIGZAG = [10, 12, 14, 16, 14, 12, 10, 12, 14, 16, 18, 16, 14];

function zigzagBars() {
  return makeBars(ZIGZAG.length, (index) => ZIGZAG[index] as number);
}

describe("swingPoints", () => {
  it("finds the pivot highs and lows, oldest first, with the extreme of the bar", () => {
    const bars = zigzagBars();
    const swings = swingPoints(bars, 2);
    expect(swings.map((swing) => swing.kind)).toEqual(["high", "low", "high"]);
    expect(swings.map((swing) => swing.price)).toEqual([17, 9, 19]);
    expect(swings.map((swing) => swing.date)).toEqual([
      bars[3]?.date,
      bars[6]?.date,
      bars[10]?.date,
    ]);
  });

  it("parses as the packet's swing rows", () => {
    for (const swing of swingPoints(zigzagBars(), 2)) {
      expect(swingPointSchema.safeParse(swing).success).toBe(true);
    }
  });

  it("finds nothing in a monotonic ramp or in too few bars", () => {
    expect(swingPoints(makeBars(40), 2)).toEqual([]);
    expect(swingPoints([], 2)).toEqual([]);
    expect(swingPoints(makeBars(3), 2)).toEqual([]);
  });

  it("keeps only the most recent pivots, in chronological order", () => {
    const saw = Array.from({ length: 121 }, (_, index) => 100 + (index % 2 === 0 ? 0 : 6));
    const swings = swingPoints(makeBars(saw.length, (index) => saw[index] as number), 1, 4);
    expect(swings).toHaveLength(4);
    const dates = swings.map((swing) => swing.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("caps at SWING_POINTS_MAX by default and uses SWING_LOOKBACK_DEFAULT", () => {
    const saw = Array.from({ length: 400 }, (_, index) => 100 + (index % 8 < 4 ? index % 8 : 8 - (index % 8)));
    const bars = makeBars(saw.length, (index) => saw[index] as number);
    expect(swingPoints(bars).length).toBeLessThanOrEqual(SWING_POINTS_MAX);
    expect(swingPoints(bars)).toEqual(swingPoints(bars, SWING_LOOKBACK_DEFAULT, SWING_POINTS_MAX));
    expect(SWING_LOOKBACK_DEFAULT).toBe(3);
  });

  it("sorts the bars by date before scanning", () => {
    const bars = zigzagBars();
    const shuffled = [...bars].reverse();
    expect(swingPoints(shuffled, 2)).toEqual(swingPoints(bars, 2));
  });

  it("does not mutate its input", () => {
    const bars = zigzagBars();
    const copy = JSON.parse(JSON.stringify(bars));
    swingPoints(bars, 2);
    expect(bars).toEqual(copy);
  });
});

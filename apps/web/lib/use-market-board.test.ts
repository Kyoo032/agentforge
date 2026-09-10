import { describe, expect, it } from "vitest";
import { BOARD_DEBOUNCE_MS, tickersOf } from "./use-market-board";

describe("tickersOf", () => {
  it("reads the watchlist back out of the reload key", () => {
    expect(tickersOf("0|MU,NVDA")).toEqual(["MU", "NVDA"]);
    expect(tickersOf("7|BBCA.JK")).toEqual(["BBCA.JK"]);
  });

  it("is empty when no ticker is set, whatever the refresh count", () => {
    expect(tickersOf("0|")).toEqual([]);
    expect(tickersOf("12|")).toEqual([]);
  });

  it("changes with the refresh count so a refresh re-runs the fetch", () => {
    expect(tickersOf("0|MU")).toEqual(tickersOf("1|MU"));
    expect("0|MU").not.toBe("1|MU");
  });

  it("debounces long enough to coalesce a pasted list into one request", () => {
    expect(BOARD_DEBOUNCE_MS).toBeGreaterThanOrEqual(200);
    expect(BOARD_DEBOUNCE_MS).toBeLessThanOrEqual(1000);
  });
});

import { describe, expect, it } from "vitest";
import { npv } from "../engine";
import {
  cumulative,
  cumulativeDiscounted,
  discountedFlows,
  discountedPaybackYears,
  paybackFrom,
  paybackYears,
  profitabilityIndex,
} from "./series";
import { MACHINE_NETS, SOLAR_NETS } from "./__fixtures__/plans";

describe("running totals", () => {
  it("runs the flows up as they stand, one total per year", () => {
    expect(cumulative(MACHINE_NETS)).toEqual([
      -1_450_000_000, -1_165_000_000, -825_000_000, -430_000_000, -10_000_000, 400_000_000, 960_000_000,
    ]);
  });

  it("shows the running total going backwards in the negative year", () => {
    const running = cumulative(SOLAR_NETS);
    expect(running[4]).toBe(-246_000);
    expect(running[5]).toBe(-311_000);
    expect(running[8]).toBe(151_000);
  });

  // Discounting the outlay by one period is the classic error; t = 0 is untouched.
  it("leaves the t = 0 flow undiscounted and ends on the NPV", () => {
    const discounted = discountedFlows(12, MACHINE_NETS) as number[];
    expect(discounted[0]).toBe(-1_450_000_000);
    expect(discounted[1]).toBeCloseTo(285_000_000 / 1.12, 6);
    const running = cumulativeDiscounted(12, MACHINE_NETS) as number[];
    expect(running[6]).toBeCloseTo(npv(0.12, MACHINE_NETS) as number, 6);
    expect(running[6]).toBeCloseTo(139_939_433.60188407, 4);
  });

  it("answers null for a rate that has no discount factor", () => {
    expect(discountedFlows(-100, MACHINE_NETS)).toBeNull();
    expect(cumulativeDiscounted(-150, MACHINE_NETS)).toBeNull();
  });
});

describe("payback", () => {
  it("takes the crossing year and the fraction of it linearly", () => {
    expect(paybackYears(MACHINE_NETS)).toBeCloseTo(4.024390243902439, 12);
    expect(paybackFrom(MACHINE_NETS).crossingIndex).toBe(5);
  });

  // The running total improves from Year 4 and then falls back: the first non-negative
  // crossing is Year 8, and reading Year 5 or the last crossing would flatter the plan.
  it("takes the FIRST non-negative crossing, not the first improvement", () => {
    expect(paybackYears(SOLAR_NETS)).toBeCloseTo(7.038216560509555, 12);
    expect(paybackFrom(SOLAR_NETS).crossingIndex).toBe(8);
  });

  it("applies the same rule to the discounted flows", () => {
    expect(discountedPaybackYears(12, MACHINE_NETS)).toBeCloseTo(5.506757806080001, 10);
    expect(discountedPaybackYears(8, SOLAR_NETS)).toBeCloseTo(9.41743759761327, 10);
  });

  it("answers null when the plan never pays back, and zero when it starts ahead", () => {
    expect(paybackYears([-100, 10, 10])).toBeNull();
    expect(paybackYears([100, -10])).toBe(0);
    expect(discountedPaybackYears(50, MACHINE_NETS)).toBeNull();
  });
});

describe("profitability index", () => {
  it("is the present value of the later years over the outlay", () => {
    expect(profitabilityIndex(139_939_433.60188407, -1_450_000_000)).toBeCloseTo(1.096509954208196, 12);
    expect(profitabilityIndex(56_126.53512720848, -820_000)).toBeCloseTo(1.0684469940575714, 12);
  });

  it("has no answer without an outlay to divide by", () => {
    expect(profitabilityIndex(100, 0)).toBeNull();
    expect(profitabilityIndex(null, -100)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { negativeCells, npvAtRates, scaleFlows, sensitivityGrid, sensitivityNpv } from "./sensitivity";
import { MACHINE_NETS, SOLAR_NETS } from "./__fixtures__/plans";

const AXES = { ratePercents: [10, 12, 14], shiftPercents: [-10, 0, 10] };

describe("scaling the flows", () => {
  // The outlay is a price that was agreed, not a forecast; scaling it makes every cell wrong.
  it("never moves the t = 0 outlay", () => {
    expect(scaleFlows(MACHINE_NETS, -10)[0]).toBe(-1_450_000_000);
    expect(scaleFlows(MACHINE_NETS, 10)[0]).toBe(-1_450_000_000);
  });

  it("scales a negative year the same way as a positive one", () => {
    expect(scaleFlows(SOLAR_NETS, -10)[5]).toBeCloseTo(-58_500, 9);
    expect(scaleFlows(SOLAR_NETS, 10)[5]).toBeCloseTo(-71_500, 9);
  });
});

describe("the sensitivity grid", () => {
  it("matches the machine plan's nine cells", () => {
    const grid = sensitivityGrid(MACHINE_NETS, AXES);
    const values = grid.map((row) => row.map((cell) => cell.npv as number));
    expect(values[0]?.[0]).toBeCloseTo(74_960_706.96972868, 4);
    expect(values[0]?.[1]).toBeCloseTo(244_400_785.52192053, 4);
    expect(values[0]?.[2]).toBeCloseTo(413_840_864.07411265, 4);
    expect(values[1]?.[0]).toBeCloseTo(-19_054_509.758304268, 4);
    expect(values[1]?.[1]).toBeCloseTo(139_939_433.60188407, 4);
    expect(values[1]?.[2]).toBeCloseTo(298_933_376.96207273, 4);
    expect(values[2]?.[0]).toBeCloseTo(-104_521_560.25080809, 4);
    expect(values[2]?.[1]).toBeCloseTo(44_976_044.1657688, 4);
    expect(values[2]?.[2]).toBeCloseTo(194_473_648.5823457, 4);
  });

  it("names the two cells that go negative", () => {
    const negative = negativeCells(sensitivityGrid(MACHINE_NETS, AXES));
    expect(negative.map((cell) => [cell.ratePercent, cell.shiftPercent])).toEqual([
      [12, -10],
      [14, -10],
    ]);
  });

  it("matches the solar plan's grid, where three cells go negative", () => {
    const grid = sensitivityGrid(SOLAR_NETS, { ratePercents: [6, 8, 10], shiftPercents: [-10, 0, 10] });
    expect(grid[0]?.[0]?.npv).toBeCloseTo(49_386.13236908574, 6);
    expect(grid[0]?.[1]?.npv).toBeCloseTo(145_984.59152120622, 6);
    expect(grid[1]?.[1]?.npv).toBeCloseTo(56_126.53512720848, 6);
    expect(grid[2]?.[1]?.npv).toBeCloseTo(-21_288.12218383167, 6);
    expect(grid[2]?.[2]?.npv).toBeCloseTo(58_583.06559778517, 6);
    expect(negativeCells(grid).map((cell) => [cell.ratePercent, cell.shiftPercent])).toEqual([
      [8, -10],
      [10, -10],
      [10, 0],
    ]);
  });

  it("is a straight scaling of the later years, so the base column is the plain NPV", () => {
    expect(sensitivityNpv(SOLAR_NETS, 8, 0)).toBeCloseTo(56_126.53512720848, 6);
    expect(sensitivityNpv(SOLAR_NETS, 8, -10)).toBeCloseTo(-31_486.11838551238, 6);
    expect(sensitivityNpv(SOLAR_NETS, 8, 10)).toBeCloseTo(143_739.1886399293, 6);
  });
});

describe("NPV at several hurdle rates", () => {
  it("says which rates the plan clears and which it does not", () => {
    const hurdles = npvAtRates(SOLAR_NETS, [6, 8, 10]);
    expect(hurdles.map((hurdle) => hurdle.clears)).toEqual([true, true, false]);
    expect(hurdles[1]?.npv).toBeCloseTo(56_126.53512720848, 6);
  });
});

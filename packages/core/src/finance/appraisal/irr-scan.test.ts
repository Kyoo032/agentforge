import { describe, expect, it } from "vitest";
import { npv } from "../engine";
import { breakevenRatePercent, mirrPercent, npvZeroCrossings, scanIrr, signChanges } from "./irr-scan";
import { MACHINE_NETS, SOLAR_NETS } from "./__fixtures__/plans";

/** A plan NPV(r) really does cross three times: an outlay, a recovery, a rebuild, a recovery. */
const THREE_ROOTS = [-1_000, 6_000, -11_000, 6_000];

/** NPV at a rate, as a share of the outlay — the only scale-free way to say "this root is a root". */
function residual(ratePercent: number, flows: readonly number[]): number {
  return Math.abs(npv(ratePercent / 100, flows) as number) / Math.abs(flows[0] as number);
}

describe("sign changes", () => {
  it("counts the flips the flows actually make, skipping zeros", () => {
    expect(signChanges(MACHINE_NETS)).toBe(1);
    expect(signChanges(SOLAR_NETS)).toBe(3);
    expect(signChanges([-100, 0, 0, 50])).toBe(1);
    expect(signChanges([10, 20, 30])).toBe(0);
  });
});

describe("the uniqueness scan", () => {
  it("finds one crossing for a plain plan and reports its IRR", () => {
    const scan = scanIrr(MACHINE_NETS);
    expect(scan.crossings).toBe(1);
    expect(scan.unique).toBe(true);
    expect(scan.irrPercent).toBeCloseTo(15.0166, 3);
    expect(residual(scan.irrPercent as number, MACHINE_NETS)).toBeLessThan(1e-9);
  });

  // Descartes allows three roots here; the scan is what shows there is still only one.
  it("confirms a single crossing even where three sign changes allow three", () => {
    const scan = scanIrr(SOLAR_NETS);
    expect(scan.signChanges).toBe(3);
    expect(scan.crossings).toBe(1);
    expect(scan.irrPercent).toBeCloseTo(9.4203, 3);
    expect(residual(scan.irrPercent as number, SOLAR_NETS)).toBeLessThan(1e-9);
  });

  // Quoting one of several roots as "the" IRR is the mistake the whole scan exists to stop.
  it("reports no IRR at all when NPV(r) crosses zero more than once", () => {
    const scan = scanIrr(THREE_ROOTS);
    expect(scan.crossings).toBe(3);
    expect(scan.unique).toBe(false);
    expect(scan.irrPercent).toBeNull();
  });

  it("has nothing to scan without a sign change in the flows", () => {
    expect(scanIrr([100, 200]).crossings).toBe(0);
    expect(scanIrr([100, 200]).irrPercent).toBeNull();
    expect(npvZeroCrossings([5])).toEqual([]);
  });
});

describe("breakeven discount rate", () => {
  it("is the rate at which NPV turns from positive to negative", () => {
    expect(breakevenRatePercent(MACHINE_NETS)).toBeCloseTo(15.0166, 3);
    expect(breakevenRatePercent(SOLAR_NETS)).toBeCloseTo(9.4203, 3);
  });

  it("is still a fact when the IRR is not one", () => {
    const rate = breakevenRatePercent(THREE_ROOTS);
    expect(rate).not.toBeNull();
    expect(residual(rate as number, THREE_ROOTS)).toBeLessThan(1e-9);
  });
});

describe("MIRR", () => {
  it("has exactly one answer, whatever the signs do", () => {
    const rate = mirrPercent(THREE_ROOTS, 10, 10) as number;
    expect(rate).not.toBeNull();
    // Outflows back at 10%, inflows forward at 10%, over three periods.
    const outflowPv = -1_000 + -11_000 / 1.1 ** 2;
    const inflowFv = 6_000 * 1.1 ** 2 + 6_000;
    expect(rate).toBeCloseTo(((inflowFv / -outflowPv) ** (1 / 3) - 1) * 100, 9);
  });

  it("refuses a rate with no growth factor, and flows with nothing on one side", () => {
    expect(mirrPercent(THREE_ROOTS, -100, 10)).toBeNull();
    expect(mirrPercent([100, 200], 10, 10)).toBeNull();
    expect(mirrPercent([-100], 10, 10)).toBeNull();
  });
});

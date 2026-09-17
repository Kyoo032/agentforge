import { describe, expect, it } from "vitest";
import { KAFE_ITEMS, KAFE_OPENING_CASH, STARTUP_ITEMS, STARTUP_OPENING_CASH } from "./__fixtures__/books";
import { burnBases, burnOnBasis, negativePeriods } from "./burn";
import { periodInputsFromItems, walkPeriods } from "./periods";

const kafe = walkPeriods(periodInputsFromItems(KAFE_ITEMS), KAFE_OPENING_CASH);
const startup = walkPeriods(periodInputsFromItems(STARTUP_ITEMS), STARTUP_OPENING_CASH);
const KAFE_CLOSING = 64_200_000;
const STARTUP_CLOSING = 1_491_390;

describe("the café's burn, on every basis", () => {
  it("names the three loss-making months and averages only those", () => {
    expect(negativePeriods(kafe).map((period) => period.period)).toEqual(["Jul 2024", "Nov 2024", "Des 2024"]);
    const burn = burnOnBasis(kafe, "negative", KAFE_CLOSING);
    // -(−12.250.000 − 9.650.000 − 14.650.000) / 3
    expect(burn.netBurn).toBeCloseTo(12_183_333.333333334, 6);
    expect(burn.runwayMonths).toBeCloseTo(5.269493844049247, 9);
  });

  it("keeps the last three months apart from them", () => {
    const burn = burnOnBasis(kafe, "last3", KAFE_CLOSING);
    expect(burn.periods).toEqual(["Okt 2024", "Nov 2024", "Des 2024"]);
    // -(1.050.000 − 9.650.000 − 14.650.000) / 3
    expect(burn.netBurn).toBeCloseTo(7_750_000, 6);
    expect(burn.runwayMonths).toBeCloseTo(8.283870967741935, 9);
  });

  it("reports a whole year that is cash positive as no runway rather than as a number", () => {
    const burn = burnOnBasis(kafe, "all", KAFE_CLOSING);
    // The year added 19.200.000 net, so there is nothing to divide into the balance.
    expect(burn.netBurn).toBeCloseTo(-1_600_000, 6);
    expect(burn.runwayMonths).toBeNull();
  });
});

describe("the start-up's burn", () => {
  it("keeps gross and net apart, both positive", () => {
    const burn = burnOnBasis(startup, "last3", STARTUP_CLOSING);
    expect(burn.grossBurn).toBeCloseTo(446_966.6666666667, 6);
    expect(burn.netBurn).toBeCloseTo(367_676.6666666667, 6);
    expect(burn.runwayMonths).toBeCloseTo(4.056254136333553, 9);
  });

  it("averages every month for the other reading", () => {
    const burn = burnOnBasis(startup, "all", STARTUP_CLOSING);
    expect(burn.grossBurn).toBeCloseTo(385_775.55555555556, 6);
    expect(burn.netBurn).toBeCloseTo(317_623.3333333333, 6);
  });

  it("never lets the financing round flatter the burn", () => {
    // May's operating out is 402.560 whatever the 2.500.000 SAFE did to the bank balance.
    const may = startup[4];
    expect(may?.cashOut).toBe(402_560);
    expect(burnOnBasis(startup, "all", STARTUP_CLOSING).grossBurn).toBeCloseTo(385_775.55555555556, 6);
  });
});

describe("every basis together", () => {
  it("answers with all three, labelled, rather than picking one", () => {
    expect(burnBases(kafe, KAFE_CLOSING).map((burn) => burn.id)).toEqual(["last3", "negative", "all"]);
  });
});

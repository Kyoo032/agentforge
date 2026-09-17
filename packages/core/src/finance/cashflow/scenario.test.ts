import { describe, expect, it } from "vitest";
import { KAFE_ITEMS, KAFE_OPENING_CASH, STARTUP_ITEMS, STARTUP_OPENING_CASH } from "./__fixtures__/books";
import { periodInputsFromItems, walkPeriods } from "./periods";
import { runScenario, scenarioBaselines } from "./scenario";
import { cashflowScenarioSchema } from "./types";

const kafe = walkPeriods(periodInputsFromItems(KAFE_ITEMS), KAFE_OPENING_CASH);
const startup = walkPeriods(periodInputsFromItems(STARTUP_ITEMS), STARTUP_OPENING_CASH);
const KAFE_CLOSING = 64_200_000;
const STARTUP_CLOSING = 1_491_390;

const CAFE_SCENARIO = cashflowScenarioSchema.parse({
  label: "Sewa -15%, penjualan +10%",
  adjustments: [
    { kind: "percent", target: "inflow", changePct: 10, scalesVariable: true },
    { kind: "percent", target: "rent", changePct: -15 },
  ],
});

const HIRES = cashflowScenarioSchema.parse({
  label: "3 engineers at 9k",
  adjustments: [{ kind: "recurring", amountPerPeriod: 27_000 }],
});

describe("baselines", () => {
  it("offers the last period and the recent average, both named", () => {
    const bases = scenarioBaselines(kafe);
    expect(bases.map((base) => base.id)).toEqual(["lastPeriod", "recentAverage"]);
    expect(bases[0]?.periods).toEqual(["Des 2024"]);
    expect(bases[1]?.periods).toEqual(["Okt 2024", "Nov 2024", "Des 2024"]);
  });
});

describe("the café's what-if", () => {
  const lastPeriod = runScenario(kafe, CAFE_SCENARIO, KAFE_CLOSING).find((run) => run.basis === "lastPeriod");

  it("lets the extra sales carry their own goods with them", () => {
    // +10% on 71.600.000 in, +10% on 31.400.000 of variable cost, -15% on 15.000.000 of rent.
    expect(lastPeriod?.deltaCashIn).toBeCloseTo(7_160_000, 6);
    expect(lastPeriod?.deltaCashOut).toBeCloseTo(890_000, 6);
  });

  it("lands on the new net and the new runway", () => {
    expect(lastPeriod?.netOperating).toBeCloseTo(-8_380_000, 6);
    expect(lastPeriod?.netBurn).toBeCloseTo(8_380_000, 6);
    expect(lastPeriod?.runwayMonths).toBeCloseTo(7.6610978520286395, 9);
  });

  it("would overstate the gain if the variable cost did not ride along", () => {
    const naive = cashflowScenarioSchema.parse({
      adjustments: [
        { kind: "percent", target: "inflow", changePct: 10 },
        { kind: "percent", target: "rent", changePct: -15 },
      ],
    });
    const run = runScenario(kafe, naive, KAFE_CLOSING).find((entry) => entry.basis === "lastPeriod");
    expect(run?.netOperating).toBeCloseTo(-5_240_000, 6);
  });
});

describe("the start-up's what-if", () => {
  const recent = runScenario(startup, HIRES, STARTUP_CLOSING).find((run) => run.basis === "recentAverage");

  it("adds the fully loaded hires to the recent burn and nothing else", () => {
    expect(recent?.baseline.cashOut).toBeCloseTo(446_966.6666666667, 6);
    expect(recent?.grossBurn).toBeCloseTo(473_966.6666666667, 6);
    expect(recent?.netBurn).toBeCloseTo(394_676.6666666667, 6);
    expect(recent?.runwayMonths).toBeCloseTo(3.7787640515865304, 9);
  });
});

describe("single events", () => {
  it("come off the balance once and never enter the per-period burn", () => {
    const oneOff = cashflowScenarioSchema.parse({ adjustments: [{ kind: "oneOff", amount: 200_000 }] });
    const run = runScenario(startup, oneOff, STARTUP_CLOSING).find((entry) => entry.basis === "recentAverage");
    expect(run?.netBurn).toBeCloseTo(367_676.6666666667, 6);
    expect(run?.cashAfterOneOff).toBe(1_291_390);
    expect(run?.runwayMonths).toBeCloseTo(1_291_390 / 367_676.6666666667, 9);
  });
});

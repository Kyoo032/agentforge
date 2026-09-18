import { describe, expect, it } from "vitest";
import { MACHINE_ITEMS, SOLAR_ITEMS } from "../appraisal/__fixtures__/plans";
import { ADVICE_MARKER } from "../../market/advice-guard";
import { extractNumbers, isFreeNumber, matchesAllowed } from "../number-guard";
import { CALC_TABLE_ID, INPUTS_TABLE_ID, reportTable, type FinanceReport } from "../report";
import { FINANCE_TASK_META } from "../tasks";
import { appraisalInputSchema, appraisalParamsFrom, appraisalTaskModule } from "./appraisal";
import type { FinanceTaskProse } from "./types";

const MACHINE = {
  items: MACHINE_ITEMS,
  params: { discountRate: 12, rateScenarios: [10, 12, 14], cashFlowShifts: [-10, 0, 10] },
};

const SOLAR = {
  items: SOLAR_ITEMS,
  params: { discountRate: 8, rateScenarios: [6, 8, 10], cashFlowShifts: [-10, 0, 10] },
};

const PROSE: FinanceTaskProse = {
  title: "Roasting machine appraisal",
  sections: [
    { id: "verdict", heading: "The plan clears at 12%", body: "NPV is positive at the rate asked for." },
    { id: "appraisal-metrics", heading: "The metrics", body: "Payback lands inside the horizon." },
    { id: "sensitivity", heading: "Where it turns", body: "Two cells go negative." },
    { id: "assumptions", heading: "What has to hold", body: "The flows are annual." },
  ],
  assumptions: ["Figures are annual and in IDR."],
};

function computeOf(request: unknown) {
  return appraisalTaskModule.compute(appraisalInputSchema.parse(request));
}

function reportOf(request: unknown, locale: "id" | "en"): FinanceReport {
  const input = appraisalInputSchema.parse(request);
  return appraisalTaskModule.buildReport(appraisalTaskModule.compute(input), PROSE, { locale });
}

/** Every number in a table, a chart series or a KPI — the pool a figure may legitimately reach. */
function structuredNumbers(report: FinanceReport): number[] {
  const cells = report.tables.flatMap((table) =>
    table.rows.flatMap((row) => row.filter((value): value is number => typeof value === "number")),
  );
  const series = report.charts.flatMap((chart) =>
    chart.series.flatMap((line) => line.values.filter((value): value is number => value !== null)),
  );
  const kpis = report.summary
    .map((entry) => entry.value)
    .filter((value): value is number => typeof value === "number");
  return [...cells, ...series, ...kpis];
}

function carries(report: FinanceReport, expected: number, tolerance = 1e-6): boolean {
  return structuredNumbers(report).some(
    (value) => Math.abs(value - expected) <= Math.max(tolerance, Math.abs(expected) * tolerance),
  );
}

describe("appraisal input", () => {
  it("refuses anything the owner has not confirmed", () => {
    expect(appraisalInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(appraisalInputSchema.safeParse({}).success).toBe(false);
    expect(appraisalInputSchema.safeParse({ items: MACHINE_ITEMS, params: { discountRate: -200 } }).success).toBe(
      false,
    );
  });

  // The prompt bar calls it `discountRate`, the parameters panel `discountRatePercent`.
  it("takes the rate under either of the two names the app sends it as", () => {
    expect(appraisalParamsFrom({ discountRate: 12 }).discountRatePercent).toBe(12);
    expect(appraisalParamsFrom({ discountRatePercent: 9 }).discountRatePercent).toBe(9);
    expect(appraisalParamsFrom({}).discountRatePercent).toBe(10);
    expect(appraisalParamsFrom({ rateScenarios: [6, 8] }).ratePercents).toEqual([6, 8]);
    expect(appraisalParamsFrom({ cashFlowShifts: [-5, 5] }).shiftPercents).toEqual([-5, 5]);
  });
});

describe("appraisal compute", () => {
  it("matches the machine plan's figures", () => {
    const computed = computeOf(MACHINE);
    expect(computed.npv).toBeCloseTo(139_939_433.60188407, 4);
    expect(computed.irr.irrPercent).toBeCloseTo(15.0166, 3);
    expect(computed.irr.unique).toBe(true);
    expect(computed.paybackYears).toBeCloseTo(4.024390243902439, 10);
    expect(computed.discountedPaybackYears).toBeCloseTo(5.506757806080001, 10);
    expect(computed.profitabilityIndex).toBeCloseTo(1.096509954208196, 10);
    expect(computed.periods.map((period) => period.cumulative)).toEqual([
      -1_450_000_000, -1_165_000_000, -825_000_000, -430_000_000, -10_000_000, 400_000_000, 960_000_000,
    ]);
    expect(computed.negativeCells).toHaveLength(2);
  });

  it("matches the solar plan's figures, negative year and all", () => {
    const computed = computeOf(SOLAR);
    expect(computed.npv).toBeCloseTo(56_126.53512720848, 6);
    expect(computed.irr.signChanges).toBe(3);
    expect(computed.irr.crossings).toBe(1);
    expect(computed.irr.irrPercent).toBeCloseTo(9.4203, 3);
    expect(computed.paybackYears).toBeCloseTo(7.038216560509555, 10);
    expect(computed.discountedPaybackYears).toBeCloseTo(9.41743759761327, 10);
    expect(computed.profitabilityIndex).toBeCloseTo(1.0684469940575714, 10);
    expect(computed.negativeYears.map((year) => year.period)).toEqual(["Year 5"]);
    expect(computed.negativeCells).toHaveLength(3);
  });
});

describe("appraisal report", () => {
  it("declares the sections the task meta declares", () => {
    expect(appraisalTaskModule.sections.map((section) => section.id)).toEqual([
      ...FINANCE_TASK_META.appraisal.sections,
    ]);
  });

  it("fills a note for every section and an assumptions note beside them", () => {
    const report = reportOf(MACHINE, "id");
    expect(report.notes.map((note) => note.heading)).toEqual([
      "The plan clears at 12%",
      "The metrics",
      "Where it turns",
      "What has to hold",
      "Asumsi",
    ]);
  });

  it("draws the cumulative line and the sensitivity grid the plan asks for", () => {
    const report = reportOf(SOLAR, "en");
    expect(report.charts.map((chart) => chart.kind)).toEqual(["line", "heat"]);
    expect(report.charts[0]?.categories).toHaveLength(11);
    expect(report.charts[1]?.series.map((series) => series.name)).toEqual(["6%", "8%", "10%"]);
    expect(report.charts[1]?.note).toContain("3 negative cells out of 9");
  });

  // Every figure a case asks for must reach the reader as a number, not only as prose.
  it("carries every headline figure as a KPI, a cell or a series value", () => {
    const report = reportOf(MACHINE, "id");
    for (const expected of [
      139_939_433.60188407,
      4.024390243902439,
      5.506757806080001,
      1.096509954208196,
      -1_450_000_000,
      560_000_000,
      960_000_000,
      -19_054_509.758304268,
      413_840_864.07411265,
    ]) {
      expect(carries(report, expected, 1e-4), String(expected)).toBe(true);
    }
    expect(report.summary.map((entry) => entry.label)).toContain("NPV @ 12%");
    expect(report.summary.map((entry) => entry.label)).toContain("Payback sederhana");
  });

  it("names the discounted crossing and the negative year as flags", () => {
    const report = reportOf(SOLAR, "en");
    const texts = report.flags.map((flag) => flag.text).join(" | ");
    expect(texts).toContain("Year 5");
    expect(texts).toContain("negative cells out of 9");
  });

  it("writes the Calc sheet as live NPV and IRR formulas over the Inputs flows", () => {
    const report = reportOf(MACHINE, "en");
    const inputs = reportTable(report, INPUTS_TABLE_ID);
    const calc = reportTable(report, CALC_TABLE_ID);
    expect(inputs?.rows).toHaveLength(7);
    // Excel's NPV discounts its first value, so the t = 0 outlay is added outside the call.
    expect(calc?.formulas?.[1]?.[1]).toBe("Inputs!$D$2+NPV(Calc!$B$2/100,Inputs!$D$3:$D$8)");
    expect(calc?.formulas?.[2]?.[1]).toBe("IRR(Inputs!$D$2:$D$8)*100");
    expect(calc?.formulas?.[3]?.[1]).toBe("($B$3-Inputs!$D$2)/-Inputs!$D$2");
    const sensitivity = report.tables.find((table) => table.id === "sensitivity");
    expect(sensitivity?.formulas?.[0]?.[1]).toBe("Inputs!$D$2+0.9*NPV(0.1,Inputs!$D$3:$D$8)");
    expect(sensitivity?.formulas?.[1]?.[2]).toBe("Inputs!$D$2+NPV(0.12,Inputs!$D$3:$D$8)");
  });

  // This is a reading of the figures, not a transaction instruction.
  it("removes a transaction directive the model slipped into a section", () => {
    const pushy: FinanceTaskProse = {
      ...PROSE,
      sections: PROSE.sections.map((section) =>
        section.id === "verdict" ? { ...section, body: "You should buy this machine now." } : section,
      ),
    };
    const input = appraisalInputSchema.parse(MACHINE);
    const report = appraisalTaskModule.buildReport(appraisalTaskModule.compute(input), pushy, { locale: "en" });
    expect(report.notes[0]?.body).toContain(ADVICE_MARKER);
    expect(report.flags.some((flag) => flag.text.includes("transaction directive"))).toBe(true);
  });
});

describe("the facts and the guard", () => {
  // A figure the model is shown but not allowed comes back struck out: that is a bug here, not there.
  it.each(["id", "en"] as const)("allows every figure its prompt facts print (%s)", (locale) => {
    for (const request of [MACHINE, SOLAR]) {
      const input = appraisalInputSchema.parse(request);
      const computed = appraisalTaskModule.compute(input);
      const allowed = appraisalTaskModule.allowedNumbers(input, computed);
      const unverified = extractNumbers(appraisalTaskModule.promptFacts(computed, locale))
        .filter((token) => !isFreeNumber(token))
        .filter((token) => !matchesAllowed(token.value, allowed))
        .filter((token) => token.alternate === undefined || !matchesAllowed(token.alternate, allowed));
      expect(unverified.map((token) => token.text)).toEqual([]);
    }
  });

  it("cites every figure by a key a memo can quote", () => {
    const facts = appraisalTaskModule.promptFacts(computeOf(SOLAR), "en");
    for (const key of [
      "npv",
      "irrPct",
      "flowSignChanges",
      "npvZeroCrossings",
      "paybackYears",
      "discountedPaybackYears",
      "profitabilityIndex",
      "netCashFlow.Year 5",
      "cumulativeCashFlow.Year 8",
      "sensitivityNpv.rate10.flowsbase",
    ]) {
      expect(facts).toContain(key);
    }
  });
});

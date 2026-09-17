import { describe, expect, it } from "vitest";
import {
  KAFE_ITEMS,
  KAFE_OPENING_CASH,
  STARTUP_ITEMS,
  STARTUP_OPENING_CASH,
} from "../cashflow/__fixtures__/books";
import { cashflowInputSchema } from "../cashflow/compute";
import { extractNumbers, isFreeNumber, matchesAllowed } from "../number-guard";
import { CALC_TABLE_ID, INPUTS_TABLE_ID, reportTable } from "../report";
import { cashflowTaskModule } from "./cashflow";
import type { FinanceTaskProse } from "./types";

const PROSE: FinanceTaskProse = {
  title: "Runway ke September 2025",
  sections: [
    { id: "position", heading: "Di mana kas berdiri", body: "Saldo akhir Desember 64.200.000." },
    { id: "burn-and-runway", heading: "Seberapa cepat kas turun", body: "Burn bersih 7.750.000." },
    { id: "scenario", heading: "Kalau sewa dipotong", body: "Arus kas bersih -8.380.000." },
    { id: "flags", heading: "Yang perlu diperhatikan", body: "Tiga bulan minus." },
  ],
  assumptions: ["Angka dalam Rupiah."],
};

const KAFE = cashflowInputSchema.parse({
  items: KAFE_ITEMS,
  params: { openingCash: KAFE_OPENING_CASH, salesLiftPct: 10, rentCutPct: 15 },
});

const STARTUP = cashflowInputSchema.parse({
  items: STARTUP_ITEMS,
  params: { openingCash: STARTUP_OPENING_CASH, newEngineers: 3, costPerEngineer: 9_000 },
});

describe("the cash-flow task module", () => {
  it("refuses an input the reader has not confirmed", () => {
    expect(cashflowInputSchema.safeParse({}).success).toBe(false);
    expect(cashflowInputSchema.safeParse({ items: [] }).success).toBe(false);
    expect(cashflowInputSchema.parse({ items: KAFE_ITEMS }).params).toEqual({});
  });

  it("computes the café's book, month by month, in code", () => {
    const computed = cashflowTaskModule.compute(KAFE);
    expect(computed.periods).toHaveLength(12);
    expect(computed.closingCash).toBe(64_200_000);
    expect(computed.totals.cashIn).toBe(1_153_300_000);
    expect(computed.totals.cashOut).toBe(1_134_100_000);
    expect(computed.negativePeriods.map((period) => period.period)).toEqual(["Jul 2024", "Nov 2024", "Des 2024"]);
    expect(computed.monthsToZeroCash).toBeCloseTo(8.283870967741935, 9);
    expect(computed.breakeven.revenuePerPeriod).toBeCloseTo(91_598_512.30761519, 4);
  });

  it("turns the named levers into the same typed adjustments the panel writes", () => {
    const computed = cashflowTaskModule.compute(KAFE);
    expect(computed.scenario.adjustments).toEqual([
      { kind: "percent", target: "inflow", changePct: 10, scalesVariable: true },
      { kind: "percent", target: "rent", changePct: -15, scalesVariable: false },
    ]);
    const lastPeriod = computed.outcomes.find((outcome) => outcome.basis === "lastPeriod");
    expect(lastPeriod?.netOperating).toBeCloseTo(-8_380_000, 6);
    expect(lastPeriod?.runwayMonths).toBeCloseTo(7.6610978520286395, 9);
  });

  it("computes the start-up's burn without ever counting the financing round as revenue", () => {
    const computed = cashflowTaskModule.compute(STARTUP);
    expect(computed.totals.cashIn).toBe(613_370);
    expect(computed.totals.financingIn).toBe(2_500_000);
    expect(computed.closingCash).toBe(1_491_390);
    expect(computed.primaryBurn.grossBurn).toBeCloseTo(446_966.6666666667, 6);
    expect(computed.primaryBurn.netBurn).toBeCloseTo(367_676.6666666667, 6);
    expect(computed.primaryBurn.runwayMonths).toBeCloseTo(4.056254136333553, 9);
    const recent = computed.outcomes.find((outcome) => outcome.basis === "recentAverage");
    expect(recent?.deltaCashOut).toBe(27_000);
    expect(recent?.netBurn).toBeCloseTo(394_676.6666666667, 6);
    expect(recent?.runwayMonths).toBeCloseTo(3.7787640515865304, 9);
  });

  // The guard is only as honest as this pair: anything printed must also be allowed.
  it("allows every figure its prompt facts print", () => {
    for (const input of [KAFE, STARTUP]) {
      const computed = cashflowTaskModule.compute(input);
      const allowed = cashflowTaskModule.allowedNumbers(input, computed);
      for (const locale of ["id", "en"] as const) {
        const facts = cashflowTaskModule.promptFacts(computed, locale);
        for (const token of extractNumbers(facts)) {
          if (!isFreeNumber(token)) {
            expect(matchesAllowed(token.value, allowed), `${locale} ${token.text}`).toBe(true);
          }
        }
      }
    }
  });

  it("writes its facts in the reader's own number format", () => {
    const computed = cashflowTaskModule.compute(KAFE);
    expect(cashflowTaskModule.promptFacts(computed, "id")).toContain("1.153.300.000");
    expect(cashflowTaskModule.promptFacts(computed, "id")).toContain("September 2025");
    expect(cashflowTaskModule.promptFacts(computed, "en")).toContain("1,153,300,000");
  });

  it("builds the report every renderer reads", () => {
    const computed = cashflowTaskModule.compute(KAFE);
    const report = cashflowTaskModule.buildReport(computed, PROSE, { locale: "id" });
    expect(report.task).toBe("cashflow");
    expect(report.locale).toBe("id");
    expect(report.currency).toBe("IDR");
    for (const section of cashflowTaskModule.sections) {
      const heading = PROSE.sections.find((entry) => entry.id === section.id)?.heading ?? "";
      expect(report.notes.map((note) => note.heading), section.id).toContain(heading);
    }
    expect(report.charts.map((chart) => chart.id)).toEqual(["cash-balance", "net-cash"]);
    expect(report.charts[0]?.kind).toBe("line");
    expect(report.charts[0]?.note).toContain("September 2025");
    expect(report.summary.some((kpi) => kpi.flag === "watch" || kpi.flag === "risk")).toBe(true);
  });

  it("gives the workbook an Inputs sheet and live formulas over it", () => {
    const report = cashflowTaskModule.buildReport(cashflowTaskModule.compute(KAFE), PROSE, { locale: "en" });
    const inputs = reportTable(report, INPUTS_TABLE_ID);
    expect(inputs?.columns).toEqual(["Label", "Period", "Category", "Amount", "Currency"]);
    const calc = reportTable(report, CALC_TABLE_ID);
    const formulas = (calc?.formulas ?? []).flat().filter((cell): cell is string => cell !== null);
    expect(formulas.some((formula) => formula.includes('SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"inflow"'))).toBe(true);
    // A period the reader typed is addressed as a cell, never inlined into the formula text.
    expect(formulas.some((formula) => formula.includes("Des 2024"))).toBe(false);
  });

  it("carries every figure a reader asked for into the report's own numbers", () => {
    const report = cashflowTaskModule.buildReport(cashflowTaskModule.compute(KAFE), PROSE, { locale: "id" });
    const numbers = [
      ...report.summary.map((kpi) => kpi.value),
      ...report.tables.flatMap((table) => table.rows.flat()),
      ...report.charts.flatMap((chart) => chart.series.flatMap((series) => series.values)),
    ].filter((value): value is number => typeof value === "number");
    const wanted = [
      3_250_000, -14_650_000, 48_250_000, 64_200_000, 1_153_300_000, 1_134_100_000, 12_183_333.333333334, 7_750_000,
      5.269493844049247, 8.283870967741935, 91_598_512.30761519, 1_099_182_147.6913822, 57.651955258822504,
      -8_380_000, 7.6610978520286395,
    ];
    for (const value of wanted) {
      expect(numbers.some((found) => Math.abs(found - value) <= Math.max(1e-6, Math.abs(value) * 1e-9)), String(value)).toBe(
        true,
      );
    }
  });
});

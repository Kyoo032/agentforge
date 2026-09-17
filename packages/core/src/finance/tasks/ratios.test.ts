import { describe, expect, it } from "vitest";
import { extractNumbers, isFreeNumber, matchesAllowed } from "../number-guard";
import { CALC_TABLE_ID, INPUTS_TABLE_ID, reportTable, type FinanceReport } from "../report";
import { manufakturRows } from "../ratios/__fixtures__/manufaktur";
import { financeTaskMeta } from "../tasks";
import { ratiosTaskModule, type RatiosComputed } from "./ratios";
import type { FinanceTaskProse } from "./types";

const PROSE: FinanceTaskProse = {
  title: "Kesehatan rasio PT Baja Karya Mandiri",
  sections: [
    { id: "scorecard", heading: "Kartu skor", body: "Rasio lancar 1,60x." },
    { id: "liquidity", heading: "Likuiditas", body: "Rasio cepat 1,00x." },
    { id: "leverage", heading: "Beban utang", body: "Utang terhadap ekuitas 1,30x." },
    { id: "coverage", heading: "Kemampuan bayar", body: "DSCR 2,46x." },
  ],
  assumptions: ["Angka dalam rupiah."],
};

function body(extra: Record<string, unknown> = {}) {
  return {
    prompt: "Hitung rasio keuangan 2024.",
    task: "ratios",
    locale: "id",
    items: manufakturRows().map((row) => ({
      label: row.label,
      period: row.period ?? "",
      amount: row.amount,
      currency: "IDR",
      category: "other" as const,
    })),
    params: { daysPerYear: 365 },
    ...extra,
  };
}

function computedFrom(extra: Record<string, unknown> = {}): RatiosComputed {
  return ratiosTaskModule.compute(ratiosTaskModule.inputSchema.parse(body(extra)));
}

function report(extra: Record<string, unknown> = {}): FinanceReport {
  return ratiosTaskModule.buildReport(computedFrom(extra), PROSE, { locale: "en" });
}

describe("ratiosTaskModule.inputSchema", () => {
  it("takes the studio's own body — items, params and the requested locale", () => {
    const parsed = ratiosTaskModule.inputSchema.parse(body());
    expect(parsed.items).toHaveLength(54);
    expect(parsed.locale).toBe("id");
    expect(parsed.params.buckets).toEqual([]);
  });

  it("refuses a body with no confirmed rows", () => {
    expect(ratiosTaskModule.inputSchema.safeParse({ prompt: "x" }).success).toBe(false);
    expect(ratiosTaskModule.inputSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("reads a supporting figure that arrives keyed by its period", () => {
    const thin = manufakturRows().filter((row) => row.label !== "Pembayaran Pokok Pinjaman");
    const parsed = ratiosTaskModule.inputSchema.parse({
      items: thin.map((row) => ({ label: row.label, period: row.period, amount: row.amount, currency: "IDR" })),
      params: { principalRepayment2024: 1_050_000_000 },
    });
    const computed = ratiosTaskModule.compute(parsed);
    expect(computed.ratios.byPeriod[1]?.values.debtService).toBe(1_866_000_000);
  });
});

describe("ratiosTaskModule.compute", () => {
  it("reads 2024 and keeps 2023 as the comparison", () => {
    const computed = computedFrom();
    expect(computed.period).toBe("2024");
    expect(computed.ratios.prior).toBe("2023");
    expect(computed.locale).toBe("id");
  });

  it("honours a period the reader picked", () => {
    expect(computedFrom({ params: { period: "2023" } }).period).toBe("2023");
    expect(computedFrom({ params: { period: "1999" } }).period).toBe("2024");
  });

  it("moves with a bucket the reader changed", () => {
    const moved = computedFrom({
      params: { buckets: [{ label: "Persediaan", period: "", bucket: "other-current-asset" }] },
    });
    // Inventory is still a current asset, so the current ratio holds and only the quick ratio moves.
    expect(moved.ratios.byPeriod[1]?.values.currentRatio ?? 0).toBeCloseTo(1.6009, 4);
    expect(moved.ratios.byPeriod[1]?.values.quickRatio ?? 0).toBeCloseTo(1.6009, 4);
  });
});

describe("ratiosTaskModule.buildReport", () => {
  it("fills a note for every section the task declares", () => {
    const headings = report().notes.map((note) => note.heading);
    for (const section of PROSE.sections) {
      expect(headings).toContain(section.heading);
    }
    expect(ratiosTaskModule.sections.map((section) => section.id)).toEqual([...financeTaskMeta("ratios").sections]);
  });

  it("carries the confirmed rows and live formulas the workbook needs", () => {
    const built = report();
    expect(reportTable(built, INPUTS_TABLE_ID)?.rows).toHaveLength(54);
    const calc = reportTable(built, CALC_TABLE_ID);
    const formulas = (calc?.formulas ?? []).flat().filter((entry) => entry !== null);
    expect(formulas.length).toBeGreaterThan(50);
    expect(formulas.some((entry) => (entry as string).includes('SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"inventory"'))).toBe(
      true,
    );
  });

  it("draws one banded gauge per ratio family", () => {
    const charts = report().charts;
    expect(charts.map((chart) => chart.id)).toEqual([
      "gauge-currentRatio",
      "gauge-quickRatio",
      "gauge-debtToEquityTotal",
      "gauge-dscrEbitda",
      "gauge-interestCoverage",
    ]);
    expect(charts.every((chart) => chart.kind === "gauge")).toBe(true);
    expect(charts[0]?.series[0]?.values[0] ?? 0).toBeCloseTo(1.6009, 4);
  });

  it("puts every truth figure of the case into a KPI or a table cell", () => {
    const built = report();
    const pool = [
      ...built.summary.map((kpi) => kpi.value),
      ...built.tables.flatMap((table) => table.rows.flat()),
    ].filter((cell): cell is number => typeof cell === "number");
    const wanted: ReadonlyArray<readonly [string, number]> = [
      ["currentAssets.2024", 12_607_000_000],
      ["currentLiabilities.2024", 7_875_000_000],
      ["totalAssets.2024", 24_647_000_000],
      ["totalLiabilities.2024", 13_920_000_000],
      ["totalEquity.2024", 10_727_000_000],
      ["balanceCheck.2024", 0],
      ["workingCapital.2024", 4_732_000_000],
      ["currentRatio.2024", 1.6009],
      ["currentRatio.2023", 1.5825],
      ["quickRatio.2024", 1.0009],
      ["cashRatio.2024", 0.2971],
      ["debtToEquityTotal.2024", 1.2977],
      ["debtToEquityInterestBearing.2024", 0.7551],
      ["nonCurrentDebtToEquity.2024", 0.5635],
      ["ebit.2024", 3_840_000_000],
      ["ebitda.2024", 4_590_000_000],
      ["interestExpense.2024", 816_000_000],
      ["debtService.2024", 1_866_000_000],
      ["interestCoverage.2024", 4.7059],
      ["dscrEbitda.2024", 2.4598],
      ["dscrEbit.2024", 2.0579],
      ["grossMarginPct.2024", 29.0074],
      ["returnOnEquityPct.2024", 21.6396],
      ["inventoryTurnover.2024", 5.0709],
    ];
    const missing = wanted.filter(
      ([, value]) => !pool.some((found) => Math.abs(found - value) <= Math.max(0.005 * Math.abs(value), 1e-9)),
    );
    expect(missing.map(([key]) => key)).toEqual([]);
  });

  it("writes the report in the language the request asked for, not the host's", () => {
    const built = report();
    expect(built.locale).toBe("id");
    const text = JSON.stringify(built);
    expect(text).toContain("Rasio lancar");
    expect(text).toContain("ekuitas");
    expect(text).toContain("rule of thumb");
  });

  it("raises the balance sheet itself when the two sides disagree", () => {
    const broken = ratiosTaskModule.buildReport(
      computedFrom({
        items: [
          { label: "Kas dan Setara Kas", period: "2024", amount: 100, currency: "IDR" },
          { label: "Utang Usaha", period: "2024", amount: 30, currency: "IDR" },
          { label: "Modal Saham", period: "2024", amount: 50, currency: "IDR" },
        ],
      }),
      PROSE,
      { locale: "id" },
    );
    expect(broken.flags.some((flag) => flag.level === "risk" && /tidak seimbang/.test(flag.text))).toBe(true);
  });
});

/**
 * The host refuses to store a report past this many bytes (`FINANCE_REPORT_MAX_BYTES` in
 * `packages/host/src/finance-tasks/report-schema.ts`), and an unstorable report exports as prose.
 * Repeated here rather than imported: core does not depend on host.
 */
const REPORT_MAX_BYTES = 262_144;

describe("ratiosTaskModule report size", () => {
  it.each([12, 36])("stays storable at %i periods", (count) => {
    const periods = Array.from({ length: count }, (_, at) => `2024-${String(at + 1).padStart(2, "0")}`);
    const rows = manufakturRows().filter((row) => row.period === "2024");
    const items = periods.flatMap((period) =>
      rows.map((row) => ({ label: row.label, period, amount: row.amount, currency: "IDR", category: "other" as const })),
    );
    const input = ratiosTaskModule.inputSchema.parse({ items, locale: "id" });
    const built = ratiosTaskModule.buildReport(ratiosTaskModule.compute(input), PROSE, { locale: "id" });
    expect(JSON.stringify(built).length).toBeLessThan(REPORT_MAX_BYTES);
  });

  it("writes live formulas for the read period and its comparison, and values for the rest", () => {
    const built = report();
    const calc = reportTable(built, CALC_TABLE_ID);
    expect(new Set((calc?.rows ?? []).map((row) => row[3]))).toEqual(new Set(["2023", "2024"]));
    const trend = built.tables.find((table) => table.id === "trend");
    expect(trend?.columns).toEqual([expect.any(String), "2023", "2024"]);
  });
});

describe("ratiosTaskModule fact sheet and guard", () => {
  it("shows the model nothing the guard would then take away", () => {
    const input = ratiosTaskModule.inputSchema.parse(body());
    const computed = ratiosTaskModule.compute(input);
    const allowed = ratiosTaskModule.allowedNumbers(input, computed);
    const facts = ratiosTaskModule.promptFacts(computed, "id");
    const unverified = extractNumbers(facts)
      .filter((token) => !isFreeNumber(token))
      .filter((token) => !matchesAllowed(token.value, allowed))
      .filter((token) => token.alternate === undefined || !matchesAllowed(token.alternate, allowed));
    expect(unverified.map((token) => token.text)).toEqual([]);
  });

  it("names every ratio, its formula and its band, in the requested language", () => {
    const facts = ratiosTaskModule.promptFacts(computedFrom(), "en");
    expect(facts).toContain("dscrEbitda.2024");
    expect(facts).toContain("dscrEbit.2024");
    expect(facts).toContain("debtToEquityInterestBearing.2024");
    expect(facts).toContain("rule of thumb");
    expect(facts).toContain("Rasio lancar");
  });

  it("declares every input amount as a figure the narrative may quote", () => {
    const input = ratiosTaskModule.inputSchema.parse(body());
    const allowed = ratiosTaskModule.allowedNumbers(input, ratiosTaskModule.compute(input));
    for (const item of input.items) {
      expect(allowed).toContain(item.amount);
    }
  });
});

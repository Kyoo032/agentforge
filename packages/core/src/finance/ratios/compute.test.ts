import { describe, expect, it } from "vitest";
import { bandForMetric, ratioBandTable, trendOf } from "./bands";
import { classifyRatioRows } from "./classify";
import { computeRatios, ratioValue } from "./compute";
import { manufakturRows, manufakturSubtotals } from "./__fixtures__/manufaktur";

function computed(extra: ReturnType<typeof manufakturRows> = []) {
  return computeRatios(classifyRatioRows([...manufakturRows(), ...extra]), {
    daysPerYear: 365,
  });
}

/** Every figure hand-checked against the statements in `__fixtures__/manufaktur.ts`. */
const EXPECTED_2024: ReadonlyArray<readonly [string, number]> = [
  // 2.34 + 5.18 + 4.725 + 0.362, in miliar
  ["currentAssets", 12_607_000_000],
  // 8.5 + 7.18 - 4.025 + 0.385
  ["nonCurrentAssets", 12_040_000_000],
  ["totalAssets", 24_647_000_000],
  // 3.96 + 1.8 + 0.59 + 0.425 + 1.1 — the current portion of the term loan included once
  ["currentLiabilities", 7_875_000_000],
  ["nonCurrentLiabilities", 6_045_000_000],
  ["totalLiabilities", 13_920_000_000],
  ["totalEquity", 10_727_000_000],
  // 1.8 short-term bank + 1.1 current portion + 5.2 long-term bank; employee benefits are not debt
  ["interestBearingDebt", 8_100_000_000],
  ["balanceCheck", 0],
  ["workingCapital", 4_732_000_000],
  ["inventory", 4_725_000_000],
  ["revenue", 33_750_000_000],
  ["cogs", 23_960_000_000],
  ["grossProfit", 9_790_000_000],
  ["opex", 5_950_000_000],
  ["ebit", 3_840_000_000],
  ["depreciation", 750_000_000],
  ["ebitda", 4_590_000_000],
  ["interestExpense", 816_000_000],
  ["principalRepayment", 1_050_000_000],
  ["debtService", 1_866_000_000],
  ["profitBeforeTax", 2_976_000_000],
  ["netProfit", 2_321_280_000],
];

/** The ratios, to four decimals, as the case's own independent oracle re-derives them. */
const EXPECTED_RATIOS_2024: ReadonlyArray<readonly [string, number]> = [
  ["currentRatio", 1.6009],
  ["quickRatio", 1.0009],
  ["cashRatio", 0.2971],
  ["debtToEquityTotal", 1.2977],
  ["debtToEquityInterestBearing", 0.7551],
  ["nonCurrentDebtToEquity", 0.5635],
  ["interestCoverage", 4.7059],
  ["dscrEbitda", 2.4598],
  ["dscrEbit", 2.0579],
  ["grossMarginPct", 29.0074],
  ["returnOnEquityPct", 21.6396],
  ["inventoryTurnover", 5.0709],
];

describe("computeRatios", () => {
  it("names 2024 as the period every headline ratio is taken from", () => {
    const result = computed();
    expect(result.periods).toEqual(["2023", "2024"]);
    expect(result.latest).toBe("2024");
    expect(result.prior).toBe("2023");
    expect(result.currency).toBe("IDR");
  });

  it.each(EXPECTED_2024)("totals %s for 2024", (key, value) => {
    expect(ratioValue(computed(), key, "2024")).toBeCloseTo(value, 2);
  });

  it.each(EXPECTED_RATIOS_2024)("computes %s for 2024", (key, value) => {
    expect(ratioValue(computed(), key, "2024") ?? Number.NaN).toBeCloseTo(value, 4);
  });

  it("balances the balance sheet in both years, exactly", () => {
    const result = computed();
    expect(ratioValue(result, "balanceCheck", "2023")).toBe(0);
    expect(ratioValue(result, "balanceCheck", "2024")).toBe(0);
  });

  it("keeps the prior year separate rather than summing the columns", () => {
    const result = computed();
    expect(ratioValue(result, "currentAssets", "2023")).toBe(10_215_000_000);
    expect(ratioValue(result, "currentRatio", "2023") ?? Number.NaN).toBeCloseTo(1.5825, 4);
  });

  it("never lets a tagged subtotal into a total", () => {
    expect(ratioValue(computed(manufakturSubtotals()), "totalAssets", "2024")).toBe(24_647_000_000);
  });

  it("reports both DSCR bases and all three debt-to-equity readings", () => {
    const values = computed().byPeriod[1]?.values ?? {};
    for (const key of [
      "dscrEbitda",
      "dscrEbit",
      "debtToEquityTotal",
      "debtToEquityInterestBearing",
      "nonCurrentDebtToEquity",
    ]) {
      expect(values[key]).toBeTypeOf("number");
    }
  });

  it("answers null rather than a number when a pile is not there", () => {
    const thin = computeRatios(classifyRatioRows([{ label: "Kas", amount: 100, period: "2024", currency: "IDR" }]));
    expect(ratioValue(thin, "currentRatio", "2024")).toBeNull();
    expect(ratioValue(thin, "dscrEbitda", "2024")).toBeNull();
    expect(ratioValue(thin, "balanceCheck", "2024")).toBeNull();
    expect(ratioValue(thin, "currentAssets", "2024")).toBe(100);
  });

  it("takes a typed supporting figure only when no row carries it", () => {
    const rows = classifyRatioRows(manufakturRows().filter((row) => row.label !== "Pembayaran Pokok Pinjaman"));
    const withParam = computeRatios(rows, { principalRepayment: 1_050_000_000 });
    expect(ratioValue(withParam, "debtService", "2024")).toBe(1_866_000_000);
    const fromRows = computeRatios(classifyRatioRows(manufakturRows()), { principalRepayment: 999 });
    expect(ratioValue(fromRows, "principalRepayment", "2024")).toBe(1_050_000_000);
  });

  // The task schema accepts a negative typed figure. A row in the same bucket is read as a size, so a
  // repayment typed as -1.05bn is a repayment of 1.05bn — not a debt service 1.05bn smaller.
  it("reads a typed depreciation or repayment written negative as the size it is, as a row would be", () => {
    const supporting = new Set(["Beban Penyusutan dan Amortisasi", "Pembayaran Pokok Pinjaman"]);
    const rows = classifyRatioRows(manufakturRows().filter((row) => !supporting.has(row.label)));
    const negative = computeRatios(rows, { depreciation: -750_000_000, principalRepayment: -1_050_000_000 });
    const positive = computeRatios(rows, { depreciation: 750_000_000, principalRepayment: 1_050_000_000 });
    expect(negative.byPeriod.map((entry) => entry.values)).toEqual(positive.byPeriod.map((entry) => entry.values));
    expect(ratioValue(negative, "depreciation", "2024")).toBe(750_000_000);
    expect(ratioValue(negative, "ebitda", "2024")).toBe(4_590_000_000);
    expect(ratioValue(negative, "debtService", "2024")).toBe(1_866_000_000);
    const perPeriod = computeRatios(rows, { supporting: { "2024": { principalRepayment: -1_050_000_000 } } });
    expect(ratioValue(perPeriod, "principalRepayment", "2024")).toBe(1_050_000_000);
    expect(ratioValue(perPeriod, "principalRepayment", "2023")).toBeNull();
  });

  it("converts turnover into days at the days-per-year in force", () => {
    expect(ratioValue(computed(), "inventoryDays", "2024") ?? Number.NaN).toBeCloseTo(71.98, 1);
    expect(ratioValue(computed(), "receivableDays", "2024") ?? Number.NaN).toBeCloseTo(56.02, 1);
  });
});

describe("bands and trends", () => {
  it("bands the 2024 readings against the documented rules of thumb", () => {
    const table = ratioBandTable();
    const values = computed().byPeriod[1]?.values ?? {};
    expect(bandForMetric("currentRatio", values.currentRatio ?? null, table)).toBe("healthy");
    expect(bandForMetric("cashRatio", values.cashRatio ?? null, table)).toBe("watch");
    expect(bandForMetric("debtToEquityTotal", values.debtToEquityTotal ?? null, table)).toBe("watch");
    expect(bandForMetric("debtToEquityInterestBearing", values.debtToEquityInterestBearing ?? null, table)).toBe(
      "healthy",
    );
    expect(bandForMetric("dscrEbitda", values.dscrEbitda ?? null, table)).toBe("healthy");
  });

  it("lets the reader move a threshold and move the band with it", () => {
    const table = ratioBandTable([{ metric: "currentRatio", healthy: 2, watch: 1.8 }]);
    expect(bandForMetric("currentRatio", 1.6009, table)).toBe("risk");
  });

  it("reads a lower-is-better metric the other way round", () => {
    const table = ratioBandTable();
    expect(bandForMetric("debtToEquityTotal", 0.4, table)).toBe("healthy");
    expect(bandForMetric("debtToEquityTotal", 2.5, table)).toBe("risk");
  });

  it("calls a move better or worse by the metric's own direction", () => {
    expect(trendOf(1.6009, 1.5825, "higher-better")).toMatchObject({ direction: "up", verdict: "better" });
    expect(trendOf(1.3, 1.1, "lower-better")).toMatchObject({ direction: "up", verdict: "worse" });
    expect(trendOf(1.6009, 1.6, "higher-better")).toMatchObject({ direction: "flat", verdict: "same" });
    expect(trendOf(1.6, null, "higher-better")).toMatchObject({ direction: "flat", delta: null, verdict: null });
  });

  it("gives no band at all to a ratio no convention covers", () => {
    expect(bandForMetric("assetTurnover", 1.37)).toBeNull();
  });
});

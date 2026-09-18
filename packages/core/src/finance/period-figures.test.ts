import { describe, expect, it } from "vitest";
import { computeFinance } from "./metrics";
import { aggregateBases, figuresForPeriod, figuresFrom, periodBase } from "./period-figures";
import { categoryFor, conventionTotal, roleOf } from "./line-item-normalise";
import { fiscalYearGroups, monthsInGroup, monthsInPeriod, parsePeriod } from "./fiscal-periods";
import { burnBasisMonths, burnReadings } from "./trend-metrics";
import type { LineItem } from "./types";

function row(label: string, period: string, amount: number, category: LineItem["category"]): LineItem {
  return { label, period, amount, currency: "IDR", category };
}

/** The Indonesian statement the eval case is built from, detail rows only. */
const LABA_RUGI: LineItem[] = [
  row("Penjualan Produk Beku", "2024", 6_900_000_000, "revenue"),
  row("Penjualan Katering Korporat", "2024", 3_120_000_000, "revenue"),
  row("Retur & Potongan Penjualan", "2024", -245_000_000, "revenue"),
  row("Bahan Baku", "2024", 3_980_000_000, "cogs"),
  row("Tenaga Kerja Langsung", "2024", 965_000_000, "cogs"),
  row("Overhead Pabrik", "2024", 512_000_000, "cogs"),
  row("Gaji & Tunjangan", "2024", 1_560_000_000, "opex"),
  row("Sewa & Utilitas", "2024", 372_000_000, "opex"),
  row("Pemasaran", "2024", 410_000_000, "opex"),
  row("Transportasi & Distribusi", "2024", 263_000_000, "opex"),
  row("Penyusutan", "2024", 168_000_000, "opex"),
  row("Administrasi & Umum", "2024", 134_000_000, "opex"),
  row("Beban Bunga Pinjaman", "2024", -128_000_000, "other"),
  row("Pendapatan Lain-lain", "2024", 31_000_000, "other"),
  row("Beban Pajak Penghasilan (22%)", "2024", -289_080_000, "other"),
  row("Saldo Kas & Setara Kas", "2024", 1_180_000_000, "cash"),
  row("Rata-rata Burn Kas Bulanan Program Ekspansi", "2024", 152_000_000, "other"),
];

describe("roles and categories", () => {
  it("keeps tax, interest and other income out of the operating lines", () => {
    expect(roleOf("Beban Pajak Penghasilan (22%)")).toBe("tax");
    expect(roleOf("Beban Bunga Pinjaman")).toBe("interest_expense");
    expect(roleOf("Pendapatan Lain-lain")).toBe("other_income");
    expect(categoryFor("Beban Pajak Penghasilan (22%)")).toBe("other");
    expect(categoryFor("Beban Bunga Pinjaman")).toBe("other");
  });

  it("files a contra-revenue row inside revenue and a burn row outside cash", () => {
    expect(roleOf("Retur & Potongan Penjualan")).toBe("contra_revenue");
    expect(categoryFor("Retur & Potongan Penjualan")).toBe("revenue");
    expect(categoryFor("Rata-rata Burn Kas Bulanan Program Ekspansi")).toBe("other");
  });

  it("reads a section path from the inside out", () => {
    expect(categoryFor("Penyusutan", "LABA RUGI / BEBAN USAHA")).toBe("opex");
    // "HARGA POKOK PENJUALAN" contains "PENJUALAN"; the cost reading has to win.
    expect(categoryFor("Bahan Baku", "HARGA POKOK PENJUALAN")).toBe("cogs");
    expect(categoryFor("Cash & Equivalents", "Revenue / Cash")).toBe("cash");
  });

  it("turns a consistently negative column into magnitudes and leaves a mixed one alone", () => {
    expect(conventionTotal([-100, -200])).toBe(300);
    expect(conventionTotal([500, -100])).toBe(400);
    expect(conventionTotal([])).toBeNull();
  });
});

describe("the profit ladder", () => {
  const figures = figuresForPeriod(LABA_RUGI, "2024");

  it("separates operating profit from net profit after tax", () => {
    expect(figures.revenue).toBe(9_775_000_000);
    expect(figures.cogs).toBe(5_457_000_000);
    expect(figures.grossProfit).toBe(4_318_000_000);
    expect(figures.opex).toBe(2_907_000_000);
    expect(figures.operatingProfit).toBe(1_411_000_000);
    expect(figures.interestExpense).toBe(128_000_000);
    expect(figures.otherIncome).toBe(31_000_000);
    expect(figures.pretaxProfit).toBe(1_314_000_000);
    expect(figures.taxExpense).toBe(289_080_000);
    expect(figures.netProfitAfterTax).toBe(1_024_920_000);
    expect(figures.netProfit).toBe(1_024_920_000);
  });

  it("states both margins, and the cost ratio, from those two different profits", () => {
    expect(figures.grossMarginPct).toBeCloseTo(44.1739, 3);
    expect(figures.operatingMarginPct).toBeCloseTo(14.4348, 3);
    expect(figures.netMarginPct).toBeCloseTo(10.4851, 3);
    expect(figures.cogsRatioPct).toBeCloseTo(55.8261, 3);
  });
});

describe("fiscal years", () => {
  it("groups quarters into their year and leaves an already-annual sheet alone", () => {
    expect(fiscalYearGroups(["Q1 2023", "Q2 2023", "Q1 2024"])).toEqual([
      { label: "FY2023", periods: ["Q1 2023", "Q2 2023"] },
    ]);
    expect(fiscalYearGroups(["2023", "2024"])).toEqual([]);
    expect(parsePeriod("Q4 2024")).toEqual({ year: 2024, quarter: 4, month: null });
    expect(monthsInPeriod("Q4 2024")).toBe(3);
    expect(monthsInPeriod("2024")).toBe(12);
    expect(monthsInGroup({ label: "FY2024", periods: ["Q1 2024", "Q2 2024"] })).toBe(6);
  });

  it("sums the flows and takes the last balance when it rolls a year up", () => {
    const quarters = ["Q1 2024", "Q2 2024"].map((period) =>
      periodBase([
        row("Revenue", period, 100, "revenue"),
        row("Cash", period, period === "Q1 2024" ? 900 : 800, "cash"),
      ]),
    );
    const year = figuresFrom(aggregateBases(quarters));
    expect(year.revenue).toBe(200);
    expect(year.cash).toBe(800);
  });
});

describe("burn and runway", () => {
  it("reads how many months a burn line covers from its own words", () => {
    expect(burnBasisMonths("Rata-rata Burn Kas Bulanan Program Ekspansi", "2024")).toBe(1);
    expect(burnBasisMonths("Net Quarterly Burn", "Q4 2024")).toBe(3);
    expect(burnBasisMonths("Net Burn", "Q4 2024")).toBe(3);
    expect(burnReadings(LABA_RUGI)).toEqual([{ period: "2024", amount: 152_000_000, months: 1 }]);
  });

  it("reports runway on the stated monthly burn, not on the period the row sits in", () => {
    const byKey = new Map(computeFinance(LABA_RUGI).metrics.map((metric) => [metric.key, metric.value]));
    expect(byKey.get("monthly_burn")).toBe(152_000_000);
    expect(byKey.get("runway")).toBeCloseTo(7.7632, 3);
    expect(byKey.get("cash 2024")).toBe(1_180_000_000);
  });
});

describe("computeFinance keeps the totals out of the sums", () => {
  it("ignores a subtotal row that reaches it anyway", () => {
    const withTotal: LineItem[] = [
      row("Penjualan Produk Beku", "2024", 6_900_000_000, "revenue"),
      row("Penjualan Katering Korporat", "2024", 3_120_000_000, "revenue"),
      { ...row("Pendapatan Bersih", "2024", 10_020_000_000, "revenue"), derived: true },
    ];
    const byKey = new Map(computeFinance(withTotal).metrics.map((metric) => [metric.key, metric.value]));
    expect(byKey.get("revenue 2024")).toBe(10_020_000_000);
    const checks = computeFinance(withTotal).checks;
    expect(checks).toEqual([
      {
        label: "Pendapatan Bersih",
        period: "2024",
        stated: 10_020_000_000,
        computed: 10_020_000_000,
        matches: true,
      },
    ]);
  });

  it("flags a stated total our own arithmetic disagrees with", () => {
    const wrong: LineItem[] = [
      row("Penjualan", "2024", 1000, "revenue"),
      row("Jasa", "2024", 500, "revenue"),
      { ...row("Pendapatan Bersih", "2024", 9999, "revenue"), derived: true },
    ];
    expect(computeFinance(wrong).checks[0]?.matches).toBe(false);
  });
});

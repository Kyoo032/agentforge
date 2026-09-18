import { describe, expect, it } from "vitest";
import { classifyRatioRows, type RatioRowInput } from "./classify";
import { computeRatios, ratioValue } from "./compute";
import { readRatioRows } from "./read-figures";
import { ratioReport } from "./report";
import { ratioStatedKeyFor, statedTotalsFor } from "./stated";
import { manufakturRows, manufakturStated } from "./__fixtures__/manufaktur";

/**
 * The exact shape the live pipeline hands this task: two sheets joined into one figures text, the
 * importer's `[SECTION]` paths and `[subtotal]` tags intact — and the 2024 cost of sales, which the
 * sheet typed as the accounting negative `(23.960.000.000)`, rewritten as `[phone])` by the privacy
 * guard before the reader ever saw it. Copied inline; nothing here reads the eval corpus.
 */
const REDACTED_FIGURES = `Sheet: Laba Rugi
Keterangan | 2023 | 2024
Penjualan Bersih | 28400000000 | 33750000000
Harga Pokok Penjualan | -20450000000 | [phone])
[subtotal] LABA KOTOR | Rp 7950000000 | Rp 9790000000
[BEBAN USAHA] Beban Penjualan | 2180000000 | 2540000000
[BEBAN USAHA] Beban Umum dan Administrasi | 2935000000 | 3410000000
[subtotal] [BEBAN USAHA] Jumlah Beban Usaha | Rp 5115000000 | Rp 5950000000
[subtotal] [BEBAN USAHA] LABA USAHA (EBIT) | Rp 2835000000 | Rp 3840000000
[PENDAPATAN (BEBAN) LAIN-LAIN] Beban Bunga | -742000000 | -816000000
[PENDAPATAN (BEBAN) LAIN-LAIN] Pendapatan (Beban) Lain-lain Neto | 95000000 | -48000000
[subtotal] [PENDAPATAN (BEBAN) LAIN-LAIN] LABA SEBELUM PAJAK | Rp 2188000000 | Rp 2976000000
[PENDAPATAN (BEBAN) LAIN-LAIN] Beban Pajak Penghasilan (22%) | -481360000 | -654720000
[subtotal] [PENDAPATAN (BEBAN) LAIN-LAIN] LABA BERSIH | Rp 1706640000 | Rp 2321280000
[PENDAPATAN (BEBAN) LAIN-LAIN / DATA PENDUKUNG (bukan bagian laba rugi)] Beban Penyusutan dan Amortisasi | 680000000 | 750000000
[PENDAPATAN (BEBAN) LAIN-LAIN / DATA PENDUKUNG (bukan bagian laba rugi)] Pembayaran Pokok Pinjaman | 850000000 | 1050000000`;

function fromRedactedText() {
  const read = readRatioRows(REDACTED_FIGURES);
  return computeRatios(classifyRatioRows(read.rows), {
    stated: read.subtotals.map((row) => ({ label: row.label, period: row.period ?? "", amount: row.amount })),
    locale: "id",
  });
}

function withStated(extra: readonly RatioRowInput[] = []) {
  return computeRatios(classifyRatioRows([...manufakturRows(), ...extra]), {
    daysPerYear: 365,
    stated: manufakturStated(),
    locale: "id",
  });
}

describe("printed subtotals, read back", () => {
  it.each([
    ["Jumlah Aset Lancar", "currentAssets"],
    ["Jumlah Aset Tidak Lancar", "nonCurrentAssets"],
    ["JUMLAH ASET", "totalAssets"],
    ["Jumlah Liabilitas Jangka Pendek", "currentLiabilities"],
    ["Jumlah Liabilitas Jangka Panjang", "nonCurrentLiabilities"],
    ["JUMLAH LIABILITAS", "totalLiabilities"],
    ["JUMLAH EKUITAS", "totalEquity"],
    ["LABA KOTOR", "grossProfit"],
    ["Jumlah Beban Usaha", "opex"],
    ["LABA USAHA (EBIT)", "ebit"],
    ["LABA SEBELUM PAJAK", "profitBeforeTax"],
    ["LABA BERSIH", "netProfit"],
  ])("reads %s as %s", (label, key) => {
    expect(ratioStatedKeyFor(label)).toBe(key);
  });

  it("refuses to read the balance-sheet footing as the liabilities total", () => {
    expect(ratioStatedKeyFor("JUMLAH LIABILITAS DAN EKUITAS")).toBeNull();
  });

  it("keeps each period's printed totals to itself", () => {
    const totals = statedTotalsFor(manufakturStated(), "2024");
    expect(totals.ebit).toBe(3_840_000_000);
    expect(totals.grossProfit).toBe(9_790_000_000);
    expect(statedTotalsFor(manufakturStated(), "2023").ebit).toBe(2_835_000_000);
  });
});

describe("a cost of sales the privacy guard ate", () => {
  it("would otherwise make gross margin 100 % and EBIT the whole of revenue", () => {
    const blind = computeRatios(classifyRatioRows(readRatioRows(REDACTED_FIGURES).rows));
    expect(ratioValue(blind, "cogs", "2024")).toBeNull();
    expect(ratioValue(blind, "ebit", "2024")).toBe(27_800_000_000);
    expect(ratioValue(blind, "grossMarginPct", "2024")).toBe(100);
  });

  it("is rebuilt from the printed LABA KOTOR, and every figure downstream lands", () => {
    const computed = fromRedactedText();
    expect(ratioValue(computed, "cogs", "2024")).toBe(23_960_000_000);
    expect(ratioValue(computed, "grossProfit", "2024")).toBe(9_790_000_000);
    expect(ratioValue(computed, "ebit", "2024")).toBe(3_840_000_000);
    expect(ratioValue(computed, "ebitda", "2024")).toBe(4_590_000_000);
    expect(ratioValue(computed, "netProfit", "2024")).toBe(2_321_280_000);
    expect(ratioValue(computed, "interestCoverage", "2024") ?? Number.NaN).toBeCloseTo(4.7059, 4);
    expect(ratioValue(computed, "dscrEbitda", "2024") ?? Number.NaN).toBeCloseTo(2.4598, 4);
    expect(ratioValue(computed, "dscrEbit", "2024") ?? Number.NaN).toBeCloseTo(2.0579, 4);
    expect(ratioValue(computed, "grossMarginPct", "2024") ?? Number.NaN).toBeCloseTo(29.0074, 4);
  });

  it("adds the rebuilt bucket as a row, written the way the sheet writes its costs", () => {
    const computed = fromRedactedText();
    const added = computed.rows.filter((row) => row.source === "reconciled");
    expect(added).toHaveLength(1);
    expect(added[0]?.bucket).toBe("cogs");
    expect(added[0]?.amount).toBe(-23_960_000_000);
    expect(added[0]?.label).toBe("Harga pokok penjualan (diturunkan dari Laba kotor)");
    expect(added[0]?.reason).toBe("stated:grossProfit");
  });

  it("says so on the report rather than quietly getting it right", () => {
    const computed = fromRedactedText();
    expect(computed.repairs).toEqual([{ key: "cogs", period: "2024", amount: 23_960_000_000, from: "grossProfit" }]);
    const report = ratioReport(computed, { title: "Kartu skor", sections: [], assumptions: [] }, { locale: "id" });
    const flag = report.flags.find((entry) => entry.text.includes("Harga pokok penjualan"));
    expect(flag?.level).toBe("watch");
    expect(flag?.text).toContain("diturunkan dari subtotal tercetak Laba kotor");
  });

  it("leaves 2023, whose own row was readable, completely alone", () => {
    const computed = fromRedactedText();
    expect(ratioValue(computed, "cogs", "2023")).toBe(20_450_000_000);
    expect(ratioValue(computed, "ebit", "2023")).toBe(2_835_000_000);
    expect(computed.repairs.some((entry) => entry.period === "2023")).toBe(false);
  });
});

describe("rows against the totals printed beside them", () => {
  it("finds nothing to say when the statement adds up", () => {
    const computed = withStated();
    expect(computed.repairs).toEqual([]);
    expect(computed.mismatches).toEqual([]);
  });

  it("never rewrites a bucket the sheet did print rows for", () => {
    // The printed EBIT is a billion out; the rows are what the maths reads, and the report says so.
    const computed = computeRatios(classifyRatioRows(manufakturRows()), {
      stated: [{ label: "LABA USAHA (EBIT)", period: "2024", amount: 2_840_000_000 }],
    });
    expect(ratioValue(computed, "ebit", "2024")).toBe(3_840_000_000);
    expect(computed.mismatches).toEqual([
      { key: "ebit", period: "2024", derived: 3_840_000_000, stated: 2_840_000_000 },
    ]);
    const report = ratioReport(computed, { title: "Scorecard", sections: [], assumptions: [] }, { locale: "en" });
    expect(report.flags.some((entry) => entry.level === "risk" && /does not equal/.test(entry.text))).toBe(true);
  });

  it("changes nothing at all when no subtotal was printed", () => {
    const bare = computeRatios(classifyRatioRows(manufakturRows()), { daysPerYear: 365 });
    expect(bare.repairs).toEqual([]);
    expect(bare.mismatches).toEqual([]);
    expect(ratioValue(bare, "ebit", "2024")).toBe(3_840_000_000);
  });
});

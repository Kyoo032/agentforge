import { describe, expect, it } from "vitest";
import {
  dropDerivedLineItems,
  isDerivedName,
  isResultName,
  isTotalName,
  markDerivedLineItems,
  splitDerivedLineItems,
  withDerivedFlags,
} from "./derived-rows";
import type { LineItem } from "./types";

function row(label: string, period: string, amount: number, category: LineItem["category"] = "other"): LineItem {
  return { label, period, amount, currency: "", category };
}

describe("name tests", () => {
  it("reads a total prefix in both languages", () => {
    expect(isTotalName("Jumlah Beban Usaha")).toBe(true);
    expect(isTotalName("Total Revenue")).toBe(true);
    expect(isTotalName("Sub-total kas")).toBe(true);
    expect(isTotalName("Grand Total")).toBe(true);
    expect(isTotalName("Penjualan Produk Beku")).toBe(false);
  });

  it("reads a named result that is not a plain sum", () => {
    expect(isResultName("LABA KOTOR")).toBe(true);
    expect(isResultName("Gross Profit")).toBe(true);
    expect(isResultName("Operating Income (Loss)")).toBe(true);
    expect(isResultName("Pendapatan Bersih")).toBe(true);
    expect(isResultName("LABA SEBELUM PAJAK")).toBe(true);
    expect(isResultName("EBITDA")).toBe(true);
    expect(isResultName("Arus Kas Bersih")).toBe(true);
    expect(isResultName("Saldo Akhir")).toBe(true);
  });

  it("leaves a burn row and an ordinary expense alone", () => {
    expect(isDerivedName("Net Quarterly Burn")).toBe(false);
    expect(isDerivedName("Rata-rata Burn Kas Bulanan Program Ekspansi")).toBe(false);
    expect(isDerivedName("Pendapatan Lain-lain")).toBe(false);
    expect(isDerivedName("Cash & Equivalents, End of Quarter")).toBe(false);
  });
});

describe("markDerivedLineItems", () => {
  it("marks a subtotal that equals the rows above it, in every period", () => {
    const items = [
      row("Bahan Baku", "2023", 3_120_000_000),
      row("Bahan Baku", "2024", 3_980_000_000),
      row("Tenaga Kerja Langsung", "2023", 780_000_000),
      row("Tenaga Kerja Langsung", "2024", 965_000_000),
      row("Overhead Pabrik", "2023", 415_000_000),
      row("Overhead Pabrik", "2024", 512_000_000),
      row("Jumlah Harga Pokok Penjualan", "2023", 4_315_000_000),
      row("Jumlah Harga Pokok Penjualan", "2024", 5_457_000_000),
    ];
    const flags = markDerivedLineItems(items);
    expect(flags.slice(0, 6)).toEqual([false, false, false, false, false, false]);
    expect(flags.slice(6)).toEqual([true, true]);
  });

  it("marks a contra-revenue block's net line and keeps the detail rows", () => {
    const items = [
      row("Penjualan Produk Beku", "2023", 5_400_000_000),
      row("Penjualan Katering Korporat", "2023", 2_350_000_000),
      row("Retur & Potongan Penjualan", "2023", -180_000_000),
      row("Pendapatan Bersih", "2023", 7_570_000_000),
    ];
    expect(markDerivedLineItems(items)).toEqual([false, false, false, true]);
  });

  it("marks a named result the arithmetic cannot reach", () => {
    const items = [
      row("Total Revenue", "Q4 2024", 3_937_000),
      row("Total Cost of Revenue", "Q4 2024", 972_000),
      row("Gross Profit", "Q4 2024", 2_965_000),
    ];
    // The first two are totals by name with nothing above them to total, so only
    // "Gross Profit" - a named result - is derived here.
    expect(markDerivedLineItems(items)).toEqual([false, false, true]);
  });

  it("follows a total of totals", () => {
    const items = [
      row("Kas", "2024", 100),
      row("Piutang", "2024", 200),
      row("Jumlah Aset Lancar", "2024", 300),
      row("Tanah", "2024", 400),
      row("Bangunan", "2024", 500),
      row("Jumlah Aset Tetap", "2024", 900),
      row("JUMLAH ASET", "2024", 1_200),
    ];
    expect(markDerivedLineItems(items)).toEqual([false, false, true, false, false, true, true]);
  });

  it("does not take a count row called 'Jumlah Karyawan' for a total", () => {
    const items = [
      row("Jumlah Karyawan Tetap (orang)", "2024", 46),
      row("Jumlah Karyawan Harian (orang)", "2024", 29),
      row("Jumlah Gerai Mitra (outlet)", "2024", 18),
      row("Unit Produk Terjual (pcs)", "2024", 528_000),
    ];
    expect(markDerivedLineItems(items)).toEqual([false, false, false, false]);
  });

  it("honours an importer tag unless the arithmetic contradicts it", () => {
    const items = [
      row("Karyawan Tetap", "2024", 46),
      row("Karyawan Harian", "2024", 29),
      row("Jumlah Gerai", "2024", 18),
    ];
    expect(markDerivedLineItems(items, { tagged: [false, false, true] })).toEqual([false, false, false]);
    const totals = [row("A", "2024", 10), row("B", "2024", 20), row("Jumlah", "2024", 30)];
    expect(markDerivedLineItems(totals, { tagged: [false, false, true] })).toEqual([false, false, true]);
  });

  it("keeps an importer tag on a total whose parts are no longer in the list", () => {
    // A register folds a second block's rows onto its entities, so the total that block printed has
    // nothing above it here — but the importer saw the rows it summed.
    const items = [
      row("Karyawan 1", "Oktober 2024", 9_775_000),
      row("Karyawan 2", "Oktober 2024", 13_800_000),
      row("TOTAL GAJI", "Oktober 2024", 23_575_000),
      row("TOTAL REIMBURSEMENT", "Oktober 2024", 4_710_000),
    ];
    expect(markDerivedLineItems(items, { tagged: [false, false, true, true] })).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("tolerates rounding inside half a percent", () => {
    const items = [row("A", "2024", 1_000_000), row("B", "2024", 2_000_000), row("Total", "2024", 3_000_400)];
    expect(markDerivedLineItems(items)).toEqual([false, false, true]);
  });
});

describe("splitting", () => {
  const items = [row("Bahan Baku", "2024", 10), row("Overhead", "2024", 20), row("Jumlah HPP", "2024", 30)];

  it("keeps derived rows beside the items instead of losing them", () => {
    const split = splitDerivedLineItems(items);
    expect(split.items.map((item) => item.label)).toEqual(["Bahan Baku", "Overhead"]);
    expect(split.derived.map((item) => item.label)).toEqual(["Jumlah HPP"]);
    expect(split.derived[0]?.derived).toBe(true);
  });

  it("drops them from the summable list", () => {
    expect(dropDerivedLineItems(items)).toHaveLength(2);
  });

  it("drops a row that already carries the flag, without re-deciding", () => {
    const flagged = [row("A", "2024", 5), { ...row("Anything", "2024", 999), derived: true }];
    expect(dropDerivedLineItems(flagged).map((item) => item.label)).toEqual(["A"]);
  });

  it("tags in place for the confirm step", () => {
    expect(withDerivedFlags(items).map((item) => item.derived === true)).toEqual([false, false, true]);
  });
});

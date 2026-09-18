import { describe, expect, it } from "vitest";
import { readFiguresText } from "./figures-text";
import { lineItemsFromRows } from "./figures-rows";

const WIDE = [
  "Sheet: Laba Rugi",
  "Keterangan | 2023 | 2024 | Catatan",
  "[PENDAPATAN USAHA] Penjualan Produk Beku | 5400000000 | 6900000000 | ",
  "[PENDAPATAN USAHA] Retur & Potongan Penjualan | -180000000 | -245000000 | pengurang pendapatan",
  "[subtotal] [PENDAPATAN USAHA] Pendapatan Bersih | Rp 5220000000 | Rp 6655000000 | ",
  "[HARGA POKOK PENJUALAN] Bahan Baku | 3120000000 | 3980000000 | ",
  "Note: Catatan: retur disajikan sebagai pengurang pendapatan.",
].join("\n");

describe("readFiguresText", () => {
  it("reads a wide table one figure per period, keeping the sign and the currency", () => {
    const read = readFiguresText(WIDE);
    expect(read.deterministic).toBe(true);
    expect(read.rows).toHaveLength(8);
    const retur = read.rows.filter((row) => row.label === "Retur & Potongan Penjualan");
    expect(retur.map((row) => [row.period, row.amount])).toEqual([
      ["2023", -180_000_000],
      ["2024", -245_000_000],
    ]);
    const net = read.rows.find((row) => row.label === "Pendapatan Bersih");
    expect(net?.derived).toBe(true);
    expect(net?.currency).toBe("IDR");
    expect(net?.section).toBe("PENDAPATAN USAHA");
    expect(read.notes[0]).toContain("pengurang pendapatan");
  });

  it("never mistakes a body row for the next table's header", () => {
    // "190000" reads as a 1900 year label; a header is the line with no amounts in it.
    const read = readFiguresText(["Label | Q1 2024 | Q2 2024", "Support | 190000 | 199000"].join("\n"));
    expect(read.rows.map((row) => [row.period, row.amount])).toEqual([
      ["Q1 2024", 190_000],
      ["Q2 2024", 199_000],
    ]);
  });

  it("starts a new block at the next header, so a second table keeps its own periods", () => {
    const read = readFiguresText(
      [
        "Sheet: Laba Rugi",
        "Keterangan | 2024",
        "Pendapatan | 1000",
        "Sheet: Operasional",
        "Keterangan | 2023 | 2024",
        "Unit Produk Terjual (pcs) | 412000 | 528000",
      ].join("\n"),
    );
    expect(read.rows.map((row) => [row.label, row.period, row.amount])).toEqual([
      ["Pendapatan", "2024", 1000],
      ["Unit Produk Terjual (pcs)", "2023", 412_000],
      ["Unit Produk Terjual (pcs)", "2024", 528_000],
    ]);
  });

  it("reads the compact period=value form", () => {
    const read = readFiguresText("Sewa | Jan=1200 | Feb=1250");
    expect(read.rows.map((row) => [row.period, row.amount])).toEqual([
      ["Jan", 1200],
      ["Feb", 1250],
    ]);
  });

  it("reads the narrow form and lifts the sheet's own facts out of the head", () => {
    const read = readFiguresText(
      ["Sheet: Kas", "Saldo awal (1 Jan 2024): 45000000", "Keterangan | Jan", "Sewa (Jan): 1200"].join("\n"),
    );
    expect(read.facts).toEqual([{ label: "Saldo awal", value: 45_000_000, currency: "" }]);
    expect(read.rows.map((row) => [row.label, row.period, row.amount])).toEqual([
      ["Saldo awal", "Jan 2024", 45_000_000],
      ["Sewa", "Jan", 1200],
    ]);
  });

  it("says so when there is no table in the text", () => {
    expect(readFiguresText("We grew a lot last year and hired two people.").deterministic).toBe(false);
  });
});

describe("lineItemsFromRows", () => {
  it("splits the totals out and files every row by its section", () => {
    const { items, derived, unclassified } = lineItemsFromRows(readFiguresText(WIDE).rows);
    expect(derived.map((item) => item.label)).toEqual(["Pendapatan Bersih", "Pendapatan Bersih"]);
    expect(items.filter((item) => item.label === "Bahan Baku").every((item) => item.category === "cogs")).toBe(true);
    expect(
      items.filter((item) => item.label.startsWith("Penjualan")).every((item) => item.category === "revenue"),
    ).toBe(true);
    // Contra-revenue stays inside revenue, with its sign, so the sum is the net figure.
    expect(items.find((item) => item.label.startsWith("Retur"))?.category).toBe("revenue");
    expect(unclassified).toEqual([]);
  });

  it("takes a subtotal's own category down to the rows it adds up", () => {
    const rows = readFiguresText(
      [
        "Line Item | Q1 2024",
        "Hosting & Infrastructure | 268000",
        "Third-party Data Licenses | 58000",
        "[subtotal] Total Cost of Revenue | 326000",
      ].join("\n"),
    ).rows;
    const { items } = lineItemsFromRows(rows);
    expect(items.map((item) => item.category)).toEqual(["cogs", "cogs"]);
  });

  it("offers the labels no dictionary places to the model, by id and without amounts", () => {
    const rows = readFiguresText(["Line Item | Q1 2024", "Widget wrangling | 1000"].join("\n")).rows;
    const first = lineItemsFromRows(rows);
    expect(first.unclassified.map((entry) => entry.label)).toEqual(["Widget wrangling"]);
    const answered = lineItemsFromRows(rows, { categories: new Map([[first.unclassified[0]?.id ?? "", "opex"]]) });
    expect(answered.items[0]).toMatchObject({ label: "Widget wrangling", amount: 1000, category: "opex" });
  });
});

describe("a register row's own columns", () => {
  const text = [
    "Sheet: Gaji",
    "Karyawan 1 (Oktober 2024): 9775000 {Gaji Pokok=8500000; Tunjangan=1700000; Potongan BPJS=425000; Gaji Bersih=9775000; +Reimbursement Oktober 2024=1250000}",
    "Karyawan 2 (Oktober 2024): 13800000 {Gaji Pokok=12000000; Tunjangan=2400000; Potongan BPJS=600000; Gaji Bersih=13800000}",
  ].join("\n");

  it("reads the row as one figure, with its columns beside it and not as figures of their own", () => {
    const read = readFiguresText(text);
    expect(read.deterministic).toBe(true);
    expect(read.rows).toHaveLength(2);
    expect(read.rows[0]).toMatchObject({ label: "Karyawan 1", period: "Oktober 2024", amount: 9_775_000 });
    expect(read.rows[0]?.columns).toEqual([
      { label: "Gaji Pokok", amount: 8_500_000 },
      { label: "Tunjangan", amount: 1_700_000 },
      { label: "Potongan BPJS", amount: 425_000 },
      { label: "Gaji Bersih", amount: 9_775_000 },
      { label: "Reimbursement Oktober 2024", amount: 1_250_000, extra: true },
    ]);
  });

  it("carries the columns through to the confirmed line items", () => {
    const { items } = lineItemsFromRows(readFiguresText(text).rows);
    expect(items).toHaveLength(2);
    expect(items[1]?.columns).toHaveLength(4);
    expect(items[1]?.amount).toBe(13_800_000);
  });
});

describe("pasted free-form lines", () => {
  /** What the owner types into the paste box, rather than what the importer writes. */
  const PASTED = [
    "Revenue 2025: Rp 1.000",
    "Pendapatan 2024 Rp 1,25 miliar",
    "COGS FY2024 $420,000",
    "Kas per 31 Des 2024: Rp 2.350.000.000",
  ].join("\n");

  it("reads a lone point group after a currency as thousands, not as a decimal", () => {
    const rows = readFiguresText("Revenue 2025: Rp 1.000").rows;
    expect(rows).toEqual([
      { label: "Revenue", period: "2025", amount: 1000, currency: "IDR", section: "", derived: false, order: 0 },
    ]);
  });

  it("takes the period out of the label, connector and day number and all", () => {
    const rows = readFiguresText(PASTED).rows;
    expect(rows.map((row) => [row.label, row.period, row.amount, row.currency])).toEqual([
      ["Revenue", "2025", 1000, "IDR"],
      ["Kas", "Des 2024", 2_350_000_000, "IDR"],
    ]);
  });

  it("reads the two lines that carry no colon once the magnitudes are expanded", () => {
    // `expandMagnitudes` runs before this reader in the parse path; here it is done by hand.
    const rows = readFiguresText("Pendapatan 2024: Rp 1250000000\nCOGS FY2024: $420,000").rows;
    expect(rows.map((row) => [row.label, row.period, row.amount, row.currency])).toEqual([
      ["Pendapatan", "2024", 1_250_000_000, "IDR"],
      ["COGS", "FY2024", 420_000, "USD"],
    ]);
  });

  it("keeps a parenthesised rate on the label instead of reading it as a period", () => {
    const rows = readFiguresText("Beban Pajak Penghasilan (22%): -289080000").rows;
    expect(rows[0]).toMatchObject({ label: "Beban Pajak Penghasilan (22%)", period: "", amount: -289_080_000 });
  });
});

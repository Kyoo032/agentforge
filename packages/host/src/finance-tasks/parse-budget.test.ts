import { describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { budgetRowsFromFiguresText, parseBudgetInput, type BudgetParseResult } from "./parse-budget";

/** The local path never reaches the gateway, so the tenant is never read on it. */
const TENANT = {} as TenantContext;

/** Exactly what the importer writes for the two-sheet Indonesian workbook, tags and all. */
const YAYASAN = `Sheet: Anggaran 2024
[Pendapatan] Donasi individu: 1850000000
[Pendapatan] Hibah korporasi: 1200000000
[Pendapatan] Pendapatan jasa pelatihan: 450000000
[Pendapatan] Pendapatan bunga bank: 25000000
[subtotal] [Pendapatan] Subtotal Pendapatan: 3525000000
[Pendapatan / Beban] Gaji & tunjangan karyawan: 1320000000
[Pendapatan / Beban] Sewa kantor: 240000000
[Pendapatan / Beban] ATK: 36000000
[Pendapatan / Beban] Cadangan dana darurat: 100000000
[subtotal] [Pendapatan / Beban] Subtotal Beban: 1696000000
[subtotal] [Pendapatan / Beban] Surplus/(Defisit) Anggaran: 1829000000

Sheet: Realisasi 2024
[Penerimaan] Penerimaan donasi perorangan: 1642500000
[Penerimaan] Dana hibah perusahaan: 1380000000
[Penerimaan] Hasil program pelatihan: 468000000
[subtotal] [Penerimaan] Jumlah Penerimaan: 3490500000
[Penerimaan / Pengeluaran] Beban gaji: 1398400000
[Penerimaan / Pengeluaran] Biaya sewa gedung: 264000000
[Penerimaan / Pengeluaran] Alat tulis kantor: 41300000
[Penerimaan / Pengeluaran] Beban penyusutan inventaris: 72000000
[subtotal] [Penerimaan / Pengeluaran] Jumlah Pengeluaran: 1775700000
[Penerimaan / Pengeluaran] Selisih Lebih/(Kurang): 1714800000`;

/** The English sheet: budget and actual as side-by-side columns under one header. */
const RETAIL = `Sheet: Budget vs Actual FY2025
Line item | Q1 Budget | Q1 Actual | Q2 Budget | Q2 Actual
[Revenue] Net sales - online store | 240000 | 281000 | 262000 | 305000
[Revenue] Shipping revenue | 50000 | 57500 | 50000 | 42500
[subtotal] [Revenue] Total revenue | 290000 | 338500 | 312000 | 347500
[Revenue / Cost of goods sold] Merchandise purchases | 300000 | 315000 | 300000 | 315000
[Revenue / Operating expenses] Rent - flagship store | 40000 | 43200 | 40000 | 43200
[subtotal] [Revenue / Operating expenses] Operating income | -50000 | -19700 | -28000 | -10700`;

async function parse(figures: string, params?: unknown): Promise<BudgetParseResult> {
  return (await parseBudgetInput(TENANT, { figures, task: "budget", params })) as BudgetParseResult;
}

describe("budget parse", () => {
  it("reads two sheets into one set of rows, with the sheet name as each row's period", async () => {
    const parsed = await parse(YAYASAN);
    expect(parsed.needsConfirmation).toBe(true);
    expect(parsed.items).toHaveLength(8 + 7);
    expect(parsed.items[0]).toEqual({
      label: "Donasi individu",
      period: "Anggaran 2024",
      amount: 1_850_000_000,
      currency: "",
      category: "revenue",
    });
    expect(parsed.items.find((item) => item.label === "Beban gaji")).toMatchObject({
      period: "Realisasi 2024",
      category: "opex",
    });
  });

  // The section path ends in the heading that matters: "Pendapatan / Beban" is spending.
  it("takes the category from the section heading rather than from the path above it", async () => {
    const parsed = await parse(YAYASAN);
    const category = (label: string): string | undefined => parsed.items.find((item) => item.label === label)?.category;
    expect(category("Hibah korporasi")).toBe("revenue");
    expect(category("Sewa kantor")).toBe("opex");
    expect(category("Merchandise purchases")).toBeUndefined();
  });

  it("keeps every total out of the rows and beside them", async () => {
    const parsed = await parse(YAYASAN);
    const labels = parsed.items.map((item) => item.label);
    expect(labels).not.toContain("Subtotal Pendapatan");
    expect(labels).not.toContain("Jumlah Pengeluaran");
    expect(labels.some((label) => label.startsWith("Selisih"))).toBe(false);
    expect(parsed.derived.map((item) => item.label)).toContain("Jumlah Pengeluaran");
  });

  it("proposes the pairing the two sheets really mean, with a reason for each pair", async () => {
    const parsed = await parse(YAYASAN);
    const pairs = new Map(parsed.pairs.map((pair) => [pair.budgetLabel, pair.actualLabel]));
    expect(pairs.get("Donasi individu")).toBe("Penerimaan donasi perorangan");
    expect(pairs.get("Sewa kantor")).toBe("Biaya sewa gedung");
    expect(pairs.get("ATK")).toBe("Alat tulis kantor");
    expect(parsed.budgetOnly).toEqual(["Pendapatan bunga bank", "Cadangan dana darurat"]);
    expect(parsed.actualOnly).toEqual(["Beban penyusutan inventaris"]);
    expect(parsed.pairs.every((pair) => pair.stage.length > 0)).toBe(true);
  });

  it("reads the side-by-side English columns as eight rows with their own scenarios", async () => {
    const parsed = await parse(RETAIL);
    expect(parsed.items).toHaveLength(4 * 4);
    expect(parsed.periods).toEqual(["Q1", "Q2"]);
    expect(parsed.items.filter((item) => item.period === "Q1 Budget")).toHaveLength(4);
    expect(parsed.items.find((item) => item.label === "Merchandise purchases")?.category).toBe("cogs");
    expect(parsed.items.map((item) => item.label)).not.toContain("Operating income");
  });

  it("pairs a sheet whose two sides carry the same label exactly", async () => {
    const parsed = await parse(RETAIL);
    expect(parsed.budgetOnly).toEqual([]);
    expect(parsed.actualOnly).toEqual([]);
    expect(parsed.pairs.every((pair) => pair.stage === "exact")).toBe(true);
  });

  // The screen has to be able to say "matched on spelling alone", so the parse has to say which.
  it("says whether the meaning stage ran", async () => {
    // Both sides fully paired by the local stages: a cosine could not change a single answer.
    expect((await parse(RETAIL)).matching.embedding).toBe("not-needed");
    // Loose ends on both sides, but no gateway in a test: the pairing stays local and says so.
    expect((await parse(YAYASAN)).matching.embedding).toBe("unavailable");
  });

  it("refuses text that holds no rows instead of answering with an empty comparison", async () => {
    await expect(parse("Sheet: Kosong\nCatatan saja, tanpa angka")).rejects.toThrow(/no budget rows/i);
    await expect(parse("")).rejects.toThrow(/figures text is required/i);
  });
});

describe("reading the figures text", () => {
  it("never lets a subtotal into the rows that will be summed", () => {
    const read = budgetRowsFromFiguresText(YAYASAN);
    expect(read.items).toHaveLength(15);
    expect(read.derived.map((item) => item.label)).toEqual([
      "Subtotal Pendapatan",
      "Subtotal Beban",
      "Surplus/(Defisit) Anggaran",
      "Jumlah Penerimaan",
      "Jumlah Pengeluaran",
      "Selisih Lebih/(Kurang)",
    ]);
  });
});

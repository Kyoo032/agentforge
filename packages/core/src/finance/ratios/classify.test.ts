import { describe, expect, it } from "vitest";
import { bucketAmount, bucketAggregates, bucketsFeeding } from "./buckets";
import {
  classifyRatioRow,
  classifyRatioRows,
  normalizeRatioLabel,
  readImportedLabel,
  unplacedRatioRows,
} from "./classify";
import { manufakturRows, manufakturSubtotals } from "./__fixtures__/manufaktur";

/** Every label in the case, and the bucket a reader would put it in. Hand-checked, not generated. */
const EXPECTED: ReadonlyArray<readonly [string, string]> = [
  ["Kas dan Setara Kas", "cash"],
  ["Piutang Usaha", "receivables"],
  ["Persediaan", "inventory"],
  ["Biaya Dibayar di Muka", "other-current-asset"],
  ["Tanah dan Bangunan", "fixed-asset"],
  ["Mesin dan Peralatan", "fixed-asset"],
  ["Akumulasi Penyusutan", "contra-asset"],
  ["Aset Tak Berwujud", "other-noncurrent-asset"],
  ["Utang Usaha", "current-liability"],
  ["Utang Bank Jangka Pendek", "short-term-debt"],
  ["Beban yang Masih Harus Dibayar", "current-liability"],
  ["Utang Pajak", "current-liability"],
  ["Bagian Lancar Utang Jangka Panjang", "current-portion-ltd"],
  ["Utang Bank Jangka Panjang", "long-term-debt"],
  ["Liabilitas Imbalan Kerja", "other-noncurrent-liability"],
  ["Modal Saham", "equity"],
  ["Tambahan Modal Disetor", "equity"],
  ["Saldo Laba", "equity"],
  ["Penjualan Bersih", "revenue"],
  ["Harga Pokok Penjualan", "cogs"],
  ["Beban Penjualan", "opex"],
  ["Beban Umum dan Administrasi", "opex"],
  ["Beban Bunga", "interest"],
  ["Pendapatan (Beban) Lain-lain Neto", "other-income"],
  ["Beban Pajak Penghasilan (22%)", "tax"],
  ["Beban Penyusutan dan Amortisasi", "depreciation"],
  ["Pembayaran Pokok Pinjaman", "principal-repayment"],
];

describe("classifyRatioRow", () => {
  it.each(EXPECTED)("places %s in %s from the label alone", (label, bucket) => {
    const answer = classifyRatioRow({ label, amount: 1 });
    expect(answer.bucket).toBe(bucket);
    expect(answer.source).toBe("label");
    expect(answer.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("reads English labels from the same dictionary", () => {
    expect(classifyRatioRow({ label: "Accumulated depreciation", amount: -1 }).bucket).toBe("contra-asset");
    expect(classifyRatioRow({ label: "Cost of goods sold", amount: -1 }).bucket).toBe("cogs");
    expect(classifyRatioRow({ label: "Current portion of long-term debt", amount: 1 }).bucket).toBe(
      "current-portion-ltd",
    );
    expect(classifyRatioRow({ label: "Trade payables", amount: 1 }).bucket).toBe("current-liability");
    expect(classifyRatioRow({ label: "Interest expense", amount: -1 }).bucket).toBe("interest");
  });

  it("never lets a bank loan be read as cash", () => {
    expect(classifyRatioRow({ label: "Utang Bank Jangka Pendek", amount: 1 }).bucket).toBe("short-term-debt");
    expect(classifyRatioRow({ label: "Kas di Bank", amount: 1 }).bucket).toBe("cash");
  });

  it("excludes a row the importer tagged as a subtotal", () => {
    const answer = classifyRatioRow({ label: "JUMLAH ASET", amount: 24_647_000_000, derived: true });
    expect(answer).toMatchObject({ bucket: "excluded", source: "derived" });
  });

  it("falls back to the section heading, then to the category, then gives up", () => {
    expect(classifyRatioRow({ label: "Pos Khusus A", section: "ASET / Aset Lancar", amount: 1 })).toMatchObject({
      bucket: "other-current-asset",
      source: "section",
    });
    expect(classifyRatioRow({ label: "Pos Khusus B", category: "equity", amount: 1 })).toMatchObject({
      bucket: "equity",
      source: "category",
    });
    expect(classifyRatioRow({ label: "Pos Khusus C", amount: 1 })).toMatchObject({
      bucket: "excluded",
      source: "unknown",
    });
  });
});

describe("classifyRatioRows", () => {
  it("classifies both years of the case without a single leftover", () => {
    const rows = classifyRatioRows(manufakturRows());
    expect(rows).toHaveLength(54);
    expect(unplacedRatioRows(rows)).toHaveLength(0);
    expect(rows.every((row) => row.source === "label")).toBe(true);
  });

  it("takes the reader's bucket over its own, for every period of that label", () => {
    const rows = classifyRatioRows(manufakturRows(), [
      { label: "Aset Tak Berwujud", period: "", bucket: "excluded", source: "override" },
    ]);
    const chosen = rows.filter((row) => row.label === "Aset Tak Berwujud");
    expect(chosen).toHaveLength(2);
    expect(chosen.every((row) => row.bucket === "excluded" && row.source === "override")).toBe(true);
  });

  it("keeps a model's answer apart from a reader's, at a lower confidence", () => {
    const rows = classifyRatioRows([{ label: "Pos Khusus", amount: 1, period: "2024" }], [
      { label: "Pos Khusus", period: "2024", bucket: "inventory", source: "model", confidence: 0.5 },
    ]);
    expect(rows[0]).toMatchObject({ bucket: "inventory", source: "model", confidence: 0.5 });
  });

  it("leaves every tagged subtotal out of every bucket", () => {
    const rows = classifyRatioRows(manufakturSubtotals());
    expect(rows.every((row) => row.bucket === "excluded")).toBe(true);
  });
});

describe("label reading", () => {
  it("splits the importer's tags off the label", () => {
    expect(readImportedLabel("[subtotal] [ASET / Aset Lancar] Jumlah Aset Lancar")).toEqual({
      label: "Jumlah Aset Lancar",
      section: "ASET / Aset Lancar",
      derived: true,
    });
    expect(readImportedLabel("Penjualan Bersih")).toEqual({ label: "Penjualan Bersih", section: "", derived: false });
  });

  it("flattens punctuation so the dictionary never has to spell it", () => {
    expect(normalizeRatioLabel("Beban Pajak Penghasilan (22%)")).toBe("beban pajak penghasilan 22");
  });
});

describe("bucket membership", () => {
  it("counts the current portion of a term loan twice, in two different piles", () => {
    expect(bucketAggregates("current-portion-ltd")).toEqual(["currentLiabilities", "interestBearingDebt"]);
    expect(bucketsFeeding("interestBearingDebt")).toEqual(["short-term-debt", "current-portion-ltd", "long-term-debt"]);
  });

  it("reads a cost as a size and a contra-asset as a deduction, however the sheet wrote it", () => {
    expect(bucketAmount("cogs", -23_960_000_000)).toBe(23_960_000_000);
    expect(bucketAmount("cogs", 23_960_000_000)).toBe(23_960_000_000);
    expect(bucketAmount("contra-asset", -4_025_000_000)).toBe(-4_025_000_000);
    expect(bucketAmount("contra-asset", 4_025_000_000)).toBe(-4_025_000_000);
    expect(bucketAmount("other-income", -48_000_000)).toBe(-48_000_000);
  });
});

import { describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { parseRatiosFigures } from "./parse-ratios";
import { parseRatiosInput } from "./parse-ratios";

const tenant: TenantContext = { organizationId: "org", workspaceId: "ws-1", userId: "local", role: "owner" };

/**
 * The figures text the spreadsheet importer writes for a two-sheet Indonesian statement — section
 * paths, `[subtotal]` tags, signed amounts and two period columns. Copied inline so this test says
 * what it is testing and never depends on the eval corpus.
 */
const NERACA = `Sheet: Neraca
Keterangan | 2023 | 2024
[ASET / Aset Lancar] Kas dan Setara Kas | 1850000000 | 2340000000
[ASET / Aset Lancar] Piutang Usaha | 4120000000 | 5180000000
[ASET / Aset Lancar] Persediaan | 3960000000 | 4725000000
[ASET / Aset Lancar] Biaya Dibayar di Muka | 285000000 | 362000000
[subtotal] [ASET / Aset Lancar] Jumlah Aset Lancar | Rp 10215000000 | Rp 12607000000
[ASET / Aset Tidak Lancar] Akumulasi Penyusutan | -3310000000 | -4025000000
[subtotal] [ASET / Aset Tidak Lancar] JUMLAH ASET | Rp 22065000000 | Rp 24647000000
[LIABILITAS DAN EKUITAS / Liabilitas Jangka Pendek] Utang Bank Jangka Pendek | 1500000000 | 1800000000
[LIABILITAS DAN EKUITAS / Liabilitas Jangka Pendek] Bagian Lancar Utang Jangka Panjang | 900000000 | 1100000000
[LIABILITAS DAN EKUITAS / Liabilitas Jangka Panjang] Utang Bank Jangka Panjang | 5400000000 | 5200000000
[LIABILITAS DAN EKUITAS / Ekuitas] Saldo Laba | 3240000000 | 4477000000
Note: Catatan: akumulasi penyusutan disajikan sebagai pengurang aset tetap.`;

const LABA_RUGI = `Sheet: Laba Rugi
Keterangan | 2023 | 2024
Penjualan Bersih | 28400000000 | 33750000000
Harga Pokok Penjualan | -20450000000 | -23960000000
[subtotal] LABA KOTOR | Rp 7950000000 | Rp 9790000000
[BEBAN USAHA] Beban Penjualan | 2180000000 | 2540000000
[PENDAPATAN (BEBAN) LAIN-LAIN] Beban Bunga | -742000000 | -816000000
[PENDAPATAN (BEBAN) LAIN-LAIN / DATA PENDUKUNG (bukan bagian laba rugi)] Pembayaran Pokok Pinjaman | 850000000 | 1050000000`;

const FIGURES = `${NERACA}\n\n${LABA_RUGI}`;

function row(parsed: Awaited<ReturnType<typeof parseRatiosFigures>>, label: string, period: string) {
  return parsed.buckets.find((entry) => entry.label === label && entry.period === period);
}

describe("parseRatiosFigures", () => {
  it("is the parser the endpoint dispatches for this task", () => {
    expect(parseRatiosInput).toBeTypeOf("function");
  });

  it("refuses a body with no figures text", async () => {
    await expect(parseRatiosFigures(tenant, {})).rejects.toThrowError(/figures text is required/);
    await expect(parseRatiosFigures(tenant, { figures: "   " })).rejects.toThrowError(/figures text is required/);
  });

  it("reads both sheets, both years, without asking a model anything", async () => {
    const parsed = await parseRatiosFigures(tenant, { figures: FIGURES });
    expect(parsed.modelAssist).toBeNull();
    expect(parsed.needsConfirmation).toBe(true);
    expect(parsed.periods).toEqual(["2023", "2024"]);
    expect(parsed.items).toHaveLength(28);
    expect(row(parsed, "Kas dan Setara Kas", "2024")?.amount).toBe(2_340_000_000);
    expect(row(parsed, "Penjualan Bersih", "2023")?.amount).toBe(28_400_000_000);
  });

  it("leaves every tagged subtotal out of the rows and counts it instead", async () => {
    const parsed = await parseRatiosFigures(tenant, { figures: FIGURES });
    expect(parsed.subtotalsIgnored).toBe(6);
    expect(parsed.items.some((item) => /jumlah|laba kotor/i.test(item.label))).toBe(false);
  });

  it("forwards those subtotals as `stated`, with their own periods and signs", async () => {
    const parsed = await parseRatiosFigures(tenant, { figures: FIGURES });
    expect(parsed.stated).toHaveLength(6);
    expect(parsed.stated).toContainEqual({ label: "LABA KOTOR", period: "2024", amount: 9_790_000_000 });
    expect(parsed.stated).toContainEqual({ label: "Jumlah Aset Lancar", period: "2023", amount: 10_215_000_000 });
    // The section path is stripped the same way it is on a leaf: a bucket name is not part of a label.
    expect(parsed.stated.every((row) => !row.label.includes("["))).toBe(true);
  });

  it("still forwards a subtotal when the cell beside it was redacted", async () => {
    // The privacy guard rewrites the accounting negative `(23.960.000.000)` as `[phone])`; the
    // printed LABA KOTOR is then the only record of the cost of sales, so it must survive the parse.
    const redacted = FIGURES.replace("| -23960000000", "| [phone])");
    const parsed = await parseRatiosFigures(tenant, { figures: redacted });
    expect(parsed.buckets.some((entry) => entry.label === "Harga Pokok Penjualan" && entry.period === "2024")).toBe(
      false,
    );
    expect(parsed.stated).toContainEqual({ label: "LABA KOTOR", period: "2024", amount: 9_790_000_000 });
  });

  it("keeps the sheet's own signs rather than tidying them", async () => {
    const parsed = await parseRatiosFigures(tenant, { figures: FIGURES });
    expect(row(parsed, "Harga Pokok Penjualan", "2024")?.amount).toBe(-23_960_000_000);
    expect(row(parsed, "Akumulasi Penyusutan", "2024")?.amount).toBe(-4_025_000_000);
    expect(row(parsed, "Beban Bunga", "2024")?.amount).toBe(-816_000_000);
  });

  it("puts the current portion of the term loan in its own bucket, not with the bank loan", async () => {
    const parsed = await parseRatiosFigures(tenant, { figures: FIGURES });
    expect(row(parsed, "Bagian Lancar Utang Jangka Panjang", "2024")?.bucket).toBe("current-portion-ltd");
    expect(row(parsed, "Utang Bank Jangka Pendek", "2024")?.bucket).toBe("short-term-debt");
    expect(row(parsed, "Utang Bank Jangka Panjang", "2024")?.bucket).toBe("long-term-debt");
  });

  it("shows the evidence behind every bucket so the owner can disagree with it by name", async () => {
    const parsed = await parseRatiosFigures(tenant, { figures: FIGURES });
    const inventory = row(parsed, "Persediaan", "2024");
    expect(inventory).toMatchObject({ bucket: "inventory", source: "label", reason: "inventory" });
    expect(inventory?.confidence ?? 0).toBeGreaterThan(0.9);
    expect(inventory?.section).toBe("ASET / Aset Lancar");
    expect(parsed.buckets.every((entry) => entry.source === "label")).toBe(true);
  });

  it("maps each bucket onto the line-item category the studio's row table speaks", async () => {
    const parsed = await parseRatiosFigures(tenant, { figures: FIGURES });
    const byLabel = new Map(parsed.items.map((item) => [`${item.label}|${item.period}`, item]));
    expect(byLabel.get("Kas dan Setara Kas|2024")?.category).toBe("asset");
    expect(byLabel.get("Akumulasi Penyusutan|2024")?.category).toBe("other");
    expect(byLabel.get("Utang Bank Jangka Pendek|2024")?.category).toBe("liability");
    expect(byLabel.get("Utang Bank Jangka Panjang|2024")?.category).toBe("debt");
    expect(byLabel.get("Saldo Laba|2024")?.category).toBe("equity");
    expect(byLabel.get("Harga Pokok Penjualan|2024")?.category).toBe("cogs");
    expect(byLabel.get("Beban Penjualan|2024")?.category).toBe("opex");
    expect(byLabel.get("Pembayaran Pokok Pinjaman|2024")?.category).toBe("other");
    expect(byLabel.get("Kas dan Setara Kas|2024")?.currency).toBe("IDR");
  });

  it("reads the narrow, pasted shape as well as the imported one", async () => {
    const parsed = await parseRatiosFigures(tenant, {
      figures: "Kas dan Setara Kas (2024): 2340000000\nUtang Usaha (2024): 3960000000\nModal Saham (2024): 5000000000",
    });
    expect(parsed.items).toHaveLength(3);
    expect(parsed.periods).toEqual(["2024"]);
    expect(row(parsed, "Modal Saham", "2024")?.bucket).toBe("equity");
  });

  it("says so rather than throwing when nothing in the text is a statement row", async () => {
    await expect(parseRatiosFigures(tenant, { figures: "there are no figures here at all" })).rejects.toMatchObject({
      status: 422,
    });
  });

  it("records the model assist it could not make instead of failing the parse", async () => {
    const parsed = await parseRatiosFigures(tenant, { figures: "Pos Rahasia Khusus (2024): 125000000" });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.buckets[0]).toMatchObject({ bucket: "excluded", source: "unknown" });
    // No gateway in a unit run, so the assist is reported as attempted and failed, never as a placement.
    expect(parsed.modelAssist).toMatchObject({ asked: 1, placed: 0 });
    expect(parsed.modelAssist?.error).toBeTruthy();
  });
});

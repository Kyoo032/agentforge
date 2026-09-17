import type { LineItem } from "../../types";

/**
 * Two small, invented grids the budget tests are checked against.
 *
 * Both are copied inline on purpose: a core test that reached into the eval folder would pass or
 * fail for reasons that live in another package. The numbers are hand-checked in the test bodies.
 */

function row(label: string, period: string, amount: number, category: LineItem["category"]): LineItem {
  return { label, period, amount, currency: "", category };
}

/** An invented foundation: two sheets, the same line worded differently on each, in rupiah. */
export const YAYASAN_ITEMS: readonly LineItem[] = Object.freeze([
  row("Donasi individu", "Anggaran 2024", 1_850_000_000, "revenue"),
  row("Hibah korporasi", "Anggaran 2024", 1_200_000_000, "revenue"),
  row("Pendapatan jasa pelatihan", "Anggaran 2024", 450_000_000, "revenue"),
  row("Pendapatan bunga bank", "Anggaran 2024", 25_000_000, "revenue"),
  row("Gaji & tunjangan karyawan", "Anggaran 2024", 1_320_000_000, "opex"),
  row("Program beasiswa", "Anggaran 2024", 900_000_000, "opex"),
  row("Sewa kantor", "Anggaran 2024", 240_000_000, "opex"),
  row("Listrik, air & internet", "Anggaran 2024", 96_000_000, "opex"),
  row("Perjalanan dinas", "Anggaran 2024", 150_000_000, "opex"),
  row("ATK", "Anggaran 2024", 36_000_000, "opex"),
  row("Biaya rapat & konsumsi", "Anggaran 2024", 24_000_000, "opex"),
  row("Cadangan dana darurat", "Anggaran 2024", 100_000_000, "opex"),
  row("Hasil program pelatihan", "Realisasi 2024", 468_000_000, "revenue"),
  row("Penerimaan donasi perorangan", "Realisasi 2024", 1_642_500_000, "revenue"),
  row("Dana hibah perusahaan", "Realisasi 2024", 1_380_000_000, "revenue"),
  row("Alat tulis kantor", "Realisasi 2024", 41_300_000, "opex"),
  row("Biaya perjalanan", "Realisasi 2024", 118_400_000, "opex"),
  row("Beban gaji", "Realisasi 2024", 1_398_400_000, "opex"),
  row("Biaya perbaikan atap kantor", "Realisasi 2024", 58_500_000, "opex"),
  row("Beban utilitas", "Realisasi 2024", 101_750_000, "opex"),
  row("Penyaluran beasiswa", "Realisasi 2024", 885_000_000, "opex"),
  row("Beban penyusutan inventaris", "Realisasi 2024", 72_000_000, "opex"),
  row("Beban konsumsi rapat", "Realisasi 2024", 27_600_000, "opex"),
  row("Biaya sewa gedung", "Realisasi 2024", 264_000_000, "opex"),
]);

export const YAYASAN_PARAMS = Object.freeze({ flagPct: 10, flagAbs: 5_000_000 });

const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const;

function quarterly(
  label: string,
  category: LineItem["category"],
  budget: readonly number[],
  actual: readonly number[],
): LineItem[] {
  return QUARTERS.flatMap((quarter, at) => [
    row(label, `${quarter} Budget`, budget[at] ?? 0, category),
    row(label, `${quarter} Actual`, actual[at] ?? 0, category),
  ]);
}

/** An invented retailer: budget and actual side by side, four quarters, the five threshold traps. */
export const RETAIL_ITEMS: readonly LineItem[] = Object.freeze([
  // Every quarter breaks both limits; the year nets to exactly zero.
  ...quarterly("Shipping revenue", "revenue", [50_000, 50_000, 50_000, 50_000], [57_500, 42_500, 57_500, 42_500]),
  // No quarter breaks the amount limit; the year does.
  ...quarterly("Bank & card processing fees", "opex", [20_000, 20_000, 20_000, 20_000], [21_800, 21_800, 21_800, 21_800]),
  // Exactly +8.00 % every quarter: the comparison is inclusive, so it is flagged.
  ...quarterly("Rent - flagship store", "opex", [40_000, 40_000, 40_000, 40_000], [43_200, 43_200, 43_200, 43_200]),
  // Dead on budget: neutral, never favourable.
  ...quarterly("Insurance", "opex", [11_000, 11_000, 11_000, 11_000], [11_000, 11_000, 11_000, 11_000]),
  // The largest dollar overspend in the grid, at 5 %: an `OR` rule would flag it, an `AND` does not.
  ...quarterly("Merchandise purchases", "cogs", [300_000, 300_000, 300_000, 300_000], [315_000, 315_000, 315_000, 315_000]),
]);

export const RETAIL_PARAMS = Object.freeze({ flagPct: 8, flagAbs: 2_000 });

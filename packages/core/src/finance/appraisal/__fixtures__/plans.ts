/**
 * The two shapes the appraisal tests are argued against, written out inline.
 *
 * They mirror the eval cases — a six-year machine purchase with a salvage year, and a ten-year
 * solar plan whose fifth year is negative — but nothing here reads that folder: a unit test that
 * depends on a case fixture stops being a statement about the maths.
 */
import type { LineItem } from "../../types";

function row(label: string, period: string, amount: number, category: LineItem["category"] = "cash"): LineItem {
  return { label, period, amount, currency: "", category };
}

/** Six years of savings net of running cost, with a salvage year. Rp, points group. */
export const MACHINE_ITEMS: readonly LineItem[] = Object.freeze([
  row("Investasi awal (mesin + instalasi)", "Tahun 0", -1_450_000_000, "asset"),
  row("Penghematan biaya & tambahan pendapatan", "Tahun 1", 345_000_000),
  row("Penghematan biaya & tambahan pendapatan", "Tahun 2", 412_000_000),
  row("Penghematan biaya & tambahan pendapatan", "Tahun 3", 470_000_000),
  row("Penghematan biaya & tambahan pendapatan", "Tahun 4", 498_000_000),
  row("Penghematan biaya & tambahan pendapatan", "Tahun 5", 492_000_000),
  row("Penghematan biaya & tambahan pendapatan", "Tahun 6", 465_000_000),
  row("Biaya operasi & perawatan", "Tahun 1", -60_000_000),
  row("Biaya operasi & perawatan", "Tahun 2", -72_000_000),
  row("Biaya operasi & perawatan", "Tahun 3", -75_000_000),
  row("Biaya operasi & perawatan", "Tahun 4", -78_000_000),
  row("Biaya operasi & perawatan", "Tahun 5", -82_000_000),
  row("Biaya operasi & perawatan", "Tahun 6", -85_000_000),
  row("Nilai sisa (salvage)", "Tahun 6", 180_000_000),
]);

export const MACHINE_NETS: readonly number[] = Object.freeze([
  -1_450_000_000, 285_000_000, 340_000_000, 395_000_000, 420_000_000, 410_000_000, 560_000_000,
]);

/** Ten years of avoided electricity, with an inverter replacement that makes Year 5 negative. */
export const SOLAR_ITEMS: readonly LineItem[] = Object.freeze([
  row("Initial investment (array, inverters, install)", "Year 0", -820_000, "asset"),
  row("Avoided grid electricity cost", "Year 1", 152_000),
  row("Avoided grid electricity cost", "Year 2", 156_000),
  row("Avoided grid electricity cost", "Year 3", 159_000),
  row("Avoided grid electricity cost", "Year 4", 163_000),
  row("Avoided grid electricity cost", "Year 5", 163_000),
  row("Avoided grid electricity cost", "Year 6", 165_000),
  row("Avoided grid electricity cost", "Year 7", 168_000),
  row("Avoided grid electricity cost", "Year 8", 171_000),
  row("Avoided grid electricity cost", "Year 9", 174_000),
  row("Avoided grid electricity cost", "Year 10", 177_000),
  row("O&M, monitoring and insurance", "Year 1", -14_000),
  row("O&M, monitoring and insurance", "Year 2", -14_000),
  row("O&M, monitoring and insurance", "Year 3", -14_000),
  row("O&M, monitoring and insurance", "Year 4", -14_000),
  row("O&M, monitoring and insurance", "Year 5", -14_000),
  row("O&M, monitoring and insurance", "Year 6", -14_000),
  row("O&M, monitoring and insurance", "Year 7", -14_000),
  row("O&M, monitoring and insurance", "Year 8", -14_000),
  row("O&M, monitoring and insurance", "Year 9", -14_000),
  row("O&M, monitoring and insurance", "Year 10", -14_000),
  row("Inverter replacement and roof works", "Year 5", -214_000),
  row("Residual value of the array", "Year 10", 45_000),
]);

export const SOLAR_NETS: readonly number[] = Object.freeze([
  -820_000, 138_000, 142_000, 145_000, 149_000, -65_000, 151_000, 154_000, 157_000, 160_000, 208_000,
]);

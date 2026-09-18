/**
 * A two-year manufacturing balance sheet and P&L, small enough to read and complete enough to break
 * every trap this task has to survive: a balance sheet that balances, a contra-asset written
 * negative, a current portion of a term loan that is both a current liability and interest-bearing
 * debt, a cost of sales written negative next to operating expenses written positive, and a
 * supporting block that feeds EBITDA and DSCR without belonging to the P&L.
 *
 * The figures are invented (PT Baja Karya Mandiri is not a real company) and are copied inline on
 * purpose: a unit test that reads the eval corpus would stop being a unit test.
 */
import type { RatioRowInput } from "../classify";
import type { RatioStatedRow } from "../stated";

type Row = readonly [label: string, section: string, y2023: number, y2024: number];

const BALANCE_SHEET: readonly Row[] = [
  ["Kas dan Setara Kas", "ASET / Aset Lancar", 1_850_000_000, 2_340_000_000],
  ["Piutang Usaha", "ASET / Aset Lancar", 4_120_000_000, 5_180_000_000],
  ["Persediaan", "ASET / Aset Lancar", 3_960_000_000, 4_725_000_000],
  ["Biaya Dibayar di Muka", "ASET / Aset Lancar", 285_000_000, 362_000_000],
  ["Tanah dan Bangunan", "ASET / Aset Tidak Lancar", 8_500_000_000, 8_500_000_000],
  ["Mesin dan Peralatan", "ASET / Aset Tidak Lancar", 6_240_000_000, 7_180_000_000],
  ["Akumulasi Penyusutan", "ASET / Aset Tidak Lancar", -3_310_000_000, -4_025_000_000],
  ["Aset Tak Berwujud", "ASET / Aset Tidak Lancar", 420_000_000, 385_000_000],
  ["Utang Usaha", "LIABILITAS DAN EKUITAS / Liabilitas Jangka Pendek", 3_280_000_000, 3_960_000_000],
  ["Utang Bank Jangka Pendek", "LIABILITAS DAN EKUITAS / Liabilitas Jangka Pendek", 1_500_000_000, 1_800_000_000],
  [
    "Beban yang Masih Harus Dibayar",
    "LIABILITAS DAN EKUITAS / Liabilitas Jangka Pendek",
    465_000_000,
    590_000_000,
  ],
  ["Utang Pajak", "LIABILITAS DAN EKUITAS / Liabilitas Jangka Pendek", 310_000_000, 425_000_000],
  [
    "Bagian Lancar Utang Jangka Panjang",
    "LIABILITAS DAN EKUITAS / Liabilitas Jangka Pendek",
    900_000_000,
    1_100_000_000,
  ],
  ["Utang Bank Jangka Panjang", "LIABILITAS DAN EKUITAS / Liabilitas Jangka Panjang", 5_400_000_000, 5_200_000_000],
  ["Liabilitas Imbalan Kerja", "LIABILITAS DAN EKUITAS / Liabilitas Jangka Panjang", 720_000_000, 845_000_000],
  ["Modal Saham", "LIABILITAS DAN EKUITAS / Ekuitas", 5_000_000_000, 5_000_000_000],
  ["Tambahan Modal Disetor", "LIABILITAS DAN EKUITAS / Ekuitas", 1_250_000_000, 1_250_000_000],
  ["Saldo Laba", "LIABILITAS DAN EKUITAS / Ekuitas", 3_240_000_000, 4_477_000_000],
];

const INCOME_STATEMENT: readonly Row[] = [
  ["Penjualan Bersih", "", 28_400_000_000, 33_750_000_000],
  ["Harga Pokok Penjualan", "", -20_450_000_000, -23_960_000_000],
  ["Beban Penjualan", "BEBAN USAHA", 2_180_000_000, 2_540_000_000],
  ["Beban Umum dan Administrasi", "BEBAN USAHA", 2_935_000_000, 3_410_000_000],
  ["Beban Bunga", "PENDAPATAN (BEBAN) LAIN-LAIN", -742_000_000, -816_000_000],
  ["Pendapatan (Beban) Lain-lain Neto", "PENDAPATAN (BEBAN) LAIN-LAIN", 95_000_000, -48_000_000],
  ["Beban Pajak Penghasilan (22%)", "PENDAPATAN (BEBAN) LAIN-LAIN", -481_360_000, -654_720_000],
  [
    "Beban Penyusutan dan Amortisasi",
    "PENDAPATAN (BEBAN) LAIN-LAIN / DATA PENDUKUNG (bukan bagian laba rugi)",
    680_000_000,
    750_000_000,
  ],
  [
    "Pembayaran Pokok Pinjaman",
    "PENDAPATAN (BEBAN) LAIN-LAIN / DATA PENDUKUNG (bukan bagian laba rugi)",
    850_000_000,
    1_050_000_000,
  ],
];

function expand(rows: readonly Row[]): RatioRowInput[] {
  return rows.flatMap(([label, section, y2023, y2024]) => [
    { label, section, period: "2023", amount: y2023, currency: "IDR" },
    { label, section, period: "2024", amount: y2024, currency: "IDR" },
  ]);
}

/** Every leaf row of both statements, both years, in the order the sheets print them. */
export function manufakturRows(): RatioRowInput[] {
  return [...expand(BALANCE_SHEET), ...expand(INCOME_STATEMENT)];
}

/**
 * Every subtotal the two sheets print, both years, as `read-figures.ts` hands them on — including
 * the balance-sheet footing, which repeats the asset total and must never be read as a figure.
 */
export function manufakturStated(): RatioStatedRow[] {
  const both = (label: string, y2023: number, y2024: number): RatioStatedRow[] => [
    { label, period: "2023", amount: y2023 },
    { label, period: "2024", amount: y2024 },
  ];
  return [
    ...both("Jumlah Aset Lancar", 10_215_000_000, 12_607_000_000),
    ...both("Jumlah Aset Tidak Lancar", 11_850_000_000, 12_040_000_000),
    ...both("JUMLAH ASET", 22_065_000_000, 24_647_000_000),
    ...both("Jumlah Liabilitas Jangka Pendek", 6_455_000_000, 7_875_000_000),
    ...both("Jumlah Liabilitas Jangka Panjang", 6_120_000_000, 6_045_000_000),
    ...both("JUMLAH LIABILITAS", 12_575_000_000, 13_920_000_000),
    ...both("JUMLAH EKUITAS", 9_490_000_000, 10_727_000_000),
    ...both("JUMLAH LIABILITAS DAN EKUITAS", 22_065_000_000, 24_647_000_000),
    ...both("LABA KOTOR", 7_950_000_000, 9_790_000_000),
    ...both("Jumlah Beban Usaha", 5_115_000_000, 5_950_000_000),
    ...both("LABA USAHA (EBIT)", 2_835_000_000, 3_840_000_000),
    ...both("LABA SEBELUM PAJAK", 2_188_000_000, 2_976_000_000),
    ...both("LABA BERSIH", 1_706_640_000, 2_321_280_000),
  ];
}

/** The subtotal rows the importer tags. Present so a test can prove they never reach a total. */
export function manufakturSubtotals(): RatioRowInput[] {
  return [
    { label: "Jumlah Aset Lancar", section: "ASET / Aset Lancar", period: "2024", amount: 12_607_000_000, derived: true },
    { label: "JUMLAH ASET", section: "ASET / Aset Tidak Lancar", period: "2024", amount: 24_647_000_000, derived: true },
    {
      label: "JUMLAH LIABILITAS",
      section: "LIABILITAS DAN EKUITAS / Liabilitas Jangka Panjang",
      period: "2024",
      amount: 13_920_000_000,
      derived: true,
    },
    { label: "LABA USAHA (EBIT)", section: "BEBAN USAHA", period: "2024", amount: 3_840_000_000, derived: true },
  ];
}

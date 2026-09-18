/**
 * brief-umkm-2y — deterministic source data plus an independent ground truth.
 *
 * Writes `input.xlsx` (two sheets, laid out the way an Indonesian bookkeeper
 * actually lays one out: merged title band, "Rp" number formats, a few figures
 * typed as TEXT in Indonesian grouping, parenthesised negatives, subtotal rows,
 * a notes row, spacer rows, a second sheet of counts) and `case.json`.
 * `truth` is computed below with plain arithmetic only; nothing from
 * packages/core/src/finance is imported, so it stays an oracle independent of
 * the engine it grades. No Date.now(), no Math.random(): every run writes the
 * same cells and the same case.json, though the .xlsx bytes differ because
 * ExcelJS stamps each zip entry with the wall clock — compare the cell grid
 * (verify.mjs prints it), never the file hash.
 *
 * All names and figures are invented; nothing here is real company data.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXED_STAMP = new Date(Date.UTC(2025, 0, 2, 3, 4, 5));

const COMPANY = "CV Terang Sentosa Boga";
const CURRENCY = "IDR";
const TAX_RATE = 0.22;
const CASH_ON_HAND = 1_180_000_000;
const MONTHLY_BURN = 152_000_000;

/** Number formats a real bookkeeper leaves on the cells; the accounting one is deliberately gnarly. */
const FMT = {
  rp: '"Rp"#,##0',
  plain: "#,##0",
  signed: "#,##0;(#,##0)",
  accounting: '_-"Rp"* #,##0_-;_-"Rp"* (#,##0)_-;_-"Rp"* "-"_-;_-@_-',
};

/** [label, 2023, 2024, note]. Amounts are full rupiah, negatives are real negatives. */
const REVENUE = [
  ["Penjualan Produk Beku", 5_400_000_000, 6_900_000_000, ""],
  ["Penjualan Katering Korporat", 2_350_000_000, 3_120_000_000, "3 kontrak korporat"],
  ["Retur & Potongan Penjualan", -180_000_000, -245_000_000, "pengurang pendapatan"],
];
const COGS = [
  ["Bahan Baku", 3_120_000_000, 3_980_000_000, ""],
  ["Tenaga Kerja Langsung", 780_000_000, 965_000_000, ""],
  ["Overhead Pabrik", 415_000_000, 512_000_000, ""],
];
const OPEX = [
  ["Gaji & Tunjangan", 1_240_000_000, 1_560_000_000, ""],
  ["Sewa & Utilitas", 336_000_000, 372_000_000, ""],
  ["Pemasaran", 285_000_000, 410_000_000, ""],
  ["Transportasi & Distribusi", 198_000_000, 263_000_000, ""],
  ["Penyusutan", 145_000_000, 168_000_000, "non-kas"],
  ["Administrasi & Umum", 112_000_000, 134_000_000, ""],
];
const OTHER = [
  ["Beban Bunga Pinjaman", -96_000_000, -128_000_000, "pinjaman investasi"],
  ["Pendapatan Lain-lain", 24_000_000, 31_000_000, ""],
];

/** Counts, not money. Sheet 2 exists so a reader can tell a headcount from a rupiah. */
const OPS = [
  ["Jumlah Karyawan Tetap (orang)", 38, 46],
  ["Jumlah Karyawan Harian (orang)", 24, 29],
  ["Jumlah Gerai Mitra (outlet)", 12, 18],
  ["Unit Produk Terjual (pcs)", 412_000, 528_000],
  ["Kapasitas Produksi (pcs/bulan)", 45_000, 58_000],
];
const AVG_PRICE = [16_800, 17_900];

const NOTE_PL =
  "Catatan: retur & potongan penjualan disajikan sebagai pengurang pendapatan, bukan sebagai beban. Angka 2023 telah direklasifikasi agar sebanding dengan 2024.";
const NOTE_CASH =
  "Catatan: burn di atas adalah pengeluaran kas bersih per bulan untuk program ekspansi lini produksi baru, di luar kas operasi berjalan.";

/** Cells a human typed as text instead of as a number. Key is `label|year`. */
const TEXT_CELLS = new Map([
  ["Overhead Pabrik|2024", "512.000.000"],
  ["Retur & Potongan Penjualan|2024", "(245.000.000)"],
  ["Pendapatan Lain-lain|2023", "24.000.000"],
  ["Pendapatan Lain-lain|2024", "31.000.000"],
]);

const YEARS = ["2023", "2024"];
const at = (row, year) => row[YEARS.indexOf(year) + 1];
const sumAt = (rows, year) => rows.reduce((total, row) => total + at(row, year), 0);
const round = (value, places) => Number(value.toFixed(places));

// ---------------------------------------------------------------- workbook

function titleBand(sheet, lines, lastColumn) {
  lines.forEach((text, index) => {
    const row = index + 1;
    sheet.mergeCells(`A${row}:${lastColumn}${row}`);
    const cell = sheet.getCell(`A${row}`);
    cell.value = text;
    cell.font = { bold: index === 0, size: index === 0 ? 13 : 11 };
    cell.alignment = { horizontal: "center" };
  });
}

/** One money cell: either the typed-in text, or a number wearing the given format. */
function moneyCell(sheet, address, label, year, value, numFmt) {
  const cell = sheet.getCell(address);
  const typed = TEXT_CELLS.get(`${label}|${year}`);
  if (typed !== undefined) {
    cell.value = typed;
    cell.alignment = { horizontal: "right" };
    return;
  }
  cell.value = value;
  cell.numFmt = numFmt;
}

function writeDataRow(sheet, rowNumber, entry, numFmt) {
  const [label, , , note] = entry;
  sheet.getCell(`A${rowNumber}`).value = `   ${label}`;
  YEARS.forEach((year, index) => {
    moneyCell(sheet, `${"BC"[index]}${rowNumber}`, label, year, at(entry, year), numFmt);
  });
  sheet.getCell(`D${rowNumber}`).value = note;
}

function writeSubtotal(sheet, rowNumber, label, values) {
  sheet.getCell(`A${rowNumber}`).value = label;
  sheet.getCell(`A${rowNumber}`).font = { bold: true };
  values.forEach((value, index) => {
    const cell = sheet.getCell(`${"BC"[index]}${rowNumber}`);
    cell.value = value;
    cell.numFmt = FMT.accounting;
    cell.font = { bold: true };
  });
}

function writeSection(sheet, rowNumber, label) {
  const cell = sheet.getCell(`A${rowNumber}`);
  cell.value = label;
  cell.font = { bold: true };
}

/** Everything the profit-and-loss sheet needs, in the order a printed report has it. */
function profitAndLossPlan(totals) {
  const blank = { kind: "blank" };
  return [
    { kind: "section", label: "PENDAPATAN USAHA" },
    ...REVENUE.map((entry) => ({ kind: "item", entry, numFmt: FMT.signed })),
    { kind: "subtotal", label: "Pendapatan Bersih", values: totals.revenue },
    blank,
    { kind: "section", label: "HARGA POKOK PENJUALAN" },
    ...COGS.map((entry) => ({ kind: "item", entry, numFmt: FMT.plain })),
    { kind: "subtotal", label: "Jumlah Harga Pokok Penjualan", values: totals.cogs },
    { kind: "subtotal", label: "LABA KOTOR", values: totals.gross },
    blank,
    { kind: "section", label: "BEBAN USAHA" },
    ...OPEX.map((entry) => ({ kind: "item", entry, numFmt: FMT.plain })),
    { kind: "subtotal", label: "Jumlah Beban Usaha", values: totals.opex },
    { kind: "subtotal", label: "LABA USAHA", values: totals.operating },
    blank,
    { kind: "section", label: "PENDAPATAN (BEBAN) LAIN-LAIN" },
    ...OTHER.map((entry) => ({ kind: "item", entry, numFmt: FMT.signed })),
    { kind: "subtotal", label: "LABA SEBELUM PAJAK", values: totals.pretax },
    { kind: "item", entry: ["Beban Pajak Penghasilan (22%)", -totals.tax[0], -totals.tax[1], ""], numFmt: FMT.signed },
    { kind: "subtotal", label: "LABA BERSIH", values: totals.net },
    blank,
    { kind: "note", label: NOTE_PL },
    blank,
    { kind: "section", label: "POSISI KAS & RENCANA EKSPANSI" },
    { kind: "cash", label: "Saldo Kas & Setara Kas per 31 Des 2024", text: "Rp 1.180.000.000" },
    { kind: "cash", label: "Rata-rata Burn Kas Bulanan Program Ekspansi", text: "Rp 152.000.000" },
    { kind: "note", label: NOTE_CASH },
  ];
}

function writePlanRow(sheet, rowNumber, step) {
  if (step.kind === "section") {
    writeSection(sheet, rowNumber, step.label);
  } else if (step.kind === "item") {
    writeDataRow(sheet, rowNumber, step.entry, step.numFmt);
  } else if (step.kind === "subtotal") {
    writeSubtotal(sheet, rowNumber, step.label, step.values);
  } else if (step.kind === "note") {
    sheet.getCell(`A${rowNumber}`).value = step.label;
    sheet.getCell(`A${rowNumber}`).font = { italic: true, size: 9 };
  } else if (step.kind === "cash") {
    sheet.getCell(`A${rowNumber}`).value = step.label;
    const cell = sheet.getCell(`C${rowNumber}`);
    cell.value = step.text;
    cell.alignment = { horizontal: "right" };
  }
}

function buildProfitAndLoss(workbook, totals) {
  const sheet = workbook.addWorksheet("Laba Rugi");
  sheet.columns = [{ width: 46 }, { width: 20 }, { width: 20 }, { width: 28 }];
  titleBand(
    sheet,
    [
      COMPANY.toUpperCase(),
      "LAPORAN LABA RUGI KOMPARATIF",
      "Untuk tahun yang berakhir 31 Desember 2023 dan 2024 (dalam Rupiah penuh)",
    ],
    "D",
  );
  const headerRow = 5;
  ["Keterangan", "2023", "2024", "Catatan"].forEach((text, index) => {
    const cell = sheet.getCell(`${"ABCD"[index]}${headerRow}`);
    cell.value = text;
    cell.font = { bold: true };
  });
  profitAndLossPlan(totals).forEach((step, index) => {
    writePlanRow(sheet, headerRow + 1 + index, step);
  });
  return sheet;
}

function buildOperations(workbook) {
  const sheet = workbook.addWorksheet("Operasional");
  sheet.columns = [{ width: 42 }, { width: 16 }, { width: 16 }];
  titleBand(sheet, [COMPANY.toUpperCase(), "DATA OPERASIONAL — JUMLAH, BUKAN NILAI UANG"], "C");
  const headerRow = 4;
  ["Keterangan", "2023", "2024"].forEach((text, index) => {
    const cell = sheet.getCell(`${"ABC"[index]}${headerRow}`);
    cell.value = text;
    cell.font = { bold: true };
  });
  OPS.forEach((entry, index) => {
    const row = headerRow + 1 + index;
    sheet.getCell(`A${row}`).value = entry[0];
    sheet.getCell(`B${row}`).value = entry[1];
    sheet.getCell(`C${row}`).value = entry[2];
  });
  const priceRow = headerRow + OPS.length + 2;
  sheet.getCell(`A${priceRow}`).value = "Rata-rata Harga Jual per pcs";
  AVG_PRICE.forEach((value, index) => {
    const cell = sheet.getCell(`${"BC"[index]}${priceRow}`);
    cell.value = value;
    cell.numFmt = FMT.rp;
  });
  const noteRow = priceRow + 1;
  sheet.getCell(`A${noteRow}`).value =
    "Catatan: hanya baris harga jual yang bernilai Rupiah; baris lain adalah jumlah orang, gerai atau pcs.";
  sheet.getCell(`A${noteRow}`).font = { italic: true, size: 9 };
  return sheet;
}

// ------------------------------------------------------------------ totals

/** Every subtotal the sheet prints, recomputed here from the leaf rows only. */
function computeTotals() {
  const per = (fn) => YEARS.map((year) => fn(year));
  const revenue = per((year) => sumAt(REVENUE, year));
  const cogs = per((year) => sumAt(COGS, year));
  const opex = per((year) => sumAt(OPEX, year));
  const gross = revenue.map((value, index) => value - cogs[index]); // laba kotor = pendapatan bersih - HPP
  const operating = gross.map((value, index) => value - opex[index]); // laba usaha = laba kotor - beban usaha
  const otherNet = per((year) => sumAt(OTHER, year));
  const pretax = operating.map((value, index) => value + otherNet[index]); // + (pendapatan - beban) lain-lain
  const tax = pretax.map((value) => Math.round(value * TAX_RATE)); // PPh badan 22%
  const net = pretax.map((value, index) => value - tax[index]); // laba bersih = laba sebelum pajak - pajak
  return { revenue, cogs, opex, gross, operating, otherNet, pretax, tax, net };
}

// ------------------------------------------------------------------- truth

function lineItems(totals) {
  const money = (rows, category) =>
    rows.flatMap((entry) =>
      YEARS.map((year) => ({
        label: entry[0],
        period: year,
        amount: at(entry, year),
        currency: CURRENCY,
        category,
      })),
    );
  const tax = YEARS.map((year, index) => ({
    label: "Beban Pajak Penghasilan (22%)",
    period: year,
    amount: -totals.tax[index],
    currency: CURRENCY,
    category: "other",
  }));
  const counts = OPS.flatMap((entry) =>
    YEARS.map((year, index) => ({
      label: entry[0],
      period: year,
      amount: entry[index + 1],
      currency: "",
      category: "other",
    })),
  );
  return [
    ...money(REVENUE, "revenue"),
    ...money(COGS, "cogs"),
    ...money(OPEX, "opex"),
    ...money(OTHER, "other"),
    ...tax,
    ...YEARS.map((year, index) => ({
      label: "Rata-rata Harga Jual per pcs",
      period: year,
      amount: AVG_PRICE[index],
      currency: CURRENCY,
      category: "other",
    })),
    ...counts,
    { label: "Saldo Kas & Setara Kas", period: "2024", amount: CASH_ON_HAND, currency: CURRENCY, category: "cash" },
    {
      label: "Rata-rata Burn Kas Bulanan Program Ekspansi",
      period: "bulanan",
      amount: MONTHLY_BURN,
      currency: CURRENCY,
      category: "other",
    },
  ];
}

const money = (key, label, value) => ({ key, label, value, unit: "currency", tolerance: 0.001 });
const percent = (key, label, value) => ({ key, label, value: round(value, 4), unit: "percent", tolerance: 0.005 });
const scalar = (key, label, value, unit, tolerance) => ({ key, label, value: round(value, 4), unit, tolerance });

/** 12–25 figures, each with its formula beside it, all from plain arithmetic above. */
function figures(totals) {
  const [r23, r24] = totals.revenue;
  const [n23, n24] = totals.net;
  return [
    money("revenue.2023", "Pendapatan bersih 2023", r23), // sum(revenue rows 2023)
    money("revenue.2024", "Pendapatan bersih 2024", r24), // sum(revenue rows 2024)
    money("cogs.2024", "Harga pokok penjualan 2024", totals.cogs[1]), // sum(cogs rows 2024)
    money("grossProfit.2023", "Laba kotor 2023", totals.gross[0]), // revenue - cogs
    money("grossProfit.2024", "Laba kotor 2024", totals.gross[1]), // revenue - cogs
    percent("grossMarginPct.2023", "Margin kotor 2023", (totals.gross[0] / r23) * 100), // gross / revenue
    percent("grossMarginPct.2024", "Margin kotor 2024", (totals.gross[1] / r24) * 100), // gross / revenue
    money("opex.2023", "Jumlah beban usaha 2023", totals.opex[0]), // sum(opex rows 2023)
    money("opex.2024", "Jumlah beban usaha 2024", totals.opex[1]), // sum(opex rows 2024)
    money("operatingProfit.2024", "Laba usaha 2024", totals.operating[1]), // gross - opex
    percent("operatingMarginPct.2024", "Margin usaha 2024", (totals.operating[1] / r24) * 100), // operating / revenue
    money("pretaxProfit.2024", "Laba sebelum pajak 2024", totals.pretax[1]), // operating + other net
    money("taxExpense.2024", "Beban pajak penghasilan 2024", totals.tax[1]), // pretax * 0.22
    money("netProfit.2023", "Laba bersih 2023", n23), // pretax - tax
    money("netProfit.2024", "Laba bersih 2024", n24), // pretax - tax
    percent("netMarginPct.2024", "Margin bersih 2024", (n24 / r24) * 100), // net / revenue
    percent("revenueGrowthPct.2024", "Pertumbuhan pendapatan 2024", ((r24 - r23) / r23) * 100), // (r24-r23)/r23
    percent("netProfitGrowthPct.2024", "Pertumbuhan laba bersih 2024", ((n24 - n23) / n23) * 100), // (n24-n23)/n23
    percent("cogsRatioPct.2024", "Rasio HPP terhadap pendapatan 2024", (totals.cogs[1] / r24) * 100), // cogs / revenue
    money("cash.2024", "Saldo kas & setara kas 2024", CASH_ON_HAND), // as stated on the sheet
    money("monthlyBurn", "Burn kas bulanan program ekspansi", MONTHLY_BURN), // as stated on the sheet
    scalar("runwayMonths", "Runway kas ekspansi (bulan)", CASH_ON_HAND / MONTHLY_BURN, "months", 0.005), // kas / burn bulanan
    scalar("headcountTotal.2024", "Total karyawan tetap + harian 2024", OPS[0][2] + OPS[1][2], "count", 0), // 46 + 29
    scalar("unitsSold.2024", "Unit produk terjual 2024 (pcs)", OPS[3][2], "count", 0), // baris sheet Operasional
    money("avgPricePerUnit.2024", "Harga jual rata-rata per pcs 2024", AVG_PRICE[1]), // as stated on the sheet
  ];
}

const DESCRIPTION = [
  `Laporan laba rugi komparatif 2023-2024 sebuah UMKM Indonesia fiktif (${COMPANY}), satu berkas .xlsx dua sheet.`,
  "Sheet 'Laba Rugi' memakai judul yang di-merge, format 'Rp', beberapa sel diketik sebagai TEKS dengan pemisah ribuan Indonesia (512.000.000), negatif dalam kurung, baris subtotal (Pendapatan Bersih, Jumlah HPP, LABA KOTOR, Jumlah Beban Usaha, LABA USAHA, LABA SEBELUM PAJAK, LABA BERSIH) yang TIDAK boleh ikut dijumlahkan sebagai line item, baris catatan, dan baris kosong pemisah.",
  "Sheet 'Operasional' berisi jumlah orang / gerai / pcs (bukan Rupiah), kecuali satu baris harga jual rata-rata yang memang Rupiah.",
  "Definisi yang dipakai truth (produk belum menyebutnya secara eksplisit): margin kotor = laba kotor / pendapatan bersih; margin bersih = laba bersih setelah bunga, lain-lain dan pajak / pendapatan bersih; 'laba usaha' = pendapatan - HPP - beban usaha, yaitu angka yang sama dengan metrik net_profit produk karena bunga, pendapatan lain-lain dan pajak dikategorikan 'other'.",
  "Runway = saldo kas ekspansi / burn kas bulanan program ekspansi = 1.180.000.000 / 152.000.000; burn diambil apa adanya dari sheet, bukan dihitung dari beban usaha.",
  "Toleransi setiap figure adalah pecahan RELATIF terhadap |value| (0,005 = 0,5%); toleransi 0 berarti harus persis.",
].join(" ");

// -------------------------------------------------------------------- main

async function main() {
  const totals = computeTotals();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AgentForge finance eval fixture";
  workbook.lastModifiedBy = workbook.creator;
  workbook.created = FIXED_STAMP;
  workbook.modified = FIXED_STAMP;
  buildProfitAndLoss(workbook, totals);
  buildOperations(workbook);
  mkdirSync(HERE, { recursive: true });
  await workbook.xlsx.writeFile(join(HERE, "input.xlsx"));

  const caseFile = {
    id: "brief-umkm-2y",
    task: "brief",
    locale: "id",
    currency: CURRENCY,
    description: DESCRIPTION,
    files: [
      { path: "input.xlsx", sheet: "Laba Rugi" },
      { path: "input.xlsx", sheet: "Operasional" },
    ],
    prompt: `Buatkan ringkasan kinerja keuangan ${COMPANY} untuk 2023 dan 2024 dari lampiran ini: pertumbuhan pendapatan, margin kotor dan margin bersih, beban usaha terbesar, serta berapa bulan kas program ekspansi masih bertahan.`,
    params: { monthlyBurn: MONTHLY_BURN, cashOnHand: CASH_ON_HAND },
    truth: {
      lineItems: lineItems(totals),
      figures: figures(totals),
      mustMention: ["runway", "margin", "2024", "2023"],
      mustNotContain: ["[unverified figure]"],
    },
  };
  writeFileSync(join(HERE, "case.json"), `${JSON.stringify(caseFile, null, 2)}\n`, "utf8");
  process.stdout.write(`brief-umkm-2y: wrote input.xlsx and case.json (${caseFile.truth.figures.length} figures)\n`);
}

await main();

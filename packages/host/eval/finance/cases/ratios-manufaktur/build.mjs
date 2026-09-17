/**
 * ratios-manufaktur — deterministic source data plus an independent ground truth.
 *
 * Writes `input.xlsx` with two sheets, "Neraca" and "Laba Rugi", laid out the
 * way an Indonesian manufacturer's accountant lays them out: merged title band,
 * section and sub-section headers with no figures, "Rp" and accounting number
 * formats, a few cells typed as TEXT with Indonesian grouping, parenthesised
 * negatives, subtotal rows that must not be double counted, spacer rows, a
 * notes row, and a supporting-data block that is not part of the P&L. The
 * balance sheet balances in both years: JUMLAH ASET = JUMLAH LIABILITAS +
 * JUMLAH EKUITAS, and verify.mjs re-proves that from the written cells.
 *
 * `truth` is computed below with plain arithmetic only; nothing from
 * packages/core/src/finance is imported, so it stays an oracle independent of
 * the engine it grades. No Date.now(), no Math.random(): every run writes the
 * same cells and the same case.json, though the .xlsx bytes differ because
 * ExcelJS stamps each zip entry with the wall clock — compare the cell grid,
 * never the file hash. PT Baja Karya Mandiri and every figure are invented.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXED_STAMP = new Date(Date.UTC(2025, 0, 2, 3, 4, 5));
const COMPANY = "PT Baja Karya Mandiri";
const CURRENCY = "IDR";
const YEARS = ["2023", "2024"];
const DAYS_PER_YEAR = 365;

const FMT = {
  plain: "#,##0",
  signed: "#,##0;(#,##0)",
  accounting: '_-"Rp"* #,##0_-;_-"Rp"* (#,##0)_-;_-"Rp"* "-"_-;_-@_-',
};

/** [label, 2023, 2024]. Signs are as the printed report shows them. */
const CURRENT_ASSETS = [
  ["Kas dan Setara Kas", 1_850_000_000, 2_340_000_000],
  ["Piutang Usaha", 4_120_000_000, 5_180_000_000],
  ["Persediaan", 3_960_000_000, 4_725_000_000],
  ["Biaya Dibayar di Muka", 285_000_000, 362_000_000],
];
const FIXED_ASSETS = [
  ["Tanah dan Bangunan", 8_500_000_000, 8_500_000_000],
  ["Mesin dan Peralatan", 6_240_000_000, 7_180_000_000],
  ["Akumulasi Penyusutan", -3_310_000_000, -4_025_000_000],
  ["Aset Tak Berwujud", 420_000_000, 385_000_000],
];
const CURRENT_LIABILITIES = [
  ["Utang Usaha", 3_280_000_000, 3_960_000_000],
  ["Utang Bank Jangka Pendek", 1_500_000_000, 1_800_000_000],
  ["Beban yang Masih Harus Dibayar", 465_000_000, 590_000_000],
  ["Utang Pajak", 310_000_000, 425_000_000],
  ["Bagian Lancar Utang Jangka Panjang", 900_000_000, 1_100_000_000],
];
const LONG_TERM_LIABILITIES = [
  ["Utang Bank Jangka Panjang", 5_400_000_000, 5_200_000_000],
  ["Liabilitas Imbalan Kerja", 720_000_000, 845_000_000],
];
const EQUITY = [
  ["Modal Saham", 5_000_000_000, 5_000_000_000],
  ["Tambahan Modal Disetor", 1_250_000_000, 1_250_000_000],
  ["Saldo Laba", 3_240_000_000, 4_477_000_000],
];

const SALES = ["Penjualan Bersih", 28_400_000_000, 33_750_000_000];
const COGS = ["Harga Pokok Penjualan", -20_450_000_000, -23_960_000_000];
const OPEX = [
  ["Beban Penjualan", 2_180_000_000, 2_540_000_000],
  ["Beban Umum dan Administrasi", 2_935_000_000, 3_410_000_000],
];
const NON_OPERATING = [
  ["Beban Bunga", -742_000_000, -816_000_000],
  ["Pendapatan (Beban) Lain-lain Neto", 95_000_000, -48_000_000],
];
const SUPPORTING = [
  ["Beban Penyusutan dan Amortisasi", 680_000_000, 750_000_000],
  ["Pembayaran Pokok Pinjaman", 850_000_000, 1_050_000_000],
];
const TAX_RATE = 0.22;

const NOTE_BALANCE =
  "Catatan: akumulasi penyusutan disajikan sebagai pengurang aset tetap. Bagian lancar utang jangka panjang sudah dipindahkan ke liabilitas jangka pendek, sehingga tidak boleh dihitung dua kali bersama utang bank jangka panjang.";
const NOTE_SUPPORTING =
  "Catatan: data pendukung dipakai untuk DSCR dan EBITDA; jangan dijumlahkan ke dalam beban usaha maupun laba rugi.";

/** Cells a human typed as text, not as a number. Key is `label|year`. */
const TEXT_CELLS = new Map([
  ["Piutang Usaha|2024", "5.180.000.000"],
  ["Akumulasi Penyusutan|2024", "(4.025.000.000)"],
  ["Utang Pajak|2023", "310.000.000"],
  ["Harga Pokok Penjualan|2024", "(23.960.000.000)"],
  ["Pembayaran Pokok Pinjaman|2024", "1.050.000.000"],
]);

const at = (row, year) => row[YEARS.indexOf(year) + 1];
const both = (fn) => YEARS.map((year) => fn(year));
const sumAt = (rows, year) => rows.reduce((total, row) => total + at(row, year), 0);
const totalsOf = (rows) => both((year) => sumAt(rows, year));
const round = (value, places) => Number(value.toFixed(places));

// ---------------------------------------------------------------- workbook

function titleBand(sheet, lines) {
  lines.forEach((text, index) => {
    const row = index + 1;
    sheet.mergeCells(`A${row}:C${row}`);
    const cell = sheet.getCell(`A${row}`);
    cell.value = text;
    cell.font = { bold: index === 0, size: index === 0 ? 13 : 11 };
    cell.alignment = { horizontal: "center" };
  });
}

function writeStep(sheet, rowNumber, step) {
  const label = sheet.getCell(`A${rowNumber}`);
  if (step.kind === "blank") {
    return;
  }
  label.value = step.kind === "item" ? `   ${step.row[0]}` : step.label;
  label.font =
    step.kind === "note" ? { italic: true, size: 9 } : { bold: step.kind !== "item", italic: step.kind === "sub" };
  if (step.kind === "note" || step.kind === "section" || step.kind === "sub") {
    return;
  }
  YEARS.forEach((year, index) => {
    const cell = sheet.getCell(`${"BC"[index]}${rowNumber}`);
    const typed = step.kind === "item" ? TEXT_CELLS.get(`${step.row[0]}|${year}`) : undefined;
    if (typed !== undefined) {
      cell.value = typed;
      cell.alignment = { horizontal: "right" };
      return;
    }
    cell.value = step.kind === "item" ? at(step.row, year) : step.values[index];
    cell.numFmt = step.kind === "item" ? FMT.signed : FMT.accounting;
    cell.font = step.kind === "item" ? undefined : { bold: true };
  });
}

function renderSheet(workbook, name, titles, plan) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = [{ width: 46 }, { width: 22 }, { width: 22 }];
  titleBand(sheet, titles);
  const headerRow = titles.length + 2;
  ["Keterangan", ...YEARS].forEach((text, index) => {
    const cell = sheet.getCell(`${"ABC"[index]}${headerRow}`);
    cell.value = text;
    cell.font = { bold: true };
  });
  plan.forEach((step, index) => {
    writeStep(sheet, headerRow + 1 + index, step);
  });
  return sheet;
}

const items = (rows) => rows.map((row) => ({ kind: "item", row }));
const sub = (label, values) => ({ kind: "subtotal", label, values });
const BLANK = { kind: "blank" };

function balanceSheetPlan(totals) {
  return [
    { kind: "section", label: "ASET" },
    { kind: "sub", label: "Aset Lancar" },
    ...items(CURRENT_ASSETS),
    sub("Jumlah Aset Lancar", totals.currentAssets),
    { kind: "sub", label: "Aset Tidak Lancar" },
    ...items(FIXED_ASSETS),
    sub("Jumlah Aset Tidak Lancar", totals.fixedAssets),
    sub("JUMLAH ASET", totals.assets),
    BLANK,
    { kind: "section", label: "LIABILITAS DAN EKUITAS" },
    { kind: "sub", label: "Liabilitas Jangka Pendek" },
    ...items(CURRENT_LIABILITIES),
    sub("Jumlah Liabilitas Jangka Pendek", totals.currentLiabilities),
    { kind: "sub", label: "Liabilitas Jangka Panjang" },
    ...items(LONG_TERM_LIABILITIES),
    sub("Jumlah Liabilitas Jangka Panjang", totals.longTermLiabilities),
    sub("JUMLAH LIABILITAS", totals.liabilities),
    { kind: "sub", label: "Ekuitas" },
    ...items(EQUITY),
    sub("JUMLAH EKUITAS", totals.equity),
    sub("JUMLAH LIABILITAS DAN EKUITAS", totals.liabilitiesAndEquity),
    BLANK,
    { kind: "note", label: NOTE_BALANCE },
  ];
}

function incomeStatementPlan(totals) {
  return [
    { kind: "item", row: SALES },
    { kind: "item", row: COGS },
    sub("LABA KOTOR", totals.gross),
    BLANK,
    { kind: "section", label: "BEBAN USAHA" },
    ...items(OPEX),
    sub("Jumlah Beban Usaha", totals.opex),
    sub("LABA USAHA (EBIT)", totals.ebit),
    BLANK,
    { kind: "section", label: "PENDAPATAN (BEBAN) LAIN-LAIN" },
    ...items(NON_OPERATING),
    sub("LABA SEBELUM PAJAK", totals.pretax),
    { kind: "item", row: ["Beban Pajak Penghasilan (22%)", -totals.tax[0], -totals.tax[1]] },
    sub("LABA BERSIH", totals.net),
    BLANK,
    { kind: "section", label: "DATA PENDUKUNG (bukan bagian laba rugi)" },
    ...items(SUPPORTING),
    { kind: "note", label: NOTE_SUPPORTING },
  ];
}

// ------------------------------------------------------------------ totals

function computeTotals() {
  const currentAssets = totalsOf(CURRENT_ASSETS);
  const fixedAssets = totalsOf(FIXED_ASSETS);
  const currentLiabilities = totalsOf(CURRENT_LIABILITIES);
  const longTermLiabilities = totalsOf(LONG_TERM_LIABILITIES);
  const equity = totalsOf(EQUITY);
  const assets = currentAssets.map((value, i) => value + fixedAssets[i]); // aset lancar + aset tidak lancar
  const liabilities = currentLiabilities.map((value, i) => value + longTermLiabilities[i]);
  const gross = both((year) => at(SALES, year) + at(COGS, year)); // HPP sudah negatif di sheet
  const opex = totalsOf(OPEX);
  const ebit = gross.map((value, i) => value - opex[i]); // laba usaha = laba kotor - beban usaha
  const pretax = ebit.map((value, i) => value + sumAt(NON_OPERATING, YEARS[i])); // + bunga + lain-lain
  const tax = pretax.map((value) => Math.round(value * TAX_RATE)); // PPh badan 22%
  return {
    currentAssets,
    fixedAssets,
    assets,
    currentLiabilities,
    longTermLiabilities,
    liabilities,
    equity,
    liabilitiesAndEquity: liabilities.map((value, i) => value + equity[i]),
    gross,
    opex,
    ebit,
    pretax,
    tax,
    net: pretax.map((value, i) => value - tax[i]),
  };
}

// ------------------------------------------------------------------- truth

function lineItems(totals) {
  const spread = (rows, category) =>
    rows.flatMap((row) =>
      YEARS.map((year) => ({ label: row[0], period: year, amount: at(row, year), currency: CURRENCY, category })),
    );
  return [
    ...spread(CURRENT_ASSETS, "asset"),
    ...spread(FIXED_ASSETS, "other"),
    ...spread(CURRENT_LIABILITIES, "liability"),
    ...spread(LONG_TERM_LIABILITIES, "debt"),
    ...spread(EQUITY, "equity"),
    ...spread([SALES], "revenue"),
    ...spread([COGS], "cogs"),
    ...spread(OPEX, "opex"),
    ...spread(NON_OPERATING, "other"),
    ...spread([["Beban Pajak Penghasilan (22%)", -totals.tax[0], -totals.tax[1]]], "other"),
    ...spread(SUPPORTING, "other"),
  ];
}

const money = (key, label, value) => ({ key, label, value, unit: "currency", tolerance: 0.001 });
const ratio = (key, label, value) => ({ key, label, value: round(value, 4), unit: "ratio", tolerance: 0.005 });
const exact = (key, label, value) => ({ key, label, value, unit: "currency", tolerance: 0 });
const percent = (key, label, value) => ({ key, label, value: round(value, 4), unit: "percent", tolerance: 0.005 });

/** The 2024 balance-sheet buckets the ratios are built from. */
function buckets(totals) {
  const last = 1;
  const interestBearing =
    at(CURRENT_LIABILITIES[1], "2024") + at(CURRENT_LIABILITIES[4], "2024") + at(LONG_TERM_LIABILITIES[0], "2024");
  return {
    currentAssets: totals.currentAssets[last],
    currentLiabilities: totals.currentLiabilities[last],
    inventory: at(CURRENT_ASSETS[2], "2024"),
    cash: at(CURRENT_ASSETS[0], "2024"),
    assets: totals.assets[last],
    liabilities: totals.liabilities[last],
    longTermLiabilities: totals.longTermLiabilities[last],
    equity: totals.equity[last],
    interestBearing, // utang bank pendek + bagian lancar UJP + utang bank panjang
    ebit: totals.ebit[last],
    interest: -at(NON_OPERATING[0], "2024"), // beban bunga sebagai nilai positif
    principal: at(SUPPORTING[1], "2024"),
    depreciation: at(SUPPORTING[0], "2024"),
    sales: at(SALES, "2024"),
    cogs: -at(COGS, "2024"), // HPP sebagai nilai positif
    gross: totals.gross[last],
    net: totals.net[last],
  };
}

/** 25 figures, each with its formula beside it, all from plain arithmetic above. */
function figures(totals) {
  const b = buckets(totals);
  const debtService = b.interest + b.principal; // bunga + pokok yang jatuh tempo tahun berjalan
  const ebitda = b.ebit + b.depreciation; // EBIT + penyusutan & amortisasi
  return [
    money("currentAssets.2024", "Jumlah aset lancar 2024", b.currentAssets), // sum(aset lancar)
    money("currentLiabilities.2024", "Jumlah liabilitas jangka pendek 2024", b.currentLiabilities), // sum(liabilitas lancar)
    money("inventory.2024", "Persediaan 2024", b.inventory), // baris persediaan
    money("totalAssets.2024", "Jumlah aset 2024", b.assets), // aset lancar + aset tidak lancar
    money("totalLiabilities.2024", "Jumlah liabilitas 2024", b.liabilities), // liabilitas pendek + panjang
    money("totalEquity.2024", "Jumlah ekuitas 2024", b.equity), // sum(ekuitas)
    exact("balanceCheck.2024", "Selisih neraca 2024 (aset - liabilitas - ekuitas)", b.assets - b.liabilities - b.equity), // harus nol
    money("workingCapital.2024", "Modal kerja 2024", b.currentAssets - b.currentLiabilities), // aset lancar - liabilitas lancar
    ratio("currentRatio.2024", "Rasio lancar 2024", b.currentAssets / b.currentLiabilities), // aset lancar / liabilitas lancar
    ratio("currentRatio.2023", "Rasio lancar 2023", totals.currentAssets[0] / totals.currentLiabilities[0]), // idem, kolom 2023
    ratio("quickRatio.2024", "Rasio cepat 2024", (b.currentAssets - b.inventory) / b.currentLiabilities), // (aset lancar - persediaan) / liabilitas lancar
    ratio("cashRatio.2024", "Rasio kas 2024", b.cash / b.currentLiabilities), // kas / liabilitas lancar
    ratio("debtToEquityTotal.2024", "Utang terhadap ekuitas 2024 (total liabilitas)", b.liabilities / b.equity), // total liabilitas / ekuitas
    // utang berbunga = utang bank pendek + bagian lancar UJP + utang bank panjang
    ratio("debtToEquityInterestBearing.2024", "Utang berbunga terhadap ekuitas 2024", b.interestBearing / b.equity),
    // liabilitas jangka panjang / ekuitas — versi yang dihitung engine dari kategori `debt`
    ratio("nonCurrentDebtToEquity.2024", "Liabilitas jangka panjang terhadap ekuitas 2024", b.longTermLiabilities / b.equity),
    money("ebit.2024", "Laba usaha (EBIT) 2024", b.ebit), // laba kotor - beban usaha
    money("ebitda.2024", "EBITDA 2024", ebitda), // EBIT + penyusutan & amortisasi
    money("interestExpense.2024", "Beban bunga 2024", b.interest), // nilai absolut baris beban bunga
    money("debtService.2024", "Beban pelunasan utang 2024", debtService), // bunga + pokok
    ratio("interestCoverage.2024", "Kemampuan menutup bunga 2024", b.ebit / b.interest), // EBIT / beban bunga
    ratio("dscrEbitda.2024", "DSCR 2024 basis EBITDA", ebitda / debtService), // EBITDA / (bunga + pokok)
    ratio("dscrEbit.2024", "DSCR 2024 basis EBIT", b.ebit / debtService), // EBIT / (bunga + pokok)
    percent("grossMarginPct.2024", "Margin kotor 2024", (b.gross / b.sales) * 100), // laba kotor / penjualan bersih
    percent("returnOnEquityPct.2024", "Imbal hasil ekuitas 2024", (b.net / b.equity) * 100), // laba bersih / ekuitas
    ratio("inventoryTurnover.2024", "Perputaran persediaan 2024", b.cogs / b.inventory), // HPP / persediaan
  ];
}

const DESCRIPTION = [
  `Neraca dan laba rugi 2023-2024 sebuah perusahaan manufaktur Indonesia fiktif (${COMPANY}) dalam satu .xlsx dua sheet: "Neraca" dan "Laba Rugi".`,
  "Neraca SEIMBANG di kedua tahun: JUMLAH ASET = JUMLAH LIABILITAS + JUMLAH EKUITAS (figure balanceCheck.2024 harus nol persis).",
  "Tanda mengikuti sheet: Harga Pokok Penjualan, Akumulasi Penyusutan, Beban Bunga dan Beban Pajak ditulis NEGATIF, jadi truth.lineItems juga negatif; figure interestExpense.2024 dan perputaran persediaan memakai nilai absolutnya.",
  "Pemetaan kategori yang dipakai truth (produk tidak membedakan lancar / tidak lancar): aset lancar = 'asset', aset tetap = 'other', liabilitas jangka pendek = 'liability', liabilitas jangka panjang = 'debt', ekuitas = 'equity'. Baris DATA PENDUKUNG (penyusutan, pembayaran pokok) = 'other' dan bukan bagian laba rugi.",
  "Semua rasio dihitung dari kolom 2024 saja; lineItems memuat kedua tahun, jadi menjumlahkan seluruh periode akan menggandakan neraca.",
  "Definisi yang dipakai karena produk belum menetapkannya: rasio cepat = (aset lancar - persediaan) / liabilitas lancar; utang terhadap ekuitas diberikan tiga versi (total liabilitas, utang berbunga, dan liabilitas jangka panjang) karena ketiganya lazim dipakai; DSCR diberikan dua versi, basis EBITDA dan basis EBIT, dengan beban pelunasan = beban bunga + pembayaran pokok tahun berjalan.",
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
  renderSheet(
    workbook,
    "Neraca",
    [COMPANY.toUpperCase(), "LAPORAN POSISI KEUANGAN (NERACA)", "Per 31 Desember 2023 dan 2024 (dalam Rupiah penuh)"],
    balanceSheetPlan(totals),
  );
  renderSheet(
    workbook,
    "Laba Rugi",
    [
      COMPANY.toUpperCase(),
      "LAPORAN LABA RUGI",
      "Untuk tahun yang berakhir 31 Desember 2023 dan 2024 (dalam Rupiah penuh)",
    ],
    incomeStatementPlan(totals),
  );
  mkdirSync(HERE, { recursive: true });
  await workbook.xlsx.writeFile(join(HERE, "input.xlsx"));

  const caseFile = {
    id: "ratios-manufaktur",
    task: "ratios",
    locale: "id",
    currency: CURRENCY,
    description: DESCRIPTION,
    files: [
      { path: "input.xlsx", sheet: "Neraca" },
      { path: "input.xlsx", sheet: "Laba Rugi" },
    ],
    prompt: `Hitung dan jelaskan rasio keuangan ${COMPANY} per 31 Desember 2024 dari neraca dan laba rugi terlampir: rasio lancar, rasio cepat, utang terhadap ekuitas, DSCR, dan kemampuan menutup beban bunga. Sebutkan pos mana yang masuk pembilang dan penyebut tiap rasio.`,
    params: {
      daysPerYear: DAYS_PER_YEAR,
      principalRepayment2024: at(SUPPORTING[1], "2024"),
      depreciationAmortization2024: at(SUPPORTING[0], "2024"),
    },
    truth: {
      lineItems: lineItems(totals),
      figures: figures(totals),
      mustMention: ["rasio", "DSCR", "ekuitas", "2024"],
      mustNotContain: ["[unverified figure]"],
    },
  };
  writeFileSync(join(HERE, "case.json"), `${JSON.stringify(caseFile, null, 2)}\n`, "utf8");
  process.stdout.write(`ratios-manufaktur: wrote input.xlsx and case.json (${caseFile.truth.figures.length} figures)\n`);
}

await main();

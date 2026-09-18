/**
 * Independent check for ratios-manufaktur. Written separately from build.mjs on
 * purpose: it reopens input.xlsx, prints both cell grids, re-proves that the
 * balance sheet balances, re-adds every subtotal from its leaf rows, and
 * re-derives every truth figure from the cells with its own Indonesian number
 * reader — never from the constants build.mjs used.
 *
 * Exits non-zero when anything disagrees so a harness can gate on it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));
const COLUMNS = ["A", "B", "C"];
const YEARS = [2023, 2024];

/** Reads what a human typed: 5.180.000.000, (4.025.000.000), or a real number. */
function cellNumber(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(typeof value === "object" && "result" in value ? value.result : value).trim();
  const wrapped = /^\((.*)\)$/.exec(text);
  const inner = (wrapped ? wrapped[1] : text).replace(/^rp\s*/i, "").trim();
  if (!/^\d{1,3}(?:\.\d{3})*(?:,\d+)?$/.test(inner)) {
    return null;
  }
  const parsed = Number(inner.split(".").join("").replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return wrapped ? -parsed : parsed;
}

function printGrid(sheet) {
  process.stdout.write(`\n=== sheet "${sheet.name}" (${sheet.rowCount} rows) ===\n`);
  sheet.eachRow({ includeEmpty: false }, (_row, rowNumber) => {
    const parts = COLUMNS.map((column) => {
      const cell = sheet.getCell(`${column}${rowNumber}`);
      const empty = cell.value === null || cell.value === undefined || cell.value === "";
      const kind = typeof cell.value === "number" ? "n" : "s";
      return empty ? null : `${column}[${kind}]=${JSON.stringify(cell.value)}`;
    }).filter((part) => part !== null);
    if (parts.length > 0) {
      process.stdout.write(`r${String(rowNumber).padStart(2, "0")}  ${parts.join("  ")}\n`);
    }
  });
}

function labelledRows(sheet) {
  const found = new Map();
  sheet.eachRow({ includeEmpty: false }, (_row, rowNumber) => {
    const label = String(sheet.getCell(`A${rowNumber}`).value ?? "").trim();
    if (label !== "") {
      found.set(label, {
        2023: cellNumber(sheet.getCell(`B${rowNumber}`).value),
        2024: cellNumber(sheet.getCell(`C${rowNumber}`).value),
      });
    }
  });
  return found;
}

const failures = [];

function check(name, actual, expected, tolerance = 0) {
  const gap = Math.abs(actual - expected);
  const limit = tolerance === 0 ? 0 : Math.max(tolerance * Math.abs(expected), 1e-9);
  const ok = Number.isFinite(actual) && Number.isFinite(expected) && gap <= limit;
  if (!ok) {
    failures.push(`${name}: grid gives ${actual}, expected ${expected} (gap ${gap}, limit ${limit})`);
  }
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}  actual=${actual} expected=${expected}\n`);
}

function sumOf(rows, labels, year) {
  return labels.reduce((total, label) => {
    const entry = rows.get(label);
    if (!entry || entry[year] === null) {
      failures.push(`missing cell for "${label}" ${year}`);
      return total;
    }
    return total + entry[year];
  }, 0);
}

const CURRENT_ASSETS = ["Kas dan Setara Kas", "Piutang Usaha", "Persediaan", "Biaya Dibayar di Muka"];
const FIXED_ASSETS = ["Tanah dan Bangunan", "Mesin dan Peralatan", "Akumulasi Penyusutan", "Aset Tak Berwujud"];
const CURRENT_LIABILITIES = [
  "Utang Usaha",
  "Utang Bank Jangka Pendek",
  "Beban yang Masih Harus Dibayar",
  "Utang Pajak",
  "Bagian Lancar Utang Jangka Panjang",
];
const LONG_TERM_LIABILITIES = ["Utang Bank Jangka Panjang", "Liabilitas Imbalan Kerja"];
const EQUITY = ["Modal Saham", "Tambahan Modal Disetor", "Saldo Laba"];
const OPEX = ["Beban Penjualan", "Beban Umum dan Administrasi"];

function checkBalanceSheet(rows) {
  process.stdout.write("\n--- neraca: subtotals re-added, then the balance itself ---\n");
  for (const year of YEARS) {
    const currentAssets = sumOf(rows, CURRENT_ASSETS, year);
    const fixedAssets = sumOf(rows, FIXED_ASSETS, year);
    const currentLiabilities = sumOf(rows, CURRENT_LIABILITIES, year);
    const longTerm = sumOf(rows, LONG_TERM_LIABILITIES, year);
    const equity = sumOf(rows, EQUITY, year);
    check(`Jumlah Aset Lancar ${year}`, rows.get("Jumlah Aset Lancar")[year], currentAssets);
    check(`Jumlah Aset Tidak Lancar ${year}`, rows.get("Jumlah Aset Tidak Lancar")[year], fixedAssets);
    check(`JUMLAH ASET ${year}`, rows.get("JUMLAH ASET")[year], currentAssets + fixedAssets);
    check(
      `Jumlah Liabilitas Jangka Pendek ${year}`,
      rows.get("Jumlah Liabilitas Jangka Pendek")[year],
      currentLiabilities,
    );
    check(`Jumlah Liabilitas Jangka Panjang ${year}`, rows.get("Jumlah Liabilitas Jangka Panjang")[year], longTerm);
    check(`JUMLAH LIABILITAS ${year}`, rows.get("JUMLAH LIABILITAS")[year], currentLiabilities + longTerm);
    check(`JUMLAH EKUITAS ${year}`, rows.get("JUMLAH EKUITAS")[year], equity);
    check(
      `JUMLAH LIABILITAS DAN EKUITAS ${year}`,
      rows.get("JUMLAH LIABILITAS DAN EKUITAS")[year],
      currentLiabilities + longTerm + equity,
    );
    check(`NERACA SEIMBANG ${year}`, rows.get("JUMLAH ASET")[year], rows.get("JUMLAH LIABILITAS DAN EKUITAS")[year]);
  }
}

function checkIncomeStatement(rows) {
  process.stdout.write("\n--- laba rugi: subtotals re-added from the leaf rows ---\n");
  for (const year of YEARS) {
    const sales = rows.get("Penjualan Bersih")[year];
    const cogs = rows.get("Harga Pokok Penjualan")[year];
    const opex = sumOf(rows, OPEX, year);
    const nonOperating = sumOf(rows, ["Beban Bunga", "Pendapatan (Beban) Lain-lain Neto"], year);
    check(`LABA KOTOR ${year}`, rows.get("LABA KOTOR")[year], sales + cogs);
    check(`Jumlah Beban Usaha ${year}`, rows.get("Jumlah Beban Usaha")[year], opex);
    check(`LABA USAHA (EBIT) ${year}`, rows.get("LABA USAHA (EBIT)")[year], sales + cogs - opex);
    check(`LABA SEBELUM PAJAK ${year}`, rows.get("LABA SEBELUM PAJAK")[year], sales + cogs - opex + nonOperating);
    check(
      `LABA BERSIH ${year}`,
      rows.get("LABA BERSIH")[year],
      rows.get("LABA SEBELUM PAJAK")[year] + rows.get("Beban Pajak Penghasilan (22%)")[year],
    );
  }
}

function derive(neraca, labaRugi) {
  const bs = (label, year = 2024) => neraca.get(label)[year];
  const is = (label, year = 2024) => labaRugi.get(label)[year];
  const currentAssets = sumOf(neraca, CURRENT_ASSETS, 2024);
  const currentLiabilities = sumOf(neraca, CURRENT_LIABILITIES, 2024);
  const longTerm = sumOf(neraca, LONG_TERM_LIABILITIES, 2024);
  const equity = sumOf(neraca, EQUITY, 2024);
  const assets = currentAssets + sumOf(neraca, FIXED_ASSETS, 2024);
  const liabilities = currentLiabilities + longTerm;
  const inventory = bs("Persediaan");
  const ebit = is("LABA USAHA (EBIT)");
  const interest = -is("Beban Bunga");
  const principal = is("Pembayaran Pokok Pinjaman");
  const debtService = interest + principal;
  const ebitda = ebit + is("Beban Penyusutan dan Amortisasi");
  const interestBearing =
    bs("Utang Bank Jangka Pendek") + bs("Bagian Lancar Utang Jangka Panjang") + bs("Utang Bank Jangka Panjang");
  return {
    "currentAssets.2024": currentAssets,
    "currentLiabilities.2024": currentLiabilities,
    "inventory.2024": inventory,
    "totalAssets.2024": assets,
    "totalLiabilities.2024": liabilities,
    "totalEquity.2024": equity,
    "balanceCheck.2024": assets - liabilities - equity,
    "workingCapital.2024": currentAssets - currentLiabilities,
    "currentRatio.2024": currentAssets / currentLiabilities,
    "currentRatio.2023": sumOf(neraca, CURRENT_ASSETS, 2023) / sumOf(neraca, CURRENT_LIABILITIES, 2023),
    "quickRatio.2024": (currentAssets - inventory) / currentLiabilities,
    "cashRatio.2024": bs("Kas dan Setara Kas") / currentLiabilities,
    "debtToEquityTotal.2024": liabilities / equity,
    "debtToEquityInterestBearing.2024": interestBearing / equity,
    "nonCurrentDebtToEquity.2024": longTerm / equity,
    "ebit.2024": ebit,
    "ebitda.2024": ebitda,
    "interestExpense.2024": interest,
    "debtService.2024": debtService,
    "interestCoverage.2024": ebit / interest,
    "dscrEbitda.2024": ebitda / debtService,
    "dscrEbit.2024": ebit / debtService,
    "grossMarginPct.2024": (is("LABA KOTOR") / is("Penjualan Bersih")) * 100,
    "returnOnEquityPct.2024": (is("LABA BERSIH") / equity) * 100,
    "inventoryTurnover.2024": -is("Harga Pokok Penjualan") / inventory,
  };
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(HERE, "input.xlsx"));
  const neracaSheet = workbook.getWorksheet("Neraca");
  const labaRugiSheet = workbook.getWorksheet("Laba Rugi");
  printGrid(neracaSheet);
  printGrid(labaRugiSheet);

  const neraca = labelledRows(neracaSheet);
  const labaRugi = labelledRows(labaRugiSheet);
  checkBalanceSheet(neraca);
  checkIncomeStatement(labaRugi);

  const truth = JSON.parse(readFileSync(join(HERE, "case.json"), "utf8")).truth;
  const derived = derive(neraca, labaRugi);
  process.stdout.write("\n--- truth figures re-derived from the grids ---\n");
  for (const figure of truth.figures) {
    if (!(figure.key in derived)) {
      failures.push(`no independent derivation for ${figure.key}`);
      process.stdout.write(`FAIL ${figure.key}: nothing to compare against\n`);
      continue;
    }
    check(figure.key, derived[figure.key], figure.value, Math.max(figure.tolerance, 5e-5));
  }

  process.stdout.write(`\nchecked ${truth.figures.length} figures over ${YEARS.length} periods\n`);
  if (failures.length > 0) {
    process.stdout.write(`FAILURES (${failures.length}):\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("ratios-manufaktur: the balance sheet balances and all truth figures re-derive.\n");
}

await main();

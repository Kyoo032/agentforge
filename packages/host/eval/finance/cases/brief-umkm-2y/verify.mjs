/**
 * Independent check for brief-umkm-2y. Written separately from build.mjs on
 * purpose: it reopens input.xlsx, prints the cell grid, and re-derives every
 * subtotal and every truth figure from what is actually in the cells — with its
 * own Indonesian number reader — rather than from the constants build.mjs used.
 *
 * Exits non-zero on the first disagreement so a harness can gate on it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));
const COLUMNS = ["A", "B", "C", "D"];
const YEAR_COLUMN = { 2023: 2, 2024: 3 };

/** Reads what a human typed: 512.000.000, (245.000.000), Rp 1.180.000.000, or a real number. */
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
  const plain = inner.split(".").join("").replace(",", ".");
  const parsed = Number(plain);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return wrapped ? -parsed : parsed;
}

function cellKind(cell) {
  if (cell.formula || cell.value?.formula) {
    return "f";
  }
  return typeof cell.value === "number" ? "n" : "s";
}

function printGrid(sheet) {
  process.stdout.write(`\n=== sheet "${sheet.name}" (${sheet.rowCount} rows) ===\n`);
  sheet.eachRow({ includeEmpty: false }, (_row, rowNumber) => {
    const parts = COLUMNS.map((column) => {
      const cell = sheet.getCell(`${column}${rowNumber}`);
      if (cell.value === null || cell.value === undefined || cell.value === "") {
        return null;
      }
      return `${column}[${cellKind(cell)}]=${JSON.stringify(cell.value)}`;
    }).filter((part) => part !== null);
    if (parts.length > 0) {
      process.stdout.write(`r${String(rowNumber).padStart(2, "0")}  ${parts.join("  ")}\n`);
    }
  });
}

/** label -> { 2023, 2024 } for every row of the sheet, read out of the cells themselves. */
function labelledRows(sheet) {
  const found = new Map();
  sheet.eachRow({ includeEmpty: false }, (_row, rowNumber) => {
    const label = String(sheet.getCell(`A${rowNumber}`).value ?? "").trim();
    if (label === "") {
      return;
    }
    found.set(label, {
      2023: cellNumber(sheet.getCell(`B${rowNumber}`).value),
      2024: cellNumber(sheet.getCell(`C${rowNumber}`).value),
    });
  });
  return found;
}

const failures = [];

function check(name, actual, expected, tolerance = 0) {
  const gap = Math.abs(actual - expected);
  const limit = Math.max(tolerance * Math.abs(expected), tolerance === 0 ? 0 : 1e-9);
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

const REVENUE_LABELS = ["Penjualan Produk Beku", "Penjualan Katering Korporat", "Retur & Potongan Penjualan"];
const COGS_LABELS = ["Bahan Baku", "Tenaga Kerja Langsung", "Overhead Pabrik"];
const OPEX_LABELS = [
  "Gaji & Tunjangan",
  "Sewa & Utilitas",
  "Pemasaran",
  "Transportasi & Distribusi",
  "Penyusutan",
  "Administrasi & Umum",
];

function checkSubtotals(rows) {
  process.stdout.write("\n--- subtotals recomputed from the leaf rows ---\n");
  for (const year of [2023, 2024]) {
    const revenue = sumOf(rows, REVENUE_LABELS, year);
    const cogs = sumOf(rows, COGS_LABELS, year);
    const opex = sumOf(rows, OPEX_LABELS, year);
    check(`Pendapatan Bersih ${year}`, rows.get("Pendapatan Bersih")[year], revenue);
    check(`Jumlah Harga Pokok Penjualan ${year}`, rows.get("Jumlah Harga Pokok Penjualan")[year], cogs);
    check(`LABA KOTOR ${year}`, rows.get("LABA KOTOR")[year], revenue - cogs);
    check(`Jumlah Beban Usaha ${year}`, rows.get("Jumlah Beban Usaha")[year], opex);
    check(`LABA USAHA ${year}`, rows.get("LABA USAHA")[year], revenue - cogs - opex);
    const otherNet = sumOf(rows, ["Beban Bunga Pinjaman", "Pendapatan Lain-lain"], year);
    check(`LABA SEBELUM PAJAK ${year}`, rows.get("LABA SEBELUM PAJAK")[year], revenue - cogs - opex + otherNet);
    const tax = rows.get("Beban Pajak Penghasilan (22%)")[year];
    check(`LABA BERSIH ${year}`, rows.get("LABA BERSIH")[year], rows.get("LABA SEBELUM PAJAK")[year] + tax);
  }
}

/** Figure key -> value, rebuilt only from grid cells. */
function derive(rows, ops) {
  const of = (label, year) => rows.get(label)[year];
  const totals = {};
  for (const year of [2023, 2024]) {
    totals[year] = {
      revenue: sumOf(rows, REVENUE_LABELS, year),
      cogs: sumOf(rows, COGS_LABELS, year),
      opex: sumOf(rows, OPEX_LABELS, year),
      operating: of("LABA USAHA", year),
      pretax: of("LABA SEBELUM PAJAK", year),
      tax: -of("Beban Pajak Penghasilan (22%)", year),
      net: of("LABA BERSIH", year),
    };
  }
  const gross = (year) => totals[year].revenue - totals[year].cogs;
  const cash = cellNumber(rows.get("Saldo Kas & Setara Kas per 31 Des 2024")[2024]);
  const burn = cellNumber(rows.get("Rata-rata Burn Kas Bulanan Program Ekspansi")[2024]);
  return {
    "revenue.2023": totals[2023].revenue,
    "revenue.2024": totals[2024].revenue,
    "cogs.2024": totals[2024].cogs,
    "grossProfit.2023": gross(2023),
    "grossProfit.2024": gross(2024),
    "grossMarginPct.2023": (gross(2023) / totals[2023].revenue) * 100,
    "grossMarginPct.2024": (gross(2024) / totals[2024].revenue) * 100,
    "opex.2023": totals[2023].opex,
    "opex.2024": totals[2024].opex,
    "operatingProfit.2024": totals[2024].operating,
    "operatingMarginPct.2024": (totals[2024].operating / totals[2024].revenue) * 100,
    "pretaxProfit.2024": totals[2024].pretax,
    "taxExpense.2024": totals[2024].tax,
    "netProfit.2023": totals[2023].net,
    "netProfit.2024": totals[2024].net,
    "netMarginPct.2024": (totals[2024].net / totals[2024].revenue) * 100,
    "revenueGrowthPct.2024": ((totals[2024].revenue - totals[2023].revenue) / totals[2023].revenue) * 100,
    "netProfitGrowthPct.2024": ((totals[2024].net - totals[2023].net) / totals[2023].net) * 100,
    "cogsRatioPct.2024": (totals[2024].cogs / totals[2024].revenue) * 100,
    "cash.2024": cash,
    monthlyBurn: burn,
    runwayMonths: cash / burn,
    "headcountTotal.2024": ops.get("Jumlah Karyawan Tetap (orang)")[2024] + ops.get("Jumlah Karyawan Harian (orang)")[2024],
    "unitsSold.2024": ops.get("Unit Produk Terjual (pcs)")[2024],
    "avgPricePerUnit.2024": ops.get("Rata-rata Harga Jual per pcs")[2024],
  };
}

function checkCountSheet(ops) {
  process.stdout.write("\n--- counts sheet: whole numbers, no currency format ---\n");
  for (const label of [
    "Jumlah Karyawan Tetap (orang)",
    "Jumlah Karyawan Harian (orang)",
    "Jumlah Gerai Mitra (outlet)",
    "Unit Produk Terjual (pcs)",
    "Kapasitas Produksi (pcs/bulan)",
  ]) {
    const value = ops.get(label)[2024];
    const ok = Number.isInteger(value);
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${label} 2024 = ${value}\n`);
    if (!ok) {
      failures.push(`${label} is not a whole count`);
    }
  }
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(HERE, "input.xlsx"));
  const profit = workbook.getWorksheet("Laba Rugi");
  const operations = workbook.getWorksheet("Operasional");
  printGrid(profit);
  printGrid(operations);

  const rows = labelledRows(profit);
  const ops = labelledRows(operations);
  checkSubtotals(rows);
  checkCountSheet(ops);

  const truth = JSON.parse(readFileSync(join(HERE, "case.json"), "utf8")).truth;
  const derived = derive(rows, ops);
  process.stdout.write("\n--- truth figures re-derived from the grid ---\n");
  for (const figure of truth.figures) {
    if (!(figure.key in derived)) {
      failures.push(`no independent derivation for ${figure.key}`);
      process.stdout.write(`FAIL ${figure.key}: nothing to compare against\n`);
      continue;
    }
    check(figure.key, derived[figure.key], figure.value, Math.max(figure.tolerance, 5e-5));
  }

  process.stdout.write(`\nchecked ${truth.figures.length} figures, ${Object.keys(YEAR_COLUMN).length} periods\n`);
  if (failures.length > 0) {
    process.stdout.write(`FAILURES (${failures.length}):\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("brief-umkm-2y: all subtotals and all truth figures re-derive from the workbook.\n");
}

await main();

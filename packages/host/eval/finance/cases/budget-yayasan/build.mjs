/**
 * Deterministic generator for the `budget-yayasan` eval case.
 *
 * Writes ONE workbook with two sheets — "Anggaran 2024" (plan) and "Realisasi 2024" (actuals) —
 * where the SAME line is worded differently on each sheet, the rows are in a different order, two
 * lines exist only in the plan, two only in the actuals, and both sheets carry subtotal rows that
 * must never be counted as line items.
 *
 * Everything below is fixed data plus plain arithmetic: no randomness, no clock, no import of the
 * Finance engine. The `truth` block is an independent oracle — each figure carries its formula in a
 * comment beside it.
 *
 * All amounts are synthetic. "Yayasan Cahaya Nusantara" is an invented foundation.
 *
 * Run: node packages/host/eval/finance/cases/budget-yayasan/build.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Flag thresholds for this case: a line is flagged when BOTH are breached. */
const FLAG_PCT = 10; // percent, absolute
const FLAG_ABS = 5_000_000; // rupiah, absolute

const BUDGET_SHEET = "Anggaran 2024";
const ACTUAL_SHEET = "Realisasi 2024";

/**
 * The single source of truth for the case. `budgetLabel`/`actualLabel` are deliberately different
 * wordings of the same line; `null` on either side means the line exists on one sheet only.
 */
const LINES = [
  // --- Pendapatan ---
  {
    slug: "donasi-individu",
    category: "revenue",
    budgetLabel: "Donasi individu",
    actualLabel: "Penerimaan donasi perorangan",
    budget: 1_850_000_000,
    actual: 1_642_500_000,
  },
  {
    slug: "hibah-korporasi",
    category: "revenue",
    budgetLabel: "Hibah korporasi",
    actualLabel: "Dana hibah perusahaan",
    budget: 1_200_000_000,
    actual: 1_380_000_000,
  },
  {
    slug: "jasa-pelatihan",
    category: "revenue",
    budgetLabel: "Pendapatan jasa pelatihan",
    actualLabel: "Hasil program pelatihan",
    budget: 450_000_000,
    actual: 468_000_000,
  },
  {
    // Budget-only #1: budgeted interest income that never materialised.
    slug: "bunga-bank",
    category: "revenue",
    budgetLabel: "Pendapatan bunga bank",
    actualLabel: null,
    budget: 25_000_000,
    actual: 0,
  },
  // --- Beban ---
  {
    slug: "gaji-tunjangan",
    category: "cost",
    budgetLabel: "Gaji & tunjangan karyawan",
    actualLabel: "Beban gaji",
    budget: 1_320_000_000,
    actual: 1_398_400_000,
  },
  {
    slug: "program-beasiswa",
    category: "cost",
    budgetLabel: "Program beasiswa",
    actualLabel: "Penyaluran beasiswa",
    budget: 900_000_000,
    actual: 885_000_000,
  },
  {
    slug: "sewa-kantor",
    category: "cost",
    budgetLabel: "Sewa kantor",
    actualLabel: "Biaya sewa gedung",
    budget: 240_000_000,
    actual: 264_000_000,
  },
  {
    slug: "utilitas",
    category: "cost",
    budgetLabel: "Listrik, air & internet",
    actualLabel: "Beban utilitas",
    budget: 96_000_000,
    actual: 101_750_000,
  },
  {
    slug: "perjalanan-dinas",
    category: "cost",
    budgetLabel: "Perjalanan dinas",
    actualLabel: "Biaya perjalanan",
    budget: 150_000_000,
    actual: 118_400_000,
  },
  {
    slug: "atk",
    category: "cost",
    budgetLabel: "ATK",
    actualLabel: "Alat tulis kantor",
    budget: 36_000_000,
    actual: 41_300_000,
  },
  {
    slug: "rapat-konsumsi",
    category: "cost",
    budgetLabel: "Biaya rapat & konsumsi",
    actualLabel: "Beban konsumsi rapat",
    budget: 24_000_000,
    actual: 27_600_000,
  },
  {
    // Budget-only #2: a reserve that was never drawn down.
    slug: "cadangan-darurat",
    category: "cost",
    budgetLabel: "Cadangan dana darurat",
    actualLabel: null,
    budget: 100_000_000,
    actual: 0,
  },
  {
    // Actual-only #1: unbudgeted depreciation.
    slug: "penyusutan-inventaris",
    category: "cost",
    budgetLabel: null,
    actualLabel: "Beban penyusutan inventaris",
    budget: 0,
    actual: 72_000_000,
  },
  {
    // Actual-only #2: unbudgeted repair.
    slug: "perbaikan-atap",
    category: "cost",
    budgetLabel: null,
    actualLabel: "Biaya perbaikan atap kantor",
    budget: 0,
    actual: 58_500_000,
  },
];

/** Row order on the budget sheet (slugs), sections in plan order. */
const BUDGET_ORDER = [
  "donasi-individu",
  "hibah-korporasi",
  "jasa-pelatihan",
  "bunga-bank",
  "gaji-tunjangan",
  "program-beasiswa",
  "sewa-kantor",
  "utilitas",
  "perjalanan-dinas",
  "atk",
  "rapat-konsumsi",
  "cadangan-darurat",
];

/** Actual sheet row order — deliberately scrambled against BUDGET_ORDER, block by block. */
const ACTUAL_REVENUE_ORDER = ["jasa-pelatihan", "donasi-individu", "hibah-korporasi"];
const ACTUAL_COST_ORDER = [
  "atk",
  "perjalanan-dinas",
  "gaji-tunjangan",
  "perbaikan-atap",
  "utilitas",
  "program-beasiswa",
  "penyusutan-inventaris",
  "rapat-konsumsi",
  "sewa-kantor",
];

const bySlug = new Map(LINES.map((line) => [line.slug, line]));

function lineOf(slug) {
  const line = bySlug.get(slug);
  if (!line) {
    throw new Error(`build: unknown slug ${slug}`);
  }
  return line;
}

// ---------------------------------------------------------------------------
// Independent oracle: plain arithmetic, no engine import.
// ---------------------------------------------------------------------------

/** variance = actual - budget (rupiah). */
const variance = (line) => line.actual - line.budget;

/** variancePct = (actual - budget) / budget * 100; null when budget is 0 (undefined percent). */
const variancePct = (line) => (line.budget === 0 ? null : ((line.actual - line.budget) / line.budget) * 100);

/**
 * Flagged when |variance| >= FLAG_ABS AND |variancePct| >= FLAG_PCT.
 * A line with no budget (actual-only) has an undefined percent; an infinite overspend counts as
 * breaching the percent test, so only the rupiah test decides.
 */
function isFlagged(line) {
  const abs = Math.abs(variance(line));
  const pct = variancePct(line);
  const pctBreached = pct === null ? true : Math.abs(pct) >= FLAG_PCT;
  return abs >= FLAG_ABS && pctBreached;
}

/**
 * Revenue over budget is favourable, revenue under budget is unfavourable;
 * cost over budget is unfavourable, cost under budget is favourable. Zero variance is neutral.
 */
function direction(line) {
  const delta = variance(line);
  if (delta === 0) {
    return "neutral";
  }
  const over = delta > 0;
  if (line.category === "revenue") {
    return over ? "favourable" : "unfavourable";
  }
  return over ? "unfavourable" : "favourable";
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

const revenueLines = LINES.filter((line) => line.category === "revenue");
const costLines = LINES.filter((line) => line.category === "cost");

// Totals: plain sums over the line table (subtotal rows on the sheets are NOT re-added).
const budgetRevenue = sum(revenueLines.map((line) => line.budget)); // 1.850M + 1.200M + 450M + 25M
const budgetCost = sum(costLines.map((line) => line.budget));
const actualRevenue = sum(revenueLines.map((line) => line.actual));
const actualCost = sum(costLines.map((line) => line.actual));
const budgetSurplus = budgetRevenue - budgetCost; // surplus = pendapatan - beban
const actualSurplus = actualRevenue - actualCost;

const pctOf = (delta, base) => (base === 0 ? null : (delta / base) * 100);

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

const MONEY_FORMAT = '#,##0;[Red](#,##0)';

function addHeader(sheet, title, amountHeader) {
  sheet.addRow([title]);
  sheet.addRow([]);
  const header = sheet.addRow(["Uraian", amountHeader]);
  header.font = { bold: true };
  sheet.getColumn(1).width = 34;
  sheet.getColumn(2).width = 20;
}

function addSection(sheet, name) {
  const row = sheet.addRow([name]);
  row.font = { bold: true };
}

function addLineRow(sheet, label, amount) {
  const row = sheet.addRow([label, amount]);
  row.getCell(2).numFmt = MONEY_FORMAT;
}

function addSubtotal(sheet, label, amount) {
  const row = sheet.addRow([label, amount]);
  row.font = { bold: true };
  row.getCell(2).numFmt = MONEY_FORMAT;
}

function buildWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "agentforge-eval";
  workbook.created = new Date(Date.UTC(2025, 0, 1)); // fixed: no clock
  workbook.modified = new Date(Date.UTC(2025, 0, 1));

  const budget = workbook.addWorksheet(BUDGET_SHEET);
  addHeader(budget, "Yayasan Cahaya Nusantara - Anggaran Tahun 2024", "Anggaran (Rp)");
  addSection(budget, "Pendapatan");
  for (const slug of BUDGET_ORDER) {
    const line = lineOf(slug);
    if (line.category !== "revenue" || line.budgetLabel === null) {
      continue;
    }
    addLineRow(budget, line.budgetLabel, line.budget);
  }
  addSubtotal(budget, "Subtotal Pendapatan", budgetRevenue);
  budget.addRow([]);
  addSection(budget, "Beban");
  for (const slug of BUDGET_ORDER) {
    const line = lineOf(slug);
    if (line.category !== "cost" || line.budgetLabel === null) {
      continue;
    }
    addLineRow(budget, line.budgetLabel, line.budget);
  }
  addSubtotal(budget, "Subtotal Beban", budgetCost);
  budget.addRow([]);
  addSubtotal(budget, "Surplus/(Defisit) Anggaran", budgetSurplus);

  const actual = workbook.addWorksheet(ACTUAL_SHEET);
  addHeader(actual, "Yayasan Cahaya Nusantara - Realisasi Tahun 2024", "Realisasi (Rp)");
  addSection(actual, "Penerimaan");
  for (const slug of ACTUAL_REVENUE_ORDER) {
    const line = lineOf(slug);
    addLineRow(actual, line.actualLabel, line.actual);
  }
  addSubtotal(actual, "Jumlah Penerimaan", actualRevenue);
  actual.addRow([]);
  addSection(actual, "Pengeluaran");
  for (const slug of ACTUAL_COST_ORDER) {
    const line = lineOf(slug);
    addLineRow(actual, line.actualLabel, line.actual);
  }
  addSubtotal(actual, "Jumlah Pengeluaran", actualCost);
  actual.addRow([]);
  addSubtotal(actual, "Selisih Lebih/(Kurang)", actualSurplus);

  return workbook;
}

// ---------------------------------------------------------------------------
// case.json
// ---------------------------------------------------------------------------

/** Rows that look like data but are totals — a correct reader must skip them. */
const IGNORED_ROWS = [
  "Subtotal Pendapatan",
  "Subtotal Beban",
  "Surplus/(Defisit) Anggaran",
  "Jumlah Penerimaan",
  "Jumlah Pengeluaran",
  "Selisih Lebih/(Kurang)",
];

function buildLineItems() {
  const budgetItems = BUDGET_ORDER.map((slug) => lineOf(slug))
    .filter((line) => line.budgetLabel !== null)
    .map((line) => ({
      label: line.budgetLabel,
      period: BUDGET_SHEET,
      amount: line.budget,
      category: line.category,
    }));
  const actualItems = [...ACTUAL_REVENUE_ORDER, ...ACTUAL_COST_ORDER]
    .map((slug) => lineOf(slug))
    .map((line) => ({
      label: line.actualLabel,
      period: ACTUAL_SHEET,
      amount: line.actual,
      category: line.category,
    }));
  return [...budgetItems, ...actualItems];
}

function buildVariances() {
  return LINES.map((line) => ({
    slug: line.slug,
    category: line.category,
    budgetLabel: line.budgetLabel,
    actualLabel: line.actualLabel,
    budget: line.budget,
    actual: line.actual,
    variance: variance(line), // actual - budget
    variancePct: variancePct(line), // (actual - budget) / budget * 100, null when budget is 0
    direction: direction(line),
    flagged: isFlagged(line),
  }));
}

function buildFigures() {
  const perLine = LINES.flatMap((line) => [
    {
      // variance = actual - budget
      key: `variance.${line.slug}.amount`,
      label: `Selisih ${line.budgetLabel ?? line.actualLabel}`,
      value: variance(line),
      unit: "currency",
      tolerance: 1,
    },
    {
      // variancePct = (actual - budget) / budget * 100; null when the line has no budget
      key: `variance.${line.slug}.pct`,
      label: `Selisih % ${line.budgetLabel ?? line.actualLabel}`,
      value: variancePct(line),
      unit: "percent",
      tolerance: 0.005,
    },
  ]);
  return [
    ...perLine,
    // total budgeted revenue = sum of the four Pendapatan budget lines
    { key: "total.budget.revenue", label: "Total anggaran pendapatan", value: budgetRevenue, unit: "currency", tolerance: 1 },
    // total budgeted cost = sum of the eight Beban budget lines
    { key: "total.budget.cost", label: "Total anggaran beban", value: budgetCost, unit: "currency", tolerance: 1 },
    // budgeted surplus = budgeted revenue - budgeted cost
    { key: "total.budget.surplus", label: "Surplus anggaran", value: budgetSurplus, unit: "currency", tolerance: 1 },
    // total actual revenue = sum of the three Penerimaan lines
    { key: "total.actual.revenue", label: "Total realisasi penerimaan", value: actualRevenue, unit: "currency", tolerance: 1 },
    // total actual cost = sum of the nine Pengeluaran lines
    { key: "total.actual.cost", label: "Total realisasi pengeluaran", value: actualCost, unit: "currency", tolerance: 1 },
    // actual surplus = actual revenue - actual cost
    { key: "total.actual.surplus", label: "Surplus realisasi", value: actualSurplus, unit: "currency", tolerance: 1 },
    // revenue variance = actual revenue - budgeted revenue
    { key: "variance.total.revenue.amount", label: "Selisih pendapatan", value: actualRevenue - budgetRevenue, unit: "currency", tolerance: 1 },
    // revenue variance % = (actual revenue - budgeted revenue) / budgeted revenue * 100
    { key: "variance.total.revenue.pct", label: "Selisih % pendapatan", value: pctOf(actualRevenue - budgetRevenue, budgetRevenue), unit: "percent", tolerance: 0.005 },
    // cost variance = actual cost - budgeted cost
    { key: "variance.total.cost.amount", label: "Selisih beban", value: actualCost - budgetCost, unit: "currency", tolerance: 1 },
    // cost variance % = (actual cost - budgeted cost) / budgeted cost * 100
    { key: "variance.total.cost.pct", label: "Selisih % beban", value: pctOf(actualCost - budgetCost, budgetCost), unit: "percent", tolerance: 0.005 },
    // surplus variance = actual surplus - budgeted surplus
    { key: "variance.total.surplus.amount", label: "Selisih surplus", value: actualSurplus - budgetSurplus, unit: "currency", tolerance: 1 },
    // surplus variance % = (actual surplus - budgeted surplus) / budgeted surplus * 100
    { key: "variance.total.surplus.pct", label: "Selisih % surplus", value: pctOf(actualSurplus - budgetSurplus, budgetSurplus), unit: "percent", tolerance: 0.005 },
    // count of lines breaching BOTH thresholds
    { key: "flagged.count", label: "Jumlah baris yang ditandai", value: LINES.filter(isFlagged).length, unit: "count", tolerance: 0 },
    // lines present in the union of both sheets
    { key: "lines.total", label: "Jumlah baris gabungan", value: LINES.length, unit: "count", tolerance: 0 },
  ];
}

const caseJson = {
  id: "budget-yayasan",
  task: "budget",
  locale: "id",
  currency: "IDR",
  description:
    "Anggaran vs realisasi satu yayasan (sintetis) dalam satu workbook dua sheet. Label baris yang sama ditulis berbeda di tiap sheet, urutan baris berbeda, dua baris hanya ada di anggaran dan dua hanya ada di realisasi, plus baris subtotal yang tidak boleh ikut dihitung.",
  // Both sheets, in plan-then-actuals order: the import route answers one sheet per call and
  // the studio appends each one the reader picks, so the case names both rather than relying on
  // whichever sheet happens to be first in the workbook.
  files: [{ path: "input.xlsx", sheet: BUDGET_SHEET }, { path: "input.xlsx", sheet: ACTUAL_SHEET }],
  prompt:
    "Bandingkan anggaran 2024 dengan realisasinya dari file ini. Cocokkan tiap baris walau namanya berbeda, hitung selisih rupiah dan persennya, dan tandai baris yang melenceng lebih dari 10% sekaligus lebih dari Rp 5.000.000.",
  params: {
    flagPct: FLAG_PCT,
    flagAbs: FLAG_ABS,
    budgetSheet: BUDGET_SHEET,
    actualSheet: ACTUAL_SHEET,
  },
  truth: {
    /** budget label -> actual label, or null when the line has no counterpart. */
    pairing: Object.fromEntries(
      LINES.filter((line) => line.budgetLabel !== null).map((line) => [line.budgetLabel, line.actualLabel]),
    ),
    /** Actual lines with no budget counterpart (unbudgeted spend). */
    actualOnly: LINES.filter((line) => line.budgetLabel === null).map((line) => line.actualLabel),
    /** Budget lines with no actual counterpart (never realised). */
    budgetOnly: LINES.filter((line) => line.actualLabel === null).map((line) => line.budgetLabel),
    /** Total rows on either sheet: never line items. */
    ignoredRows: IGNORED_ROWS,
    thresholds: { pct: FLAG_PCT, abs: FLAG_ABS, rule: "flagged when |variance| >= abs AND |variancePct| >= pct" },
    variances: buildVariances(),
    flagged: LINES.filter(isFlagged).map((line) => line.slug),
    lineItems: buildLineItems(),
    figures: buildFigures(),
    mustMention: ["Beban penyusutan inventaris", "Biaya perbaikan atap kantor", "Cadangan dana darurat"],
    mustNotContain: ["[unverified figure]", "Subtotal Pendapatan", "Jumlah Pengeluaran"],
  },
};

/**
 * exceljs stamps every zip entry with the wall clock, so two builds of identical content differ
 * byte for byte. The parts themselves are already identical; only the DOS date/time in each local
 * and central header moves, so they are walked through the central directory and pinned. Kept
 * inline rather than shared so the case directory stays self-contained.
 */
function pinZipTimestamps(bytes) {
  const pinned = Buffer.from(bytes);
  const dosTime = 0; // 00:00:00
  const dosDate = ((2025 - 1980) << 9) | (1 << 5) | 1; // 2025-01-01
  let eocd = pinned.length - 22;
  while (eocd >= 0 && pinned.readUInt32LE(eocd) !== 0x06054b50) {
    eocd -= 1;
  }
  if (eocd < 0) {
    throw new Error("build: workbook has no zip end-of-central-directory record");
  }
  const count = pinned.readUInt16LE(eocd + 10);
  let offset = pinned.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    const localOffset = pinned.readUInt32LE(offset + 42);
    pinned.writeUInt16LE(dosTime, offset + 12);
    pinned.writeUInt16LE(dosDate, offset + 14);
    pinned.writeUInt16LE(dosTime, localOffset + 10);
    pinned.writeUInt16LE(dosDate, localOffset + 12);
    offset += 46 + pinned.readUInt16LE(offset + 28) + pinned.readUInt16LE(offset + 30) + pinned.readUInt16LE(offset + 32);
  }
  return pinned;
}

async function main() {
  const workbook = buildWorkbook();
  writeFileSync(join(HERE, "input.xlsx"), pinZipTimestamps(await workbook.xlsx.writeBuffer()));
  writeFileSync(join(HERE, "case.json"), `${JSON.stringify(caseJson, null, 2)}\n`, "utf8");
  process.stdout.write(
    `budget-yayasan: wrote input.xlsx (${LINES.length} union lines, ${LINES.filter(isFlagged).length} flagged) and case.json\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`budget-yayasan build failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

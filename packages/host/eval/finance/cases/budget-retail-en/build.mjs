/**
 * Deterministic generator for the `budget-retail-en` eval case.
 *
 * One sheet, budget and actual side by side per quarter (Q1 Budget, Q1 Actual, Q2 Budget, ...),
 * 25 line items across a revenue, a COGS and an operating-expense section, plus the section
 * subtotal and derived rows a real P&L carries. No full-year column: the full-year variance has to
 * be summed, not read.
 *
 * Fixed numbers, no randomness, no clock, no import of the Finance engine. `truth` is an
 * independent oracle computed here with plain arithmetic; every figure carries its formula.
 *
 * All data is synthetic. "Harborline Outfitters" is an invented retailer.
 *
 * Run: node packages/host/eval/finance/cases/budget-retail-en/build.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A line is flagged only when BOTH thresholds are breached. */
const FLAG_PCT = 8; // percent, absolute
const FLAG_ABS = 2_000; // US dollars, absolute

const SHEET_NAME = "Budget vs Actual FY2025";
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];

/**
 * The whole input, written out. `budget` and `actual` are the four quarters in order.
 * Section order here is the row order on the sheet.
 */
const LINES = [
  // --- Revenue ---
  { section: "Revenue", category: "revenue", label: "Net sales - flagship store", budget: [420_000, 435_000, 455_000, 610_000], actual: [398_000, 452_000, 441_000, 655_000] },
  { section: "Revenue", category: "revenue", label: "Net sales - mall kiosks", budget: [185_000, 192_000, 198_000, 265_000], actual: [171_000, 188_000, 214_000, 249_000] },
  { section: "Revenue", category: "revenue", label: "Net sales - online store", budget: [240_000, 262_000, 288_000, 410_000], actual: [281_000, 305_000, 334_000, 486_000] },
  // Flat and exactly on budget every quarter: variance 0, direction neutral, never flagged.
  { section: "Revenue", category: "revenue", label: "Wholesale accounts", budget: [96_000, 96_000, 96_000, 96_000], actual: [96_000, 96_000, 96_000, 96_000] },
  { section: "Revenue", category: "revenue", label: "Gift card breakage", budget: [12_000, 12_500, 13_000, 22_000], actual: [11_200, 13_800, 12_100, 24_500] },
  // Trap: every quarter is +/-15% and +/-$7,500 (flagged), but the year nets to exactly zero.
  { section: "Revenue", category: "revenue", label: "Shipping revenue", budget: [50_000, 50_000, 50_000, 50_000], actual: [57_500, 42_500, 57_500, 42_500] },

  // --- Cost of goods sold ---
  // Trap: +$15,000 a quarter, the largest dollar overspend in the file, but only +5% -> not flagged.
  { section: "Cost of goods sold", category: "cost", label: "Merchandise purchases", budget: [300_000, 300_000, 300_000, 300_000], actual: [315_000, 315_000, 315_000, 315_000] },
  { section: "Cost of goods sold", category: "cost", label: "Inbound freight", budget: [38_000, 39_000, 41_000, 58_000], actual: [41_500, 37_200, 46_800, 62_400] },
  { section: "Cost of goods sold", category: "cost", label: "Packaging materials", budget: [22_000, 23_000, 24_000, 34_000], actual: [20_500, 25_900, 23_100, 38_700] },
  { section: "Cost of goods sold", category: "cost", label: "Inventory shrinkage", budget: [15_000, 15_000, 15_000, 15_000], actual: [18_600, 16_100, 21_400, 19_800] },

  // --- Operating expenses ---
  { section: "Operating expenses", category: "cost", label: "Store payroll", budget: [210_000, 214_000, 219_000, 268_000], actual: [216_500, 225_800, 231_400, 289_600] },
  { section: "Operating expenses", category: "cost", label: "Head office salaries", budget: [148_000, 148_000, 148_000, 152_000], actual: [151_200, 151_200, 156_800, 156_800] },
  { section: "Operating expenses", category: "cost", label: "Payroll taxes & benefits", budget: [64_000, 65_000, 66_000, 79_000], actual: [66_300, 68_900, 70_100, 85_400] },
  // Boundary: exactly +8.00% every quarter, well over the dollar floor -> flagged (the rule is >=).
  { section: "Operating expenses", category: "cost", label: "Rent - flagship store", budget: [40_000, 40_000, 40_000, 40_000], actual: [43_200, 43_200, 43_200, 43_200] },
  { section: "Operating expenses", category: "cost", label: "Rent - mall kiosks", budget: [36_000, 36_000, 36_000, 36_000], actual: [36_000, 36_000, 39_600, 39_600] },
  { section: "Operating expenses", category: "cost", label: "Utilities", budget: [18_000, 16_500, 21_000, 19_500], actual: [19_800, 15_400, 24_300, 21_100] },
  // Trap: +9% but only +$1,800 a quarter (never flagged), yet +$7,200 for the year -> FY flagged.
  { section: "Operating expenses", category: "cost", label: "Bank & card processing fees", budget: [20_000, 20_000, 20_000, 20_000], actual: [21_800, 21_800, 21_800, 21_800] },
  { section: "Operating expenses", category: "cost", label: "Marketing - digital ads", budget: [55_000, 58_000, 62_000, 110_000], actual: [71_500, 69_600, 74_400, 141_900] },
  { section: "Operating expenses", category: "cost", label: "Marketing - print & radio", budget: [24_000, 24_000, 24_000, 30_000], actual: [18_000, 15_600, 21_600, 24_500] },
  // Boundary: exactly +$2,000 and exactly +10.00% every quarter -> flagged on the dollar floor.
  { section: "Operating expenses", category: "cost", label: "Software subscriptions", budget: [20_000, 20_000, 20_000, 20_000], actual: [22_000, 22_000, 22_000, 22_000] },
  { section: "Operating expenses", category: "cost", label: "Professional fees", budget: [15_000, 9_000, 9_000, 27_000], actual: [16_200, 8_100, 11_700, 24_300] },
  // Flat and exactly on budget: variance 0, neutral, never flagged.
  { section: "Operating expenses", category: "cost", label: "Insurance", budget: [11_000, 11_000, 11_000, 11_000], actual: [11_000, 11_000, 11_000, 11_000] },
  { section: "Operating expenses", category: "cost", label: "Repairs & maintenance", budget: [9_000, 9_000, 12_000, 9_000], actual: [7_650, 13_950, 10_200, 9_450] },
  { section: "Operating expenses", category: "cost", label: "Travel & entertainment", budget: [8_000, 8_500, 9_000, 14_000], actual: [6_400, 9_775, 7_650, 11_200] },
  { section: "Operating expenses", category: "cost", label: "Depreciation", budget: [26_000, 26_000, 26_000, 26_000], actual: [26_000, 26_000, 28_600, 28_600] },
];

/** Stable, readable key for a label: lowercase, every run of non-alphanumerics becomes one dash. */
function slugify(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const ROWS = LINES.map((line) => ({ ...line, slug: slugify(line.label) }));

// ---------------------------------------------------------------------------
// Independent oracle: plain arithmetic.
// ---------------------------------------------------------------------------

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** variance = actual - budget. */
const varianceOf = (budget, actual) => actual - budget;

/** variancePct = (actual - budget) / budget * 100; null when budget is 0. */
const variancePctOf = (budget, actual) => (budget === 0 ? null : ((actual - budget) / budget) * 100);

/** Flagged when |variance| >= FLAG_ABS AND |variancePct| >= FLAG_PCT (undefined percent counts as breached). */
function flaggedOf(budget, actual) {
  const delta = actual - budget;
  const pct = variancePctOf(budget, actual);
  const pctBreached = pct === null ? true : Math.abs(pct) >= FLAG_PCT;
  return Math.abs(delta) >= FLAG_ABS && pctBreached;
}

/** Revenue over budget is favourable; cost over budget is unfavourable; zero variance is neutral. */
function directionOf(category, budget, actual) {
  const delta = actual - budget;
  if (delta === 0) {
    return "neutral";
  }
  const over = delta > 0;
  return category === "revenue" ? (over ? "favourable" : "unfavourable") : over ? "unfavourable" : "favourable";
}

function cell(category, budget, actual) {
  return {
    budget,
    actual,
    variance: varianceOf(budget, actual),
    variancePct: variancePctOf(budget, actual),
    direction: directionOf(category, budget, actual),
    flagged: flaggedOf(budget, actual),
  };
}

const VARIANCES = ROWS.map((row) => {
  const quarters = Object.fromEntries(
    QUARTERS.map((quarter, index) => [quarter, cell(row.category, row.budget[index], row.actual[index])]),
  );
  // Full year = sum of the four quarters on each side, then the same variance formulas.
  const fullYear = cell(row.category, sum(row.budget), sum(row.actual));
  return { slug: row.slug, label: row.label, section: row.section, category: row.category, quarters, fullYear };
});

const bySection = (name) => ROWS.filter((row) => row.section === name);

/** Column-wise sum of a group of lines on one side. */
function groupSeries(rows, side) {
  return QUARTERS.map((_, index) => sum(rows.map((row) => row[side][index])));
}

const revenueRows = bySection("Revenue");
const cogsRows = bySection("Cost of goods sold");
const opexRows = bySection("Operating expenses");

const SERIES = {
  revenue: { budget: groupSeries(revenueRows, "budget"), actual: groupSeries(revenueRows, "actual"), category: "revenue" },
  cogs: { budget: groupSeries(cogsRows, "budget"), actual: groupSeries(cogsRows, "actual"), category: "cost" },
  opex: { budget: groupSeries(opexRows, "budget"), actual: groupSeries(opexRows, "actual"), category: "cost" },
};
// grossProfit = total revenue - total COGS, quarter by quarter.
SERIES.grossProfit = {
  budget: QUARTERS.map((_, i) => SERIES.revenue.budget[i] - SERIES.cogs.budget[i]),
  actual: QUARTERS.map((_, i) => SERIES.revenue.actual[i] - SERIES.cogs.actual[i]),
  category: "revenue",
};
// operatingIncome = gross profit - total operating expenses, quarter by quarter.
SERIES.operatingIncome = {
  budget: QUARTERS.map((_, i) => SERIES.grossProfit.budget[i] - SERIES.opex.budget[i]),
  actual: QUARTERS.map((_, i) => SERIES.grossProfit.actual[i] - SERIES.opex.actual[i]),
  category: "revenue",
};

const AGGREGATES = Object.fromEntries(
  Object.entries(SERIES).map(([name, series]) => [
    name,
    {
      quarters: Object.fromEntries(
        QUARTERS.map((quarter, index) => [quarter, cell(series.category, series.budget[index], series.actual[index])]),
      ),
      fullYear: cell(series.category, sum(series.budget), sum(series.actual)),
    },
  ]),
);

const FLAGGED = Object.fromEntries([
  ...QUARTERS.map((quarter) => [quarter, VARIANCES.filter((row) => row.quarters[quarter].flagged).map((row) => row.slug)]),
  ["FY", VARIANCES.filter((row) => row.fullYear.flagged).map((row) => row.slug)],
]);

// ---------------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------------

const MONEY_FORMAT = '#,##0;[Red](#,##0)';
/** Rows the sheet carries that are sums or differences of other rows — never line items. */
const DERIVED_ROWS = ["Total revenue", "Total cost of goods sold", "Gross profit", "Total operating expenses", "Operating income"];

function amountRow(sheet, label, budgets, actuals, bold) {
  const values = [label];
  QUARTERS.forEach((_, index) => {
    values.push(budgets[index], actuals[index]);
  });
  const row = sheet.addRow(values);
  for (let column = 2; column <= 9; column += 1) {
    row.getCell(column).numFmt = MONEY_FORMAT;
  }
  if (bold) {
    row.font = { bold: true };
  }
  return row;
}

function buildWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "agentforge-eval";
  workbook.created = new Date(Date.UTC(2025, 0, 1)); // fixed: no clock
  workbook.modified = new Date(Date.UTC(2025, 0, 1));
  const sheet = workbook.addWorksheet(SHEET_NAME);

  sheet.addRow(["Harborline Outfitters - FY2025 budget vs actual (USD)"]);
  sheet.addRow([]);
  const header = sheet.addRow(["Line item", ...QUARTERS.flatMap((quarter) => [`${quarter} Budget`, `${quarter} Actual`])]);
  header.font = { bold: true };
  sheet.getColumn(1).width = 32;
  for (let column = 2; column <= 9; column += 1) {
    sheet.getColumn(column).width = 14;
  }

  for (const section of ["Revenue", "Cost of goods sold", "Operating expenses"]) {
    const sectionRow = sheet.addRow([section]);
    sectionRow.font = { bold: true };
    for (const row of bySection(section)) {
      amountRow(sheet, row.label, row.budget, row.actual, false);
    }
    if (section === "Revenue") {
      amountRow(sheet, "Total revenue", SERIES.revenue.budget, SERIES.revenue.actual, true);
    }
    if (section === "Cost of goods sold") {
      amountRow(sheet, "Total cost of goods sold", SERIES.cogs.budget, SERIES.cogs.actual, true);
      amountRow(sheet, "Gross profit", SERIES.grossProfit.budget, SERIES.grossProfit.actual, true);
    }
    if (section === "Operating expenses") {
      amountRow(sheet, "Total operating expenses", SERIES.opex.budget, SERIES.opex.actual, true);
      amountRow(sheet, "Operating income", SERIES.operatingIncome.budget, SERIES.operatingIncome.actual, true);
    }
    sheet.addRow([]);
  }

  return workbook;
}

// ---------------------------------------------------------------------------
// case.json
// ---------------------------------------------------------------------------

function buildLineItems() {
  return ROWS.flatMap((row) =>
    QUARTERS.flatMap((quarter, index) => [
      { label: row.label, period: `${quarter} Budget`, amount: row.budget[index], category: row.category },
      { label: row.label, period: `${quarter} Actual`, amount: row.actual[index], category: row.category },
    ]),
  );
}

function buildFigures() {
  const perLine = VARIANCES.flatMap((row) => [
    {
      // FY variance = sum(actual Q1..Q4) - sum(budget Q1..Q4)
      key: `variance.fy.${row.slug}.amount`,
      label: `FY variance - ${row.label}`,
      value: row.fullYear.variance,
      unit: "currency",
      tolerance: 0.5,
    },
    {
      // FY variance % = FY variance / sum(budget Q1..Q4) * 100
      key: `variance.fy.${row.slug}.pct`,
      label: `FY variance % - ${row.label}`,
      value: row.fullYear.variancePct,
      unit: "percent",
      tolerance: 0.005,
    },
  ]);

  const aggregateFigures = Object.entries(AGGREGATES).flatMap(([name, aggregate]) => [
    // FY budget for the aggregate = sum of its four budgeted quarters
    { key: `total.fy.${name}.budget`, label: `FY budget - ${name}`, value: aggregate.fullYear.budget, unit: "currency", tolerance: 0.5 },
    // FY actual for the aggregate = sum of its four actual quarters
    { key: `total.fy.${name}.actual`, label: `FY actual - ${name}`, value: aggregate.fullYear.actual, unit: "currency", tolerance: 0.5 },
    // FY variance = FY actual - FY budget
    { key: `variance.fy.total.${name}.amount`, label: `FY variance - ${name}`, value: aggregate.fullYear.variance, unit: "currency", tolerance: 0.5 },
    // FY variance % = FY variance / FY budget * 100
    { key: `variance.fy.total.${name}.pct`, label: `FY variance % - ${name}`, value: aggregate.fullYear.variancePct, unit: "percent", tolerance: 0.005 },
    // per-quarter variance = quarter actual - quarter budget
    ...QUARTERS.map((quarter) => ({
      key: `variance.${quarter.toLowerCase()}.total.${name}.amount`,
      label: `${quarter} variance - ${name}`,
      value: aggregate.quarters[quarter].variance,
      unit: "currency",
      tolerance: 0.5,
    })),
  ]);

  const flagCounts = Object.entries(FLAGGED).map(([period, slugs]) => ({
    // count of lines breaching both thresholds in that period
    key: `flagged.${period.toLowerCase()}.count`,
    label: `Flagged lines - ${period}`,
    value: slugs.length,
    unit: "count",
    tolerance: 0,
  }));

  return [
    ...perLine,
    ...aggregateFigures,
    ...flagCounts,
    { key: "lines.total", label: "Line items on the sheet", value: ROWS.length, unit: "count", tolerance: 0 },
  ];
}

const caseJson = {
  id: "budget-retail-en",
  task: "budget",
  locale: "en",
  currency: "USD",
  description:
    "Synthetic FY2025 budget-vs-actual for an invented retailer. One sheet, budget and actual side by side per quarter, 25 lines across revenue, COGS and operating expenses, with section subtotals and derived rows that must not be counted as lines. There is no full-year column: the full-year variance has to be summed.",
  files: [{ path: "input.xlsx", sheet: SHEET_NAME }],
  prompt:
    "Take this FY2025 budget-vs-actual sheet and give me the variance for every line, per quarter and for the full year. Flag anything off by more than 8% and more than $2,000, and tell me whether each one is favourable or unfavourable.",
  params: {
    flagPct: FLAG_PCT,
    flagAbs: FLAG_ABS,
    sheet: SHEET_NAME,
    quarters: QUARTERS,
  },
  truth: {
    thresholds: { pct: FLAG_PCT, abs: FLAG_ABS, rule: "flagged when |variance| >= abs AND |variancePct| >= pct" },
    /** Sums and differences printed on the sheet: never line items, never re-added to a total. */
    ignoredRows: DERIVED_ROWS,
    /** Per line: one cell per quarter plus the full year, each with variance, percent, direction, flag. */
    variances: VARIANCES,
    /** Section and P&L aggregates, same shape as a line. */
    aggregates: AGGREGATES,
    /** Slugs breaching both thresholds, per quarter and for the full year. */
    flagged: FLAGGED,
    lineItems: buildLineItems(),
    figures: buildFigures(),
    mustMention: ["Marketing - digital ads", "Net sales - online store"],
    mustNotContain: ["[unverified figure]", "Total revenue", "Operating income"],
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
    `budget-retail-en: wrote input.xlsx (${ROWS.length} lines) and case.json (FY flagged: ${FLAGGED.FY.length}; Q1 ${FLAGGED.Q1.length}, Q2 ${FLAGGED.Q2.length}, Q3 ${FLAGGED.Q3.length}, Q4 ${FLAGGED.Q4.length})\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`budget-retail-en build failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

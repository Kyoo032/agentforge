/**
 * Independent checker for `budget-yayasan`.
 *
 * Re-opens input.xlsx with exceljs, re-reads every amount off the two sheets, re-derives the
 * pairing map, the variances, the flag set and the totals, and compares all of it against
 * case.json. It shares no code with build.mjs on purpose: the arithmetic is written out again.
 *
 * Run: node packages/host/eval/finance/cases/budget-yayasan/verify.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));
const failures = [];

function check(name, actual, expected, tolerance = 0) {
  if (actual === null || expected === null) {
    if (actual !== expected) {
      failures.push(`${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
    }
    return;
  }
  const delta = Math.abs(Number(actual) - Number(expected));
  if (!(delta <= tolerance)) {
    failures.push(`${name}: got ${actual}, want ${expected} (delta ${delta} > tol ${tolerance})`);
  }
}

function checkDeep(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures.push(`${name}:\n  got  ${a}\n  want ${b}`);
  }
}

/** Reads "label -> amount" pairs off a sheet, skipping headers, blanks and the given total rows. */
function readSheet(sheet, skipLabels) {
  const rows = new Map();
  sheet.eachRow((row) => {
    const label = String(row.getCell(1).value ?? "").trim();
    const raw = row.getCell(2).value;
    if (!label || typeof raw !== "number") {
      return;
    }
    if (skipLabels.has(label)) {
      return;
    }
    rows.set(label, raw);
  });
  return rows;
}

async function main() {
  const caseJson = JSON.parse(readFileSync(join(HERE, "case.json"), "utf8"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(HERE, "input.xlsx"));

  const skip = new Set(caseJson.truth.ignoredRows);
  const budgetSheet = workbook.getWorksheet(caseJson.params.budgetSheet);
  const actualSheet = workbook.getWorksheet(caseJson.params.actualSheet);
  if (!budgetSheet || !actualSheet) {
    throw new Error("verify: expected both sheets in the workbook");
  }
  const budgetRows = readSheet(budgetSheet, skip);
  const actualRows = readSheet(actualSheet, skip);

  // --- the sheets themselves match what truth claims is on them ---
  const truthBudgetLabels = caseJson.truth.lineItems
    .filter((item) => item.period === caseJson.params.budgetSheet)
    .map((item) => item.label);
  const truthActualLabels = caseJson.truth.lineItems
    .filter((item) => item.period === caseJson.params.actualSheet)
    .map((item) => item.label);
  checkDeep("budget sheet labels", [...budgetRows.keys()], truthBudgetLabels);
  checkDeep("actual sheet labels", [...actualRows.keys()], truthActualLabels);
  for (const item of caseJson.truth.lineItems) {
    const source = item.period === caseJson.params.budgetSheet ? budgetRows : actualRows;
    check(`lineItem ${item.period} / ${item.label}`, source.get(item.label), item.amount, 0);
  }

  // --- the pairing map points at labels that really exist on the other sheet ---
  for (const [budgetLabel, actualLabel] of Object.entries(caseJson.truth.pairing)) {
    if (!budgetRows.has(budgetLabel)) {
      failures.push(`pairing: budget label "${budgetLabel}" is not on the budget sheet`);
    }
    if (actualLabel !== null && !actualRows.has(actualLabel)) {
      failures.push(`pairing: actual label "${actualLabel}" is not on the actuals sheet`);
    }
  }
  const pairedActuals = new Set(Object.values(caseJson.truth.pairing).filter((value) => value !== null));
  const unpairedActuals = [...actualRows.keys()].filter((label) => !pairedActuals.has(label));
  checkDeep("actualOnly", unpairedActuals.sort(), [...caseJson.truth.actualOnly].sort());
  const unpairedBudget = Object.entries(caseJson.truth.pairing)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  checkDeep("budgetOnly", unpairedBudget.sort(), [...caseJson.truth.budgetOnly].sort());

  // --- variances, re-derived from the cells ---
  const pct = caseJson.params.flagPct;
  const abs = caseJson.params.flagAbs;
  const recomputedFlags = [];
  for (const entry of caseJson.truth.variances) {
    const budgetAmount = entry.budgetLabel === null ? 0 : (budgetRows.get(entry.budgetLabel) ?? Number.NaN);
    const actualAmount = entry.actualLabel === null ? 0 : (actualRows.get(entry.actualLabel) ?? Number.NaN);
    check(`variance ${entry.slug} budget cell`, budgetAmount, entry.budget, 0);
    check(`variance ${entry.slug} actual cell`, actualAmount, entry.actual, 0);

    const delta = actualAmount - budgetAmount;
    check(`variance ${entry.slug} amount`, delta, entry.variance, 0);
    const deltaPct = budgetAmount === 0 ? null : (100 * delta) / budgetAmount;
    check(`variance ${entry.slug} pct`, deltaPct, entry.variancePct, 1e-9);

    const percentBreached = deltaPct === null ? true : Math.abs(deltaPct) >= pct;
    const flagged = Math.abs(delta) >= abs && percentBreached;
    if (flagged !== entry.flagged) {
      failures.push(`flag ${entry.slug}: got ${flagged}, want ${entry.flagged}`);
    }
    if (flagged) {
      recomputedFlags.push(entry.slug);
    }

    const expectedDirection =
      delta === 0
        ? "neutral"
        : entry.category === "revenue"
          ? delta > 0
            ? "favourable"
            : "unfavourable"
          : delta > 0
            ? "unfavourable"
            : "favourable";
    if (expectedDirection !== entry.direction) {
      failures.push(`direction ${entry.slug}: got ${expectedDirection}, want ${entry.direction}`);
    }
  }
  checkDeep("flagged set", recomputedFlags, caseJson.truth.flagged);

  // --- totals, re-summed from the cells (subtotal rows excluded by `skip`) ---
  const categoryOf = new Map(caseJson.truth.variances.map((entry) => [entry.slug, entry.category]));
  const sumBy = (entries, side, category) =>
    entries
      .filter((entry) => categoryOf.get(entry.slug) === category)
      .reduce((total, entry) => {
        const label = side === "budget" ? entry.budgetLabel : entry.actualLabel;
        const rows = side === "budget" ? budgetRows : actualRows;
        return total + (label === null ? 0 : (rows.get(label) ?? 0));
      }, 0);

  const budgetRevenue = sumBy(caseJson.truth.variances, "budget", "revenue");
  const budgetCost = sumBy(caseJson.truth.variances, "budget", "cost");
  const actualRevenue = sumBy(caseJson.truth.variances, "actual", "revenue");
  const actualCost = sumBy(caseJson.truth.variances, "actual", "cost");

  const figures = new Map(caseJson.truth.figures.map((figure) => [figure.key, figure]));
  const want = (key) => {
    const figure = figures.get(key);
    if (!figure) {
      failures.push(`figure ${key} missing from case.json`);
      return { value: Number.NaN, tolerance: 0 };
    }
    return figure;
  };
  const expect = (key, value) => {
    const figure = want(key);
    check(`figure ${key}`, value, figure.value, figure.tolerance);
  };

  expect("total.budget.revenue", budgetRevenue);
  expect("total.budget.cost", budgetCost);
  expect("total.budget.surplus", budgetRevenue - budgetCost);
  expect("total.actual.revenue", actualRevenue);
  expect("total.actual.cost", actualCost);
  expect("total.actual.surplus", actualRevenue - actualCost);
  expect("variance.total.revenue.amount", actualRevenue - budgetRevenue);
  expect("variance.total.revenue.pct", (100 * (actualRevenue - budgetRevenue)) / budgetRevenue);
  expect("variance.total.cost.amount", actualCost - budgetCost);
  expect("variance.total.cost.pct", (100 * (actualCost - budgetCost)) / budgetCost);
  expect(
    "variance.total.surplus.amount",
    actualRevenue - actualCost - (budgetRevenue - budgetCost),
  );
  expect(
    "variance.total.surplus.pct",
    (100 * (actualRevenue - actualCost - (budgetRevenue - budgetCost))) / (budgetRevenue - budgetCost),
  );
  expect("flagged.count", recomputedFlags.length);
  expect("lines.total", caseJson.truth.variances.length);

  // --- per-line figures agree with the per-line variance table ---
  for (const entry of caseJson.truth.variances) {
    const amountFigure = want(`variance.${entry.slug}.amount`);
    check(`figure variance.${entry.slug}.amount`, entry.variance, amountFigure.value, amountFigure.tolerance);
    const pctFigure = want(`variance.${entry.slug}.pct`);
    check(`figure variance.${entry.slug}.pct`, entry.variancePct, pctFigure.value, pctFigure.tolerance);
  }

  // --- the subtotal rows on the sheets equal the sums, so the traps are real ---
  const rawBudget = readSheet(budgetSheet, new Set());
  const rawActual = readSheet(actualSheet, new Set());
  check("sheet Subtotal Pendapatan", rawBudget.get("Subtotal Pendapatan"), budgetRevenue, 0);
  check("sheet Subtotal Beban", rawBudget.get("Subtotal Beban"), budgetCost, 0);
  check("sheet Jumlah Penerimaan", rawActual.get("Jumlah Penerimaan"), actualRevenue, 0);
  check("sheet Jumlah Pengeluaran", rawActual.get("Jumlah Pengeluaran"), actualCost, 0);

  const checked = caseJson.truth.figures.length + caseJson.truth.lineItems.length + caseJson.truth.variances.length;
  if (failures.length > 0) {
    process.stderr.write(`budget-yayasan verify FAILED (${failures.length}):\n- ${failures.join("\n- ")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `budget-yayasan verify OK: ${caseJson.truth.lineItems.length} line items, ${caseJson.truth.variances.length} variances, ${caseJson.truth.figures.length} figures, ${caseJson.truth.flagged.length} flagged (${checked} assertions).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`budget-yayasan verify crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

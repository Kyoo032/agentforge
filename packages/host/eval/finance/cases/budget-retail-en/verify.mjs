/**
 * Independent checker for `budget-retail-en`.
 *
 * Re-opens input.xlsx with exceljs, reads the eight quarterly columns off every row, and re-derives
 * every per-quarter and full-year variance, every flag, the section aggregates and the derived P&L
 * rows, then compares all of it with case.json. Written separately from build.mjs on purpose.
 *
 * Run: node packages/host/eval/finance/cases/budget-retail-en/verify.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const HERE = dirname(fileURLToPath(import.meta.url));
const failures = [];
let assertions = 0;

function check(name, actual, expected, tolerance = 0) {
  assertions += 1;
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

function checkEqual(name, actual, expected) {
  assertions += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    failures.push(`${name}:\n  got  ${a}\n  want ${b}`);
  }
}

/** label -> { budget: [q1..q4], actual: [q1..q4] } for every row that carries eight numbers. */
function readSheet(sheet) {
  const rows = new Map();
  sheet.eachRow((row) => {
    const label = String(row.getCell(1).value ?? "").trim();
    if (!label) {
      return;
    }
    const numbers = [];
    for (let column = 2; column <= 9; column += 1) {
      const value = row.getCell(column).value;
      if (typeof value !== "number") {
        return;
      }
      numbers.push(value);
    }
    rows.set(label, {
      budget: [numbers[0], numbers[2], numbers[4], numbers[6]],
      actual: [numbers[1], numbers[3], numbers[5], numbers[7]],
    });
  });
  return rows;
}

const total = (values) => values.reduce((carry, value) => carry + value, 0);

async function main() {
  const caseJson = JSON.parse(readFileSync(join(HERE, "case.json"), "utf8"));
  const { flagPct, flagAbs, quarters } = caseJson.params;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(join(HERE, "input.xlsx"));
  const sheet = workbook.getWorksheet(caseJson.params.sheet);
  if (!sheet) {
    throw new Error(`verify: sheet "${caseJson.params.sheet}" is missing`);
  }
  const rows = readSheet(sheet);

  // The header row must spell out budget/actual per quarter in the order verify assumes.
  const headerRow = sheet.getRow(3);
  const headers = [];
  for (let column = 1; column <= 9; column += 1) {
    headers.push(String(headerRow.getCell(column).value ?? ""));
  }
  checkEqual("header row", headers, [
    "Line item",
    ...quarters.flatMap((quarter) => [`${quarter} Budget`, `${quarter} Actual`]),
  ]);

  // Only the 25 line items plus the five derived rows carry eight numbers.
  const lineLabels = caseJson.truth.variances.map((entry) => entry.label);
  checkEqual("rows on sheet", [...rows.keys()].sort(), [...lineLabels, ...caseJson.truth.ignoredRows].sort());

  // --- per line: cells, variance, percent, direction, flag ---
  const recomputedFlags = Object.fromEntries([...quarters, "FY"].map((period) => [period, []]));

  const derive = (category, budget, actual) => {
    const variance = actual - budget;
    const variancePct = budget === 0 ? null : (variance * 100) / budget;
    const pctOk = variancePct === null ? true : Math.abs(variancePct) >= flagPct;
    const flagged = Math.abs(variance) >= flagAbs && pctOk;
    const direction =
      variance === 0
        ? "neutral"
        : category === "revenue"
          ? variance > 0
            ? "favourable"
            : "unfavourable"
          : variance > 0
            ? "unfavourable"
            : "favourable";
    return { variance, variancePct, direction, flagged };
  };

  const compareCell = (name, category, budget, actual, expected) => {
    check(`${name} budget`, budget, expected.budget, 0);
    check(`${name} actual`, actual, expected.actual, 0);
    const got = derive(category, budget, actual);
    check(`${name} variance`, got.variance, expected.variance, 0);
    check(`${name} variancePct`, got.variancePct, expected.variancePct, 1e-9);
    checkEqual(`${name} direction`, got.direction, expected.direction);
    checkEqual(`${name} flagged`, got.flagged, expected.flagged);
    return got;
  };

  for (const entry of caseJson.truth.variances) {
    const row = rows.get(entry.label);
    if (!row) {
      failures.push(`line "${entry.label}" is not on the sheet`);
      continue;
    }
    quarters.forEach((quarter, index) => {
      const got = compareCell(
        `${entry.slug}/${quarter}`,
        entry.category,
        row.budget[index],
        row.actual[index],
        entry.quarters[quarter],
      );
      if (got.flagged) {
        recomputedFlags[quarter].push(entry.slug);
      }
    });
    const got = compareCell(
      `${entry.slug}/FY`,
      entry.category,
      total(row.budget),
      total(row.actual),
      entry.fullYear,
    );
    if (got.flagged) {
      recomputedFlags.FY.push(entry.slug);
    }
  }

  for (const period of [...quarters, "FY"]) {
    checkEqual(`flagged ${period}`, recomputedFlags[period], caseJson.truth.flagged[period]);
  }

  // --- aggregates, re-summed from the line rows (not read off the derived sheet rows) ---
  const linesIn = (section) => caseJson.truth.variances.filter((entry) => entry.section === section);
  const seriesOf = (entries, side) =>
    quarters.map((_, index) => total(entries.map((entry) => rows.get(entry.label)[side][index])));

  const revenue = { budget: seriesOf(linesIn("Revenue"), "budget"), actual: seriesOf(linesIn("Revenue"), "actual") };
  const cogs = { budget: seriesOf(linesIn("Cost of goods sold"), "budget"), actual: seriesOf(linesIn("Cost of goods sold"), "actual") };
  const opex = { budget: seriesOf(linesIn("Operating expenses"), "budget"), actual: seriesOf(linesIn("Operating expenses"), "actual") };
  const minus = (a, b) => quarters.map((_, index) => a[index] - b[index]);
  const grossProfit = { budget: minus(revenue.budget, cogs.budget), actual: minus(revenue.actual, cogs.actual) };
  const operatingIncome = { budget: minus(grossProfit.budget, opex.budget), actual: minus(grossProfit.actual, opex.actual) };

  const computed = { revenue, cogs, opex, grossProfit, operatingIncome };
  const categoryOf = { revenue: "revenue", cogs: "cost", opex: "cost", grossProfit: "revenue", operatingIncome: "revenue" };

  for (const [name, series] of Object.entries(computed)) {
    const expected = caseJson.truth.aggregates[name];
    if (!expected) {
      failures.push(`aggregate ${name} missing from case.json`);
      continue;
    }
    quarters.forEach((quarter, index) => {
      compareCell(`agg ${name}/${quarter}`, categoryOf[name], series.budget[index], series.actual[index], expected.quarters[quarter]);
    });
    compareCell(`agg ${name}/FY`, categoryOf[name], total(series.budget), total(series.actual), expected.fullYear);
  }

  // The derived rows printed on the sheet must equal the sums we just computed.
  const sheetRowFor = { "Total revenue": revenue, "Total cost of goods sold": cogs, "Gross profit": grossProfit, "Total operating expenses": opex, "Operating income": operatingIncome };
  for (const [label, series] of Object.entries(sheetRowFor)) {
    const row = rows.get(label);
    if (!row) {
      failures.push(`derived row "${label}" is not on the sheet`);
      continue;
    }
    quarters.forEach((quarter, index) => {
      check(`sheet ${label} ${quarter} budget`, row.budget[index], series.budget[index], 0);
      check(`sheet ${label} ${quarter} actual`, row.actual[index], series.actual[index], 0);
    });
  }

  // --- figures ---
  const figures = new Map(caseJson.truth.figures.map((figure) => [figure.key, figure]));
  const expectFigure = (key, value) => {
    const figure = figures.get(key);
    if (!figure) {
      failures.push(`figure ${key} missing from case.json`);
      return;
    }
    check(`figure ${key}`, value, figure.value, figure.tolerance);
  };

  for (const entry of caseJson.truth.variances) {
    const row = rows.get(entry.label);
    const fyBudget = total(row.budget);
    const fyVariance = total(row.actual) - fyBudget;
    expectFigure(`variance.fy.${entry.slug}.amount`, fyVariance);
    expectFigure(`variance.fy.${entry.slug}.pct`, fyBudget === 0 ? null : (fyVariance * 100) / fyBudget);
  }
  for (const [name, series] of Object.entries(computed)) {
    const fyBudget = total(series.budget);
    const fyActual = total(series.actual);
    expectFigure(`total.fy.${name}.budget`, fyBudget);
    expectFigure(`total.fy.${name}.actual`, fyActual);
    expectFigure(`variance.fy.total.${name}.amount`, fyActual - fyBudget);
    expectFigure(`variance.fy.total.${name}.pct`, fyBudget === 0 ? null : ((fyActual - fyBudget) * 100) / fyBudget);
    quarters.forEach((quarter, index) => {
      expectFigure(`variance.${quarter.toLowerCase()}.total.${name}.amount`, series.actual[index] - series.budget[index]);
    });
  }
  for (const period of [...quarters, "FY"]) {
    expectFigure(`flagged.${period.toLowerCase()}.count`, recomputedFlags[period].length);
  }
  expectFigure("lines.total", caseJson.truth.variances.length);

  // --- lineItems mirror the cells ---
  for (const item of caseJson.truth.lineItems) {
    const [quarter, side] = item.period.split(" ");
    const index = quarters.indexOf(quarter);
    const row = rows.get(item.label);
    check(`lineItem ${item.label} ${item.period}`, row[side.toLowerCase()][index], item.amount, 0);
  }

  if (failures.length > 0) {
    process.stderr.write(`budget-retail-en verify FAILED (${failures.length}):\n- ${failures.slice(0, 40).join("\n- ")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `budget-retail-en verify OK: ${caseJson.truth.variances.length} lines x 5 periods, ${Object.keys(caseJson.truth.aggregates).length} aggregates, ${caseJson.truth.figures.length} figures, FY flagged ${caseJson.truth.flagged.FY.length} (${assertions} assertions).\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`budget-retail-en verify crashed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

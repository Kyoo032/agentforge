/**
 * Independent checker for `cashflow-startup-burn`. Written against the FILE: it re-parses the generated
 * CSV, re-aggregates every month from the signed amounts, re-derives every figure in case.json and
 * compares. It never imports build.mjs and never imports the finance engine.
 *
 * Run from `packages/host`:  node eval/finance/cases/cashflow-startup-burn/verify.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FINANCING_CATEGORY = "Financing";
const EXPECTED_COLUMNS = ["date", "category", "direction", "amount"];

const failures = [];
const record = (message) => failures.push(message);

/** `tolerance` in case.json is relative; tiny values fall back to an absolute floor of 1. */
function close(actual, expected, tolerance) {
  return Math.abs(actual - expected) <= tolerance * Math.max(Math.abs(expected), 1);
}

function expectFigure(figures, key, actual) {
  const figure = figures.find((entry) => entry.key === key);
  if (!figure) {
    record(`missing figure ${key}`);
    return;
  }
  if (!close(actual, figure.value, figure.tolerance)) {
    record(`${key}: file says ${actual}, case.json says ${figure.value} (tolerance ${figure.tolerance})`);
  }
}

// -------------------------------------------------------------- read back ----

const caseJson = JSON.parse(await readFile(join(HERE, "case.json"), "utf8"));
const [file] = caseJson.files;
const text = await readFile(join(HERE, file.path), "utf8");
const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
const header = lines[0].split(",").map((cell) => cell.trim());
if (header.join(",") !== EXPECTED_COLUMNS.join(",")) {
  throw new Error(`unexpected CSV header: ${header.join(",")}`);
}

const rows = lines.slice(1).map((line, index) => {
  const [date, category, direction, amount] = line.split(",");
  const parsed = Number(amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    record(`row ${index + 2}: "${date}" is not an ISO date`);
  }
  if (direction !== "in" && direction !== "out") {
    record(`row ${index + 2}: direction "${direction}" is neither in nor out`);
  }
  if (!Number.isFinite(parsed)) {
    record(`row ${index + 2}: amount "${amount}" is not a number`);
  }
  return { date, category, direction, amount: parsed };
});

// ---------------------------------------------------------- re-derivation ----

const sum = (list) => list.reduce((total, value) => total + value, 0);
const average = (list) => sum(list) / list.length;
const monthOf = (row) => row.date.slice(0, 7);
const isFinancing = (row) => row.category === FINANCING_CATEGORY;
const KEYS = [...new Set(rows.map(monthOf))].sort();

const totalFor = (key, keep) => sum(rows.filter((row) => monthOf(row) === key && keep(row)).map((row) => row.amount));

// Signed amounts only. `direction` is never turned back into a sign, so the four reversals net correctly.
const operatingIn = KEYS.map((key) => totalFor(key, (row) => row.direction === "in" && !isFinancing(row)));
const operatingOut = KEYS.map((key) => -totalFor(key, (row) => row.direction === "out"));
const financingIn = KEYS.map((key) => totalFor(key, isFinancing));
const netOperating = KEYS.map((_, i) => operatingIn[i] - operatingOut[i]);
const netTotal = KEYS.map((_, i) => netOperating[i] + financingIn[i]);

const openingCash = caseJson.params.openingCash;
const closing = netTotal.map((_, i) => netTotal.slice(0, i + 1).reduce((total, net) => total + net, openingCash));
const closingCash = closing.at(-1);

const grossBurnLast3 = average(operatingOut.slice(-3));
const netBurnLast3 = average(netOperating.slice(-3).map((net) => -net));
const runwayMonths = closingCash / netBurnLast3;
const hiringCost = caseJson.params.newEngineers * caseJson.params.costPerEngineer;

// ------------------------------------------------ traps that must survive ----

/** A reversal is a row whose sign disagrees with its `direction` label. */
const agreesWithDirection = (row) => (row.direction === "out" ? row.amount < 0 : row.amount > 0);
const reversals = rows.filter((row) => !agreesWithDirection(row));
if (reversals.length !== 4) {
  record(`expected 4 reversal rows whose sign disagrees with direction, found ${reversals.length}`);
}
// A reader that re-applies a sign from `direction` reads magnitudes and double-negates the refunds.
const naiveOut = sum(rows.filter((row) => row.direction === "out").map((row) => Math.abs(row.amount)));
const naiveGap = naiveOut - sum(operatingOut);
if (naiveGap <= 0) {
  record("the signed and magnitude-only readings of the out rows are identical — the reversal trap is gone");
}
const financingMonths = financingIn.filter((value) => value !== 0);
if (financingMonths.length !== 1) {
  record(`expected exactly one financing month, found ${financingMonths.length}`);
}

// --------------------------------------------------------------- compare ----

const { figures, lineItems } = caseJson.truth;

KEYS.forEach((key, i) => {
  expectFigure(figures, `operatingCashIn.${key}`, operatingIn[i]);
  expectFigure(figures, `operatingCashOut.${key}`, operatingOut[i]);
  expectFigure(figures, `netOperatingCashFlow.${key}`, netOperating[i]);
  expectFigure(figures, `closingCash.${key}`, closing[i]);
});
expectFigure(figures, "financingInflow.2024-05", financingIn[KEYS.indexOf("2024-05")]);
expectFigure(figures, "operatingCashIn.total", sum(operatingIn));
expectFigure(figures, "operatingCashOut.total", sum(operatingOut));
expectFigure(figures, "grossBurn.last3Months", grossBurnLast3);
expectFigure(figures, "grossBurn.average9Months", average(operatingOut));
expectFigure(figures, "netBurn.last3Months", netBurnLast3);
expectFigure(figures, "netBurn.average9Months", average(netOperating.map((net) => -net)));
expectFigure(figures, "runwayMonths", runwayMonths);
expectFigure(figures, "whatIf.monthlyHiringCost", hiringCost);
expectFigure(figures, "whatIf.netBurn", netBurnLast3 + hiringCost);
expectFigure(figures, "whatIf.grossBurn", grossBurnLast3 + hiringCost);
expectFigure(figures, "whatIf.runwayMonths", closingCash / (netBurnLast3 + hiringCost));

for (const item of lineItems) {
  const i = KEYS.indexOf(item.period);
  const expected = item.label === "Operating cash in" ? operatingIn[i] : operatingOut[i];
  if (i < 0 || !close(item.amount, expected, 1e-9)) {
    record(`line item ${item.label} ${item.period}: case.json ${item.amount}, re-derived ${expected}`);
  }
}

// ---------------------------------------------------------------- report ----

process.stdout.write(
  [
    `rows ${rows.length}, months ${KEYS.length} (${KEYS[0]}..${KEYS.at(-1)}), reversal rows ${reversals.length}`,
    `financing inflow ${financingIn[KEYS.indexOf("2024-05")]} in 2024-05, excluded from operating in`,
    `operating in total ${sum(operatingIn)}, operating out total ${sum(operatingOut)}`,
    `magnitude-only reading of the out rows would overstate outflow by ${naiveGap}`,
    `closing cash ${closingCash}, gross burn(last3) ${grossBurnLast3.toFixed(2)}, net burn(last3) ${netBurnLast3.toFixed(2)}`,
    `runway ${runwayMonths.toFixed(4)} months -> ${(closingCash / (netBurnLast3 + hiringCost)).toFixed(4)} after 3 hires`,
    `checked ${figures.length} figures and ${lineItems.length} line items`,
  ].join("\n") + "\n",
);

if (failures.length > 0) {
  process.stderr.write(`FAIL cashflow-startup-burn\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("OK cashflow-startup-burn\n");

/**
 * Independent checker for `cashflow-kafe-12m`. Written against the FILE, not against build.mjs: it
 * re-opens the generated workbook with exceljs, rebuilds the cash book from the cells, re-derives every
 * figure in case.json and compares. It never imports build.mjs and never imports the finance engine.
 *
 * Run from `packages/host`:  node eval/finance/cases/cashflow-kafe-12m/verify.mjs
 * Exits non-zero on the first mismatch; prints one line per checked figure group otherwise.
 */
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Cost behaviour is a convention, not something the sheet states; restated here on purpose. */
const VARIABLE_LABELS = ["Pembelian bahan baku", "Perlengkapan & kemasan"];
const ONE_OFF_LABELS = ["Perawatan mesin (overhaul)"];
const RENT_LABEL = "Sewa tempat";

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
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(join(HERE, file.path));
const sheet = workbook.getWorksheet(file.sheet);
if (!sheet) {
  throw new Error(`sheet "${file.sheet}" is not in ${file.path}`);
}

/** Every row as a plain array: [label, ...cells]; numeric cells stay numbers. */
const grid = [];
sheet.eachRow({ includeEmpty: true }, (row) => {
  const cells = [];
  row.eachCell({ includeEmpty: true }, (cell, column) => {
    cells[column - 1] = cell.value;
  });
  grid.push(cells);
});

const rowAt = (label) => grid.find((cells) => cells[0] === label);
const startsWith = (prefix) => grid.find((cells) => typeof cells[0] === "string" && cells[0].startsWith(prefix));

const headerIndex = grid.findIndex((cells) => cells[0] === "Keterangan");
if (headerIndex < 0) {
  throw new Error("no header row starting with Keterangan");
}
const MONTHS = grid[headerIndex].slice(1).filter((cell) => typeof cell === "string" && cell !== "");
const values = (cells) => MONTHS.map((_, i) => Number(cells[i + 1] ?? 0));

const openingRow = startsWith("Saldo awal");
if (!openingRow) {
  throw new Error("no Saldo awal row above the table");
}
const openingCash = Number(openingRow[1]);

/** The rows between a section caption and its subtotal row. */
function block(caption, subtotal) {
  const from = grid.findIndex((cells) => cells[0] === caption);
  const to = grid.findIndex((cells) => cells[0] === subtotal);
  if (from < 0 || to < 0 || to <= from) {
    throw new Error(`cannot find the block ${caption} .. ${subtotal}`);
  }
  return grid.slice(from + 1, to).map((cells) => ({ label: cells[0], values: values(cells) }));
}

const cashIn = block("KAS MASUK", "Total masuk");
const cashOut = block("KAS KELUAR", "Total keluar");

// ---------------------------------------------------------- re-derivation ----

const sum = (list) => list.reduce((total, value) => total + value, 0);
const columnSum = (rows) => MONTHS.map((_, i) => sum(rows.map((row) => row.values[i])));

const totalIn = columnSum(cashIn);
const totalOut = columnSum(cashOut);
const netCash = MONTHS.map((_, i) => totalIn[i] - totalOut[i]);
const closing = netCash.map((_, i) => netCash.slice(0, i + 1).reduce((total, net) => total + net, openingCash));

// The sheet's own subtotal rows must agree with the re-derived ones, or a reader that trusts either is wrong.
for (const [label, derived] of [["Total masuk", totalIn], ["Total keluar", totalOut], ["Arus kas bersih", netCash], ["Saldo akhir", closing]]) {
  const printed = values(rowAt(label) ?? []);
  printed.forEach((value, i) => {
    if (!close(value, derived[i], 1e-9)) {
      record(`sheet row "${label}" ${MONTHS[i]}: printed ${value}, re-derived ${derived[i]}`);
    }
  });
}

const negative = netCash.filter((net) => net < 0);
if (negative.length !== 3) {
  record(`expected 3 negative months, found ${negative.length}`);
}
const burnNegative = -sum(negative) / negative.length;
const burnLastThree = -sum(netCash.slice(-3)) / 3;
const closingCash = closing.at(-1);

const outWhere = (keep) => cashOut.filter((row) => keep(row.label));
const isVariable = (label) => VARIABLE_LABELS.includes(label);
const isOneOff = (label) => ONE_OFF_LABELS.includes(label);
const annualRevenue = sum(totalIn);
const annualVariable = sum(outWhere(isVariable).map((row) => sum(row.values)));
const annualFixed = sum(outWhere((label) => !isVariable(label) && !isOneOff(label)).map((row) => sum(row.values)));
const contributionMarginRatio = 1 - annualVariable / annualRevenue;

const last = MONTHS.length - 1;
const rentDec = (cashOut.find((row) => row.label === RENT_LABEL) ?? { values: [] }).values[last];
const variableDec = sum(outWhere(isVariable).map((row) => row.values[last]));
const rentCut = caseJson.params.rentCutPct / 100;
const salesLift = caseJson.params.salesLiftPct / 100;
const whatIfNet = netCash[last] + totalIn[last] * salesLift - variableDec * salesLift + rentDec * rentCut;

// --------------------------------------------------------------- compare ----

const { figures, lineItems } = caseJson.truth;

if (openingCash !== caseJson.params.openingCash) {
  record(`opening cash: sheet ${openingCash}, params ${caseJson.params.openingCash}`);
}
MONTHS.forEach((month, i) => {
  expectFigure(figures, `netCash.${month}`, netCash[i]);
  expectFigure(figures, `closingCash.${month}`, closing[i]);
});
expectFigure(figures, "totalCashIn.2024", annualRevenue);
expectFigure(figures, "totalCashOut.2024", sum(totalOut));
expectFigure(figures, "averageBurn.negativeMonths", burnNegative);
expectFigure(figures, "averageBurn.last3Months", burnLastThree);
expectFigure(figures, "runwayMonths.negativeMonths", closingCash / burnNegative);
expectFigure(figures, "runwayMonths.last3Months", closingCash / burnLastThree);
expectFigure(figures, "monthsToZeroCash", closingCash / burnLastThree);
expectFigure(figures, "breakevenRevenue.monthly", annualFixed / 12 / contributionMarginRatio);
expectFigure(figures, "breakevenRevenue.annual", annualFixed / contributionMarginRatio);
expectFigure(figures, "contributionMarginPct", contributionMarginRatio * 100);
expectFigure(figures, "whatIf.netCash.monthly", whatIfNet);
expectFigure(figures, "whatIf.runwayMonths", closingCash / -whatIfNet);

for (const item of lineItems) {
  const i = MONTHS.indexOf(item.period);
  const expected = item.label === "Total kas masuk" ? totalIn[i] : totalOut[i];
  if (i < 0 || !close(item.amount, expected, 1e-9)) {
    record(`line item ${item.label} ${item.period}: case.json ${item.amount}, re-derived ${expected}`);
  }
}

/** The month the till empties, counted forward from the last month in the sheet. */
const monthsToZero = closingCash / burnLastThree;
const zeroMonth = new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
  Date.UTC(2024, 11 + Math.ceil(monthsToZero)),
);
if (!caseJson.truth.mustMention.includes(zeroMonth)) {
  record(`mustMention has no zero-cash month; re-derived ${zeroMonth}`);
}

// ---------------------------------------------------------------- report ----

process.stdout.write(
  [
    `months ${MONTHS.length}, cash-in rows ${cashIn.length}, cash-out rows ${cashOut.length}`,
    `opening ${openingCash}, closing ${closingCash}, negative months ${negative.length}`,
    `burn(neg) ${burnNegative.toFixed(2)}, burn(last3) ${burnLastThree.toFixed(2)}, runway ${(closingCash / burnLastThree).toFixed(4)} months -> ${zeroMonth}`,
    `contribution margin ${(contributionMarginRatio * 100).toFixed(4)}%, breakeven/month ${(annualFixed / 12 / contributionMarginRatio).toFixed(2)}`,
    `what-if net ${whatIfNet.toFixed(2)}, what-if runway ${(closingCash / -whatIfNet).toFixed(4)} months`,
    `checked ${figures.length} figures and ${lineItems.length} line items`,
  ].join("\n") + "\n",
);

if (failures.length > 0) {
  process.stderr.write(`FAIL cashflow-kafe-12m\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("OK cashflow-kafe-12m\n");

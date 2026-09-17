/**
 * Independent checker for `appraisal-mesin`. Written against the FILE: it re-opens the generated
 * workbook with exceljs, rebuilds the yearly flows from the component rows, and re-derives NPV, IRR,
 * both paybacks, the profitability index and the 3x3 sensitivity grid. IRR is solved here by the SECANT
 * method, not by the bisection build.mjs used, and NPV at the IRR recorded in case.json is checked to be
 * ~0. It never imports build.mjs and never imports the finance engine.
 *
 * Run from `packages/host`:  node eval/finance/cases/appraisal-mesin/verify.mjs
 */
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HEADER_LABEL = "Komponen";
const SUBTOTAL_LABEL = "Arus kas bersih";

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

const grid = [];
sheet.eachRow({ includeEmpty: true }, (row) => {
  const cells = [];
  row.eachCell({ includeEmpty: true }, (cell, column) => {
    cells[column - 1] = cell.value;
  });
  grid.push(cells);
});

const headerIndex = grid.findIndex((cells) => cells[0] === HEADER_LABEL);
const subtotalIndex = grid.findIndex((cells) => cells[0] === SUBTOTAL_LABEL);
if (headerIndex < 0 || subtotalIndex <= headerIndex) {
  throw new Error(`cannot find the ${HEADER_LABEL} header and the ${SUBTOTAL_LABEL} subtotal`);
}
const YEARS = grid[headerIndex].slice(1).filter((cell) => typeof cell === "string" && cell !== "");
const readRow = (cells) => YEARS.map((_, year) => Number(cells[year + 1] ?? 0));
const components = grid.slice(headerIndex + 1, subtotalIndex).map((cells) => ({ label: cells[0], values: readRow(cells) }));

/** Flows are rebuilt from the components; the printed subtotal row is only cross-checked against them. */
const FLOWS = YEARS.map((_, year) => components.reduce((total, row) => total + row.values[year], 0));
const printedSubtotal = readRow(grid[subtotalIndex]);
printedSubtotal.forEach((value, year) => {
  if (!close(value, FLOWS[year], 1e-9)) {
    record(`subtotal ${YEARS[year]}: printed ${value}, re-derived ${FLOWS[year]}`);
  }
});

// ---------------------------------------------------------- re-derivation ----

const npv = (rate, flows) => flows.reduce((total, flow, year) => total + flow / (1 + rate) ** year, 0);

/** Secant method, a different root finder from the one the generator used. */
function irrBySecant(flows) {
  let previous = 0.01;
  let current = 0.2;
  let npvPrevious = npv(previous, flows);
  for (let step = 0; step < 200; step += 1) {
    const npvCurrent = npv(current, flows);
    if (Math.abs(npvCurrent) < 1e-9 || Math.abs(current - previous) < 1e-12) {
      return current;
    }
    const next = current - (npvCurrent * (current - previous)) / (npvCurrent - npvPrevious);
    previous = current;
    npvPrevious = npvCurrent;
    current = next;
  }
  throw new Error("secant did not converge on an IRR");
}

const runningTotal = (values, start, upTo) => values.slice(0, upTo + 1).reduce((total, value) => total + value, start);
const cumulative = (flows) => flows.map((_, year) => runningTotal(flows, 0, year));

function paybackYears(flows) {
  const cum = cumulative(flows);
  const crossing = cum.findIndex((total, year) => year >= 1 && total >= 0);
  if (crossing < 0) {
    throw new Error("the flows never pay back");
  }
  return crossing - 1 + -cum[crossing - 1] / flows[crossing];
}

const discounted = (rate, flows) => flows.map((flow, year) => flow / (1 + rate) ** year);
const scaled = (flows, factor) => flows.map((flow, year) => (year === 0 ? flow : flow * factor));

const rate = caseJson.params.discountRate / 100;
const baseNpv = npv(rate, FLOWS);
const baseIrr = irrBySecant(FLOWS);
const cumFlows = cumulative(FLOWS);
const cumDiscounted = cumulative(discounted(rate, FLOWS));
const payback = paybackYears(FLOWS);
const discountedPayback = paybackYears(discounted(rate, FLOWS));
const profitabilityIndex = (baseNpv - FLOWS[0]) / -FLOWS[0];

// NPV at the IRR recorded in case.json must be ~0 relative to the size of the outlay.
const recordedIrr = caseJson.truth.figures.find((entry) => entry.key === "irrPct").value / 100;
const npvAtRecordedIrr = npv(recordedIrr, FLOWS);
const zeroBand = Math.abs(FLOWS[0]) * 1e-6;
if (Math.abs(npvAtRecordedIrr) > zeroBand) {
  record(`NPV at the recorded IRR is ${npvAtRecordedIrr}, outside +/-${zeroBand}`);
}

/** Only one IRR may exist, or every appraisal figure below is meaningless. */
const samples = [];
for (let probe = -0.98; probe <= 6; probe += 0.0005) {
  samples.push(Math.sign(npv(probe, FLOWS)));
}
const crossings = samples.filter((sign, i) => i > 0 && sign !== 0 && sign !== samples[i - 1]).length;
if (crossings !== 1) {
  record(`NPV(r) crosses zero ${crossings} times; the IRR is not unique`);
}

// --------------------------------------------------------------- compare ----

const { figures } = caseJson.truth;
const shiftKey = (shift) => (shift === 0 ? "base" : shift < 0 ? `minus${-shift}` : `plus${shift}`);

expectFigure(figures, "npv", baseNpv);
expectFigure(figures, "irrPct", baseIrr * 100);
expectFigure(figures, "paybackYears", payback);
expectFigure(figures, "discountedPaybackYears", discountedPayback);
expectFigure(figures, "profitabilityIndex", profitabilityIndex);
YEARS.forEach((year, i) => {
  expectFigure(figures, `netCashFlow.${year}`, FLOWS[i]);
  expectFigure(figures, `cumulativeCashFlow.${year}`, cumFlows[i]);
  expectFigure(figures, `cumulativeDiscountedCashFlow.${year}`, cumDiscounted[i]);
});
for (const ratePct of caseJson.params.rateScenarios) {
  for (const shift of caseJson.params.cashFlowShifts) {
    const value = npv(ratePct / 100, scaled(FLOWS, 1 + shift / 100));
    expectFigure(figures, `sensitivityNpv.rate${ratePct}.flows${shiftKey(shift)}`, value);
  }
}

for (const item of caseJson.truth.lineItems) {
  const row = components.find((component) => component.label === item.label);
  const year = YEARS.indexOf(item.period);
  if (!row || year < 0 || !close(item.amount, row.values[year], 1e-9)) {
    record(`line item ${item.label} ${item.period}: case.json ${item.amount} is not in the sheet`);
  }
}

// ---------------------------------------------------------------- report ----

process.stdout.write(
  [
    `years ${YEARS.length} (${YEARS[0]}..${YEARS.at(-1)}), component rows ${components.length}`,
    `flows ${FLOWS.map((flow) => flow.toFixed(0)).join(" | ")}`,
    `NPV @ ${caseJson.params.discountRate}% ${baseNpv.toFixed(2)}, IRR (secant) ${(baseIrr * 100).toFixed(6)}%`,
    `NPV at the recorded IRR ${npvAtRecordedIrr.toExponential(3)} (band +/-${zeroBand.toExponential(3)}), zero crossings ${crossings}`,
    `payback ${payback.toFixed(6)} y, discounted payback ${discountedPayback.toFixed(6)} y, PI ${profitabilityIndex.toFixed(6)}`,
    `checked ${figures.length} figures and ${caseJson.truth.lineItems.length} line items`,
  ].join("\n") + "\n",
);

if (failures.length > 0) {
  process.stderr.write(`FAIL appraisal-mesin\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("OK appraisal-mesin\n");

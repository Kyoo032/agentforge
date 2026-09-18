/**
 * Independent check for brief-saas-en. Written separately from build.mjs on
 * purpose: it re-reads input.csv with its own RFC-4180 reader and its own money
 * parser, prints the parsed grid, and re-derives every subtotal, the cash
 * roll-forward and every truth figure from the parsed cells — never from the
 * constants build.mjs used.
 *
 * Exits non-zero when anything disagrees so a harness can gate on it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MONTHS_PER_QUARTER = 3;
const FY2023 = [0, 1, 2, 3];
const FY2024 = [4, 5, 6, 7];

/** Minimal RFC-4180 reader: quoted fields, doubled quotes, CRLF or LF records. */
function parseCsv(text) {
  const records = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    records.push([...row, field]);
  }
  return records;
}

/** "1,250,000" -> 1250000, "(593,000)" -> -593000, anything else -> null. */
function money(raw) {
  const text = String(raw ?? "").trim();
  const wrapped = /^\((.*)\)$/.exec(text);
  const inner = (wrapped ? wrapped[1] : text).trim();
  if (!/^\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(inner)) {
    return null;
  }
  const value = Number(inner.split(",").join(""));
  return Number.isFinite(value) ? (wrapped ? -value : value) : null;
}

const failures = [];

function check(name, actual, expected, tolerance = 0) {
  const gap = Math.abs(actual - expected);
  const limit = tolerance === 0 ? 0 : Math.max(tolerance * Math.abs(expected), 1e-9);
  const ok = Number.isFinite(actual) && Number.isFinite(expected) && gap <= limit;
  if (!ok) {
    failures.push(`${name}: csv gives ${actual}, expected ${expected} (gap ${gap}, limit ${limit})`);
  }
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}  actual=${actual} expected=${expected}\n`);
}

function printGrid(records) {
  process.stdout.write(`\n=== input.csv (${records.length} records) ===\n`);
  records.forEach((record, index) => {
    const cells = record.map((value, column) => (value === "" ? null : `c${column}=${JSON.stringify(value)}`));
    process.stdout.write(`r${String(index + 1).padStart(2, "0")}  ${cells.filter(Boolean).join("  ")}\n`);
  });
}

/** label -> eight parsed numbers, straight off the parsed records. */
function seriesByLabel(records) {
  const found = new Map();
  for (const record of records) {
    const values = record.slice(1, 9).map(money);
    if (record[0] && values.every((value) => value !== null)) {
      found.set(record[0].trim(), values);
    }
  }
  return found;
}

const REVENUE_LABELS = ["Subscription Revenue", "Professional Services Revenue", "Usage Overage Revenue"];
const COGS_LABELS = ["Hosting & Infrastructure", "Customer Support", "Third-party Data Licenses"];
const OPEX_LABELS = ["Sales & Marketing", "Research & Development", "General & Administrative"];

const add = (rows, labels) =>
  labels.reduce((totals, label) => totals.map((value, index) => value + rows.get(label)[index]), new Array(8).fill(0));

function checkSubtotals(rows, quarters) {
  process.stdout.write("\n--- subtotals recomputed from the line items ---\n");
  const revenue = add(rows, REVENUE_LABELS);
  const cogs = add(rows, COGS_LABELS);
  const opex = add(rows, OPEX_LABELS);
  quarters.forEach((quarter, index) => {
    check(`Total Revenue ${quarter}`, rows.get("Total Revenue")[index], revenue[index]);
    check(`Total Cost of Revenue ${quarter}`, rows.get("Total Cost of Revenue")[index], cogs[index]);
    check(`Gross Profit ${quarter}`, rows.get("Gross Profit")[index], revenue[index] - cogs[index]);
    check(`Total Operating Expenses ${quarter}`, rows.get("Total Operating Expenses")[index], opex[index]);
    check(
      `Operating Income (Loss) ${quarter}`,
      rows.get("Operating Income (Loss)")[index],
      revenue[index] - cogs[index] - opex[index],
    );
  });
  return { revenue, cogs, opex };
}

function checkCashRollForward(rows, quarters) {
  process.stdout.write("\n--- cash roll-forward: each quarter's cash = previous cash - that quarter's burn ---\n");
  const cash = rows.get("Cash & Equivalents, End of Quarter");
  const burn = rows.get("Net Quarterly Burn");
  for (let index = 1; index < cash.length; index += 1) {
    check(`cash ${quarters[index]}`, cash[index], cash[index - 1] - burn[index]);
  }
  return { cash, burn };
}

const sumOver = (values, indexes) => indexes.reduce((total, index) => total + values[index], 0);

function derive(totals, cash, burn, params) {
  const gross = totals.revenue.map((value, index) => value - totals.cogs[index]);
  const operating = gross.map((value, index) => value - totals.opex[index]);
  const revenue2023 = sumOver(totals.revenue, FY2023);
  const revenue2024 = sumOver(totals.revenue, FY2024);
  const monthlyBurn = sumOver(burn, FY2024) / (FY2024.length * MONTHS_PER_QUARTER);
  const seats = params.fixedCosts / (params.pricePerUnit - params.variableCostPerUnit);
  return {
    "totalRevenue.Q1-2023": totals.revenue[0],
    "totalRevenue.Q4-2024": totals.revenue[7],
    "totalRevenue.FY2023": revenue2023,
    "totalRevenue.FY2024": revenue2024,
    "revenueGrowthPct.FY2024": ((revenue2024 - revenue2023) / revenue2023) * 100,
    "revenueGrowthPctQoQ.Q4-2024": ((totals.revenue[7] - totals.revenue[6]) / totals.revenue[6]) * 100,
    revenueCagrQuarterlyPct: ((totals.revenue[7] / totals.revenue[0]) ** (1 / 7) - 1) * 100,
    "grossProfit.Q4-2024": gross[7],
    "grossMarginPct.Q4-2024": (gross[7] / totals.revenue[7]) * 100,
    "grossMarginPct.FY2023": (sumOver(gross, FY2023) / revenue2023) * 100,
    "grossMarginPct.FY2024": (sumOver(gross, FY2024) / revenue2024) * 100,
    "opex.FY2024": sumOver(totals.opex, FY2024),
    "operatingIncome.Q4-2024": operating[7],
    "operatingMarginPct.Q4-2024": (operating[7] / totals.revenue[7]) * 100,
    "operatingIncome.FY2024": sumOver(operating, FY2024),
    "cash.Q4-2024": cash[7],
    "netBurn.Q4-2024": burn[7],
    "monthlyBurn.FY2024": monthlyBurn,
    "runwayMonths.fy2024Burn": cash[7] / monthlyBurn,
    "runwayMonths.latestQuarterBurn": cash[7] / (burn[7] / MONTHS_PER_QUARTER),
    contributionMarginPct: ((params.pricePerUnit - params.variableCostPerUnit) / params.pricePerUnit) * 100,
    breakevenUnits: seats,
    breakevenRevenue: seats * params.pricePerUnit,
    quartersToOperatingBreakeven: operating.findIndex((value) => value > 0) + 1,
  };
}

function main() {
  const records = parseCsv(readFileSync(join(HERE, "input.csv"), "utf8"));
  printGrid(records);

  const header = records.find((record) => record[0] === "Line Item");
  const quarters = header.slice(1, 9);
  process.stdout.write(`\nperiod columns: ${quarters.join(" | ")}\n`);

  const rows = seriesByLabel(records);
  const totals = checkSubtotals(rows, quarters);
  const { cash, burn } = checkCashRollForward(rows, quarters);

  const parsed = JSON.parse(readFileSync(join(HERE, "case.json"), "utf8"));
  check("params.fixedCosts equals Q4 2024 total opex", parsed.params.fixedCosts, totals.opex[7]);
  const derived = derive(totals, cash, burn, parsed.params);

  process.stdout.write("\n--- truth figures re-derived from the csv ---\n");
  for (const figure of parsed.truth.figures) {
    if (!(figure.key in derived)) {
      failures.push(`no independent derivation for ${figure.key}`);
      process.stdout.write(`FAIL ${figure.key}: nothing to compare against\n`);
      continue;
    }
    check(figure.key, derived[figure.key], figure.value, Math.max(figure.tolerance, 5e-5));
  }

  process.stdout.write(`\nchecked ${parsed.truth.figures.length} figures across ${quarters.length} quarters\n`);
  if (failures.length > 0) {
    process.stdout.write(`FAILURES (${failures.length}):\n${failures.map((line) => `  - ${line}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("brief-saas-en: all subtotals, the cash roll-forward and all truth figures re-derive.\n");
}

main();

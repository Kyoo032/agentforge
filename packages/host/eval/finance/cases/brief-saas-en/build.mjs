/**
 * brief-saas-en — deterministic source data plus an independent ground truth.
 *
 * Writes `input.csv` (a quarterly P&L exported the way a finance team exports
 * one: two title lines, a spacer, eight period columns, quoted thousands,
 * parenthesised losses, section headers, subtotal rows that must not be double
 * counted, and a cash block) and `case.json`.
 *
 * The `truth` block is computed below with plain arithmetic only. Nothing from
 * packages/core/src/finance is imported, so the truth stays an oracle that is
 * independent of the engine it is used to grade.
 *
 * Determinism: no Date.now(), no Math.random(); plain `fs` writes, CRLF line
 * endings, so two runs produce byte-identical output.
 *
 * Lumenstack Analytics, Inc. is invented, and so is every figure below.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMPANY = "Lumenstack Analytics, Inc.";
const CURRENCY = "USD";
const EOL = "\r\n";
const MONTHS_PER_QUARTER = 3;

const QUARTERS = ["Q1 2023", "Q2 2023", "Q3 2023", "Q4 2023", "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024"];
const FY2023 = [0, 1, 2, 3];
const FY2024 = [4, 5, 6, 7];

const REVENUE = [
  ["Subscription Revenue", [1_250_000, 1_420_000, 1_640_000, 1_905_000, 2_190_000, 2_520_000, 2_915_000, 3_380_000]],
  ["Professional Services Revenue", [185_000, 196_000, 210_000, 238_000, 252_000, 271_000, 288_000, 315_000]],
  ["Usage Overage Revenue", [64_000, 78_000, 92_000, 118_000, 141_000, 167_000, 199_000, 242_000]],
];
const COGS = [
  ["Hosting & Infrastructure", [268_000, 296_000, 332_000, 379_000, 421_000, 470_000, 528_000, 594_000]],
  ["Customer Support", [121_000, 134_000, 148_000, 171_000, 190_000, 212_000, 236_000, 264_000]],
  ["Third-party Data Licenses", [58_000, 62_000, 68_000, 76_000, 84_000, 93_000, 103_000, 114_000]],
];
const OPEX = [
  ["Sales & Marketing", [780_000, 845_000, 930_000, 1_060_000, 1_185_000, 1_290_000, 1_395_000, 1_480_000]],
  ["Research & Development", [620_000, 668_000, 715_000, 790_000, 860_000, 925_000, 985_000, 1_040_000]],
  ["General & Administrative", [245_000, 262_000, 284_000, 311_000, 338_000, 362_000, 389_000, 412_000]],
];
const CASH = [12_400_000, 11_790_000, 11_215_000, 10_660_000, 10_140_000, 9_725_000, 9_470_000, 9_380_000];
const BURN = [640_000, 610_000, 575_000, 555_000, 520_000, 415_000, 255_000, 90_000];

/** Unit economics the P&L itself does not carry; the product takes them as FinanceParams. */
const PRICE_PER_SEAT_QUARTER = 1_200;
const VARIABLE_COST_PER_SEAT_QUARTER = 310;

const round = (value, places) => Number(value.toFixed(places));
const across = (rows, index) => rows.reduce((total, row) => total + row[1][index], 0);
const series = (rows) => QUARTERS.map((_, index) => across(rows, index));
const sumOver = (values, indexes) => indexes.reduce((total, index) => total + values[index], 0);

// -------------------------------------------------------------------- csv

function grouped(value) {
  return Math.abs(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Money as the export writes it: always quoted, losses in parentheses. */
function cell(value) {
  return `"${value < 0 ? `(${grouped(value)})` : grouped(value)}"`;
}

function quoted(text) {
  return /[",]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}

function dataLine(label, values) {
  return [quoted(label), ...values.map(cell)].join(",");
}

function sectionLine(label) {
  return [quoted(label), ...QUARTERS.map(() => "")].join(",");
}

function csvLines(totals) {
  return [
    quoted(COMPANY),
    quoted("Quarterly Profit & Loss (unaudited) - figures in USD"),
    QUARTERS.map(() => "").join(","),
    ["Line Item", ...QUARTERS].map(quoted).join(","),
    sectionLine("Revenue"),
    ...REVENUE.map(([label, values]) => dataLine(label, values)),
    dataLine("Total Revenue", totals.revenue),
    sectionLine("Cost of Revenue"),
    ...COGS.map(([label, values]) => dataLine(label, values)),
    dataLine("Total Cost of Revenue", totals.cogs),
    dataLine("Gross Profit", totals.gross),
    sectionLine("Operating Expenses"),
    ...OPEX.map(([label, values]) => dataLine(label, values)),
    dataLine("Total Operating Expenses", totals.opex),
    dataLine("Operating Income (Loss)", totals.operating),
    sectionLine(""),
    sectionLine("Cash"),
    dataLine("Cash & Equivalents, End of Quarter", CASH),
    dataLine("Net Quarterly Burn", BURN),
    sectionLine(
      "Note: Total Revenue, Total Cost of Revenue, Gross Profit, Total Operating Expenses and Operating Income are subtotals - do not add them to the line items.",
    ),
  ];
}

// ----------------------------------------------------------------- totals

function computeTotals() {
  const revenue = series(REVENUE);
  const cogs = series(COGS);
  const opex = series(OPEX);
  const gross = revenue.map((value, index) => value - cogs[index]); // gross profit = revenue - cost of revenue
  const operating = gross.map((value, index) => value - opex[index]); // operating income = gross - opex
  return { revenue, cogs, opex, gross, operating };
}

// ------------------------------------------------------------------ truth

function lineItems() {
  const spread = (rows, category) =>
    rows.flatMap(([label, values]) =>
      values.map((amount, index) => ({
        label,
        period: QUARTERS[index],
        amount,
        currency: CURRENCY,
        category,
      })),
    );
  return [
    ...spread(REVENUE, "revenue"),
    ...spread(COGS, "cogs"),
    ...spread(OPEX, "opex"),
    ...spread([["Cash & Equivalents, End of Quarter", CASH]], "cash"),
    ...spread([["Net Quarterly Burn", BURN]], "other"),
  ];
}

const money = (key, label, value) => ({ key, label, value: round(value, 2), unit: "currency", tolerance: 0.001 });
const percent = (key, label, value) => ({ key, label, value: round(value, 4), unit: "percent", tolerance: 0.005 });

/** The whole-year and unit-economics aggregates, kept out of `figures` so it stays under 50 lines. */
function aggregates(totals) {
  const fixedCosts = totals.opex[7]; // run-rate fixed cost base = Q4 2024 total operating expenses
  const contributionPerSeat = PRICE_PER_SEAT_QUARTER - VARIABLE_COST_PER_SEAT_QUARTER; // 1200 - 310
  return {
    fixedCosts,
    contributionPerSeat,
    revenue2023: sumOver(totals.revenue, FY2023),
    revenue2024: sumOver(totals.revenue, FY2024),
    gross2023: sumOver(totals.gross, FY2023),
    gross2024: sumOver(totals.gross, FY2024),
    opex2024: sumOver(totals.opex, FY2024),
    operating2024: sumOver(totals.operating, FY2024),
    burn2024: sumOver(BURN, FY2024),
    breakevenSeats: fixedCosts / contributionPerSeat, // fixed / (price - variable cost)
    contributionMarginPct: (contributionPerSeat / PRICE_PER_SEAT_QUARTER) * 100, // (price - variable) / price
  };
}

/** 24 figures, each with its formula beside it, all from plain arithmetic above. */
function figures(totals) {
  const agg = aggregates(totals);
  const monthlyBurn2024 = agg.burn2024 / (FY2024.length * MONTHS_PER_QUARTER); // FY24 burn / 12 months
  const cash = CASH[7];
  return [
    money("totalRevenue.Q1-2023", "Total revenue Q1 2023", totals.revenue[0]), // sum(revenue lines)
    money("totalRevenue.Q4-2024", "Total revenue Q4 2024", totals.revenue[7]), // sum(revenue lines)
    money("totalRevenue.FY2023", "Total revenue FY2023", agg.revenue2023), // sum(Q1..Q4 2023)
    money("totalRevenue.FY2024", "Total revenue FY2024", agg.revenue2024), // sum(Q1..Q4 2024)
    percent(
      "revenueGrowthPct.FY2024",
      "Revenue growth FY2024 vs FY2023",
      ((agg.revenue2024 - agg.revenue2023) / agg.revenue2023) * 100, // (fy24 - fy23) / fy23
    ),
    percent(
      "revenueGrowthPctQoQ.Q4-2024",
      "Revenue growth Q4 2024 vs Q3 2024",
      ((totals.revenue[7] - totals.revenue[6]) / totals.revenue[6]) * 100, // (q8 - q7) / q7
    ),
    percent(
      "revenueCagrQuarterlyPct",
      "Revenue CAGR per quarter, Q1 2023 to Q4 2024",
      ((totals.revenue[7] / totals.revenue[0]) ** (1 / (QUARTERS.length - 1)) - 1) * 100, // (last/first)^(1/7) - 1
    ),
    money("grossProfit.Q4-2024", "Gross profit Q4 2024", totals.gross[7]), // revenue - cost of revenue
    percent("grossMarginPct.Q4-2024", "Gross margin Q4 2024", (totals.gross[7] / totals.revenue[7]) * 100), // gross / revenue
    percent("grossMarginPct.FY2023", "Gross margin FY2023", (agg.gross2023 / agg.revenue2023) * 100), // gross / revenue
    percent("grossMarginPct.FY2024", "Gross margin FY2024", (agg.gross2024 / agg.revenue2024) * 100), // gross / revenue
    money("opex.FY2024", "Total operating expenses FY2024", agg.opex2024), // sum(opex lines, FY24)
    money("operatingIncome.Q4-2024", "Operating income Q4 2024", totals.operating[7]), // gross - opex
    percent(
      "operatingMarginPct.Q4-2024",
      "Operating margin Q4 2024",
      (totals.operating[7] / totals.revenue[7]) * 100, // operating income / revenue
    ),
    money("operatingIncome.FY2024", "Operating income (loss) FY2024", agg.operating2024), // sum(Q1..Q4 2024)
    money("cash.Q4-2024", "Cash and equivalents at Q4 2024", cash), // as reported on the cash line
    money("netBurn.Q4-2024", "Net burn Q4 2024", BURN[7]), // as reported on the burn line
    money("monthlyBurn.FY2024", "Average monthly net burn FY2024", monthlyBurn2024), // FY24 burn / 12
    {
      key: "runwayMonths.fy2024Burn",
      label: "Runway on the FY2024 average burn (months)",
      value: round(cash / monthlyBurn2024, 4), // cash / (FY24 burn / 12)
      unit: "months",
      tolerance: 0.005,
    },
    {
      key: "runwayMonths.latestQuarterBurn",
      label: "Runway on the Q4 2024 burn alone (months)",
      value: round(cash / (BURN[7] / MONTHS_PER_QUARTER), 4), // cash / (Q4 burn / 3)
      unit: "months",
      tolerance: 0.005,
    },
    percent("contributionMarginPct", "Contribution margin per seat", agg.contributionMarginPct), // (price - variable) / price
    {
      key: "breakevenUnits",
      label: "Seats per quarter to cover the Q4 2024 fixed cost base",
      value: round(agg.breakevenSeats, 4), // fixed / (price - variable)
      unit: "count",
      tolerance: 0.005,
    },
    money("breakevenRevenue", "Quarterly revenue at breakeven", agg.breakevenSeats * PRICE_PER_SEAT_QUARTER), // seats * price
    {
      key: "quartersToOperatingBreakeven",
      label: "Quarters from Q1 2023 until operating income first turns positive",
      value: totals.operating.findIndex((value) => value > 0) + 1, // 1-based index of the first positive quarter
      unit: "count",
      tolerance: 0,
    },
  ];
}

const DESCRIPTION = [
  `Eight quarters of unaudited quarterly P&L for an invented SaaS startup (${COMPANY}), one comma-delimited .csv.`,
  "The export carries two title lines and a spacer above the header, quoted thousands (\"1,250,000\"), losses in parentheses (\"(593,000)\"), section header rows with no figures, and subtotal rows (Total Revenue, Total Cost of Revenue, Gross Profit, Total Operating Expenses, Operating Income) that must NOT be counted again as line items.",
  "Definitions this truth uses where the product leaves them open: gross margin = (revenue - cost of revenue) / revenue; operating margin = operating income / revenue; revenue CAGR is per QUARTER over 7 steps, (last/first)^(1/7)-1, so the annualised figure is (1+q)^4-1.",
  "Runway is given twice on purpose, because the product's own definition is ambiguous: runwayMonths.fy2024Burn = cash at Q4 2024 / (FY2024 total net burn / 12 months), and runwayMonths.latestQuarterBurn = cash at Q4 2024 / (Q4 2024 net burn / 3 months). Both must be reported against the burn basis named with them.",
  "Breakeven uses the params: fixedCosts is the Q4 2024 total operating expense run rate, and price / variable cost are per seat per quarter; breakeven seats = fixedCosts / (pricePerUnit - variableCostPerUnit).",
  "Every figure tolerance is a RELATIVE fraction of |value| (0.005 = 0.5%); a tolerance of 0 means an exact match.",
].join(" ");

// -------------------------------------------------------------------- main

function main() {
  const totals = computeTotals();
  mkdirSync(HERE, { recursive: true });
  writeFileSync(join(HERE, "input.csv"), `${csvLines(totals).join(EOL)}${EOL}`, "utf8");

  const caseFile = {
    id: "brief-saas-en",
    task: "brief",
    locale: "en",
    currency: CURRENCY,
    description: DESCRIPTION,
    files: [{ path: "input.csv" }],
    prompt: `Write a performance brief for ${COMPANY} from the attached quarterly P&L: revenue growth and CAGR, gross and operating margins, how the burn is trending, how much runway the cash gives us, and how many seats a quarter we need to cover fixed costs.`,
    params: {
      fixedCosts: totals.opex[7],
      pricePerUnit: PRICE_PER_SEAT_QUARTER,
      variableCostPerUnit: VARIABLE_COST_PER_SEAT_QUARTER,
    },
    truth: {
      lineItems: lineItems(),
      figures: figures(totals),
      mustMention: ["runway", "margin", "breakeven", "Q4 2024"],
      mustNotContain: ["[unverified figure]"],
    },
  };
  writeFileSync(join(HERE, "case.json"), `${JSON.stringify(caseFile, null, 2)}\n`, "utf8");
  process.stdout.write(`brief-saas-en: wrote input.csv and case.json (${caseFile.truth.figures.length} figures)\n`);
}

main();

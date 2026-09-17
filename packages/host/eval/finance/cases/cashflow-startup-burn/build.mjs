/**
 * Deterministic generator for the `cashflow-startup-burn` eval case.
 *
 * Writes `bank-export-2024.csv` — a bank-style LONG export (date, category, direction, amount) of 120
 * transactions across nine months — and `case.json` whose `truth` is computed here by plain arithmetic.
 * Nothing from `@agentforge/core` is imported: the oracle stays independent of the engine under test.
 * Fixed literals throughout: no Math.random, no Date.now, no Date arithmetic.
 *
 * Run from `packages/host`:  node eval/finance/cases/cashflow-startup-burn/build.mjs
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV_NAME = "bank-export-2024.csv";

/** Cash in the bank on 1 Jan 2024; the export starts at the first transaction, not at a balance row. */
const OPENING_CASH = 1_850_000;
/** The only category that is financing, not trade. It must never land in operating revenue. */
const FINANCING_CATEGORY = "Financing";

/** Nine months, each with its own last calendar day (2024 is a leap year). */
const MONTHS = [
  { key: "2024-01", last: "31" },
  { key: "2024-02", last: "29" },
  { key: "2024-03", last: "31" },
  { key: "2024-04", last: "30" },
  { key: "2024-05", last: "31" },
  { key: "2024-06", last: "30" },
  { key: "2024-07", last: "31" },
  { key: "2024-08", last: "31" },
  { key: "2024-09", last: "30" },
];

// Per-month amounts, index 0 = Jan … 8 = Sep. Outflows are listed as magnitudes and signed below.
const SUBSCRIPTION_RUN_1 = [31_200, 33_400, 35_900, 38_100, 41_000, 44_200, 47_600, 50_900, 54_300];
const SUBSCRIPTION_RUN_2 = [12_800, 13_600, 14_500, 15_400, 16_300, 17_500, 18_800, 20_100, 21_400];
const INTEREST_INCOME = [980, 940, 900, 860, 820, 2_100, 2_050, 1_990, 1_930];
const PAYROLL_RUN = [98_000, 98_000, 106_000, 106_000, 106_000, 124_000, 134_000, 134_000, 142_000];
const PAYROLL_TAXES = [35_280, 35_280, 38_160, 38_160, 38_160, 44_640, 48_240, 48_240, 51_120];
const CONTRACTORS = [24_000, 21_000, 27_000, 19_000, 23_000, 31_000, 28_000, 26_000, 22_000];
const CLOUD_HOSTING = [14_200, 14_900, 15_800, 16_600, 17_500, 18_900, 20_400, 21_800, 23_100];
const SOFTWARE = [6_400, 6_600, 6_900, 7_100, 7_400, 7_900, 8_300, 8_700, 9_100];
const MARKETING = [18_000, 16_000, 22_000, 19_000, 24_000, 41_000, 46_000, 44_000, 39_000];
const RENT_MONTHLY = 12_500;

/** Sparse rows keyed by month index. */
const PROFESSIONAL_SERVICES = { 1: 18_000, 3: 22_000, 5: 15_000, 7: 26_000 };
const LEGAL = { 0: 4_500, 2: 5_200, 4: 68_000, 6: 6_100, 8: 5_800 };
const TRAVEL = { 1: 7_800, 2: 9_200, 5: 12_400, 8: 11_600 };
const EQUIPMENT = { 0: 14_800, 3: 9_600, 6: 21_500 };
const FINANCING_ROUND = { month: 4, day: "22", amount: 2_500_000 };

/**
 * Reversals: the sign, not the `direction` label, says which way the money moved. Three refunds are
 * booked against the original `out` category with a positive amount, and one churned annual customer
 * is refunded against `in` with a negative amount.
 */
const REVERSALS = [
  { date: "2024-03-27", category: "Cloud hosting", direction: "out", amount: 3_400 },
  { date: "2024-06-14", category: "Software subscriptions", direction: "out", amount: 2_900 },
  { date: "2024-07-23", category: "Subscription revenue", direction: "in", amount: -7_200 },
  { date: "2024-08-09", category: "Marketing", direction: "out", amount: 5_600 },
];

// ------------------------------------------------------------------ rows ----

const inflow = (month, day, category, amount) => ({ date: `${month.key}-${day}`, category, direction: "in", amount });
const outflow = (month, day, category, amount) => ({ date: `${month.key}-${day}`, category, direction: "out", amount: -amount });

/** The eleven rows every month carries, in day order. */
function recurringRows(month, i) {
  return [
    inflow(month, "01", "Subscription revenue", SUBSCRIPTION_RUN_1[i]),
    outflow(month, "01", "Rent", RENT_MONTHLY),
    outflow(month, "03", "Cloud hosting", CLOUD_HOSTING[i]),
    outflow(month, "05", "Software subscriptions", SOFTWARE[i]),
    outflow(month, "08", "Marketing", MARKETING[i]),
    inflow(month, "15", "Subscription revenue", SUBSCRIPTION_RUN_2[i]),
    outflow(month, "15", "Payroll", PAYROLL_RUN[i]),
    outflow(month, "20", "Contractors", CONTRACTORS[i]),
    outflow(month, "25", "Payroll taxes", PAYROLL_TAXES[i]),
    outflow(month, month.last, "Payroll", PAYROLL_RUN[i]),
    inflow(month, month.last, "Interest income", INTEREST_INCOME[i]),
  ];
}

/** The rows only some months carry. */
function occasionalRows(month, i) {
  const maybe = (table, day, category, sign) =>
    table[i] === undefined ? [] : [sign(month, day, category, table[i])];
  return [
    ...maybe(LEGAL, "10", "Legal & accounting", outflow),
    ...maybe(EQUIPMENT, "12", "Equipment", outflow),
    ...maybe(PROFESSIONAL_SERVICES, "18", "Professional services", inflow),
    ...maybe(TRAVEL, "22", "Travel", outflow),
    ...(FINANCING_ROUND.month === i
      ? [inflow(month, FINANCING_ROUND.day, FINANCING_CATEGORY, FINANCING_ROUND.amount)]
      : []),
  ];
}

const generated = MONTHS.flatMap((month, i) => [...recurringRows(month, i), ...occasionalRows(month, i)]);
// Stable sort by date, then by the order the rows were generated — a real export is date-ordered.
const ROWS = [...generated, ...REVERSALS]
  .map((row, index) => ({ ...row, index }))
  .sort((a, b) => (a.date === b.date ? a.index - b.index : a.date < b.date ? -1 : 1))
  .map(({ index: _index, ...row }) => row);

// ---------------------------------------------------------------- oracle ----

const monthOf = (row) => row.date.slice(0, 7);
const isFinancing = (row) => row.category === FINANCING_CATEGORY;
const sum = (values) => values.reduce((total, value) => total + value, 0);

/** Σ signed amount over the rows a predicate keeps, for one month. `direction` is never used as a sign. */
function monthly(key, keep) {
  return sum(ROWS.filter((row) => monthOf(row) === key && keep(row)).map((row) => row.amount));
}

const KEYS = MONTHS.map((month) => month.key);
// Operating in = Σ positive-side rows excluding Financing (signed, so the churn refund reduces it).
const operatingIn = KEYS.map((key) => monthly(key, (row) => row.direction === "in" && !isFinancing(row)));
// Operating out = -(Σ out rows, signed), so the three vendor refunds reduce that month's outflow.
const operatingOut = KEYS.map((key) => -monthly(key, (row) => row.direction === "out"));
const financingIn = KEYS.map((key) => monthly(key, isFinancing));
const netOperating = KEYS.map((_, i) => operatingIn[i] - operatingOut[i]); // net operating cash flow
const netTotal = KEYS.map((_, i) => netOperating[i] + financingIn[i]); // what the bank balance actually moves by

/** Closing[m] = closing[m-1] + net total[m]; closing[-1] = opening cash. */
const closing = netTotal.map((_, i) => netTotal.slice(0, i + 1).reduce((total, net) => total + net, OPENING_CASH));
const closingCash = closing.at(-1);

const average = (values) => sum(values) / values.length;
// Gross burn = operating cash OUT per month (financing ignored, inflows ignored).
const grossBurnLast3 = average(operatingOut.slice(-3));
const grossBurnAll = average(operatingOut);
// Net burn = operating out - operating in = -(net operating cash flow).
const netBurnLast3 = average(netOperating.slice(-3).map((net) => -net));
const netBurnAll = average(netOperating.map((net) => -net));
// Runway = closing cash / net burn (engine convention: runwayMonths(cash, burn) = cash / burn).
const runwayMonths = closingCash / netBurnLast3;

const NEW_ENGINEERS = 3;
const COST_PER_ENGINEER = 9_000; // fully loaded monthly cost; no extra payroll tax on top
const hiringCost = NEW_ENGINEERS * COST_PER_ENGINEER;
const whatIfNetBurn = netBurnLast3 + hiringCost;
const whatIfGrossBurn = grossBurnLast3 + hiringCost;
const whatIfRunway = closingCash / whatIfNetBurn;

// ------------------------------------------------------------------- csv ----

const CSV_HEADER = "date,category,direction,amount";
const csv = [CSV_HEADER, ...ROWS.map((row) => `${row.date},${row.category},${row.direction},${row.amount}`)].join("\n");

// ------------------------------------------------------------- case.json ----

const EXACT = 1e-9;
const DERIVED = 1e-6;
const figure = (key, label, value, unit, tolerance) => ({ key, label, value, unit, tolerance });

function truthLineItems() {
  return KEYS.flatMap((period, i) => [
    { label: "Operating cash in", period, amount: operatingIn[i], category: "revenue" },
    { label: "Operating cash out", period, amount: operatingOut[i], category: "opex" },
  ]);
}

function truthFigures() {
  return [
    // operating in[m] = Σ signed amount of non-Financing `in` rows in month m
    ...KEYS.map((key, i) => figure(`operatingCashIn.${key}`, `Operating cash in ${key}`, operatingIn[i], "currency", EXACT)),
    // operating out[m] = -(Σ signed amount of `out` rows in month m)
    ...KEYS.map((key, i) => figure(`operatingCashOut.${key}`, `Operating cash out ${key}`, operatingOut[i], "currency", EXACT)),
    // net operating[m] = operating in[m] - operating out[m]
    ...KEYS.map((key, i) => figure(`netOperatingCashFlow.${key}`, `Net operating cash flow ${key}`, netOperating[i], "currency", EXACT)),
    // closing[m] = opening cash + Σ (net operating + financing) up to m
    ...KEYS.map((key, i) => figure(`closingCash.${key}`, `Closing cash ${key}`, closing[i], "currency", EXACT)),
    // the one-off SAFE inflow, reported on its own and never inside revenue
    figure("financingInflow.2024-05", "Financing inflow May 2024", financingIn[4], "currency", EXACT),
    // Σ operating in over the nine months (financing excluded)
    figure("operatingCashIn.total", "Operating cash in, 9 months", sum(operatingIn), "currency", EXACT),
    // Σ operating out over the nine months
    figure("operatingCashOut.total", "Operating cash out, 9 months", sum(operatingOut), "currency", EXACT),
    // mean operating out over Jul, Aug, Sep
    figure("grossBurn.last3Months", "Average gross burn, last 3 months", grossBurnLast3, "currency", DERIVED),
    // mean operating out over all nine months
    figure("grossBurn.average9Months", "Average gross burn, 9 months", grossBurnAll, "currency", DERIVED),
    // mean of -(net operating) over Jul, Aug, Sep
    figure("netBurn.last3Months", "Average net burn, last 3 months", netBurnLast3, "currency", DERIVED),
    // mean of -(net operating) over all nine months
    figure("netBurn.average9Months", "Average net burn, 9 months", netBurnAll, "currency", DERIVED),
    // closing cash Sep / net burn over the last 3 months
    figure("runwayMonths", "Runway from 30 Sep 2024", runwayMonths, "months", DERIVED),
    // 3 engineers x $9,000 fully loaded
    figure("whatIf.monthlyHiringCost", "Added monthly cost of 3 engineers", hiringCost, "currency", EXACT),
    // net burn last 3 + hiring cost
    figure("whatIf.netBurn", "Net burn after the hires", whatIfNetBurn, "currency", DERIVED),
    // gross burn last 3 + hiring cost
    figure("whatIf.grossBurn", "Gross burn after the hires", whatIfGrossBurn, "currency", DERIVED),
    // closing cash Sep / new net burn
    figure("whatIf.runwayMonths", "Runway after the hires", whatIfRunway, "months", DERIVED),
  ];
}

const caseJson = {
  id: "cashflow-startup-burn",
  task: "cashflow",
  locale: "en",
  currency: "USD",
  description: [
    `Synthetic bank export for a seed-stage SaaS company: ${ROWS.length} transactions in LONG format`,
    "(date, category, direction, amount) over nine months of 2024.",
    "Conventions this oracle used: (1) `amount` is ALREADY SIGNED — outflows are negative, inflows positive —",
    "and `direction` is a label only; four reversal rows (three vendor refunds booked `out` with a positive",
    "amount, one churned customer refunded `in` with a negative amount) mean a reader that re-applies a sign",
    "from `direction` double-negates them. (2) The May 2024 `Financing` inflow of $2,500,000 is a SAFE round:",
    "it moves the bank balance but is never operating revenue, so it is excluded from operating cash in, from",
    "gross burn and from net burn. (3) Gross burn = operating cash out per month; net burn = operating cash out",
    "- operating cash in; both are positive numbers. (4) Runway = closing cash on 30 Sep 2024 / average net burn",
    "over the last three months (engine convention runwayMonths(cash, burn) = cash / burn).",
    "(5) The what-if adds 3 engineers at $9,000/month each as a fully loaded cost — no extra payroll tax on top.",
    "Opening cash on 1 Jan 2024 is $1,850,000; it is stated in the prompt and in `params`, not in the file.",
    "All `tolerance` values are RELATIVE to the truth value (0.005 = 0.5%).",
  ].join(" "),
  files: [{ path: CSV_NAME }],
  prompt:
    "Here is our bank transaction export for Jan–Sep 2024. We opened January with $1,850,000 in the bank. " +
    "Give me the monthly cash in, cash out and net operating cash flow, our gross and net burn over the last " +
    "three months, the closing balance and how much runway that leaves us. Treat the May financing inflow " +
    "separately from revenue. Then show what happens to burn and runway if we hire 3 engineers at $9k/month.",
  params: { openingCash: OPENING_CASH, newEngineers: NEW_ENGINEERS, costPerEngineer: COST_PER_ENGINEER },
  truth: {
    lineItems: truthLineItems(),
    figures: truthFigures(),
    mustMention: ["runway", "net burn", "gross burn", "financing"],
    mustNotContain: ["[unverified figure]"],
  },
};

await writeFile(join(HERE, CSV_NAME), `${csv}\n`, "utf8");
await writeFile(join(HERE, "case.json"), `${JSON.stringify(caseJson, null, 2)}\n`, "utf8");
process.stdout.write(
  `wrote ${CSV_NAME} (${ROWS.length} rows) and case.json — closing cash ${closingCash}, ` +
    `net burn ${netBurnLast3.toFixed(2)}, runway ${runwayMonths.toFixed(4)} months, ` +
    `${caseJson.truth.figures.length} figures\n`,
);

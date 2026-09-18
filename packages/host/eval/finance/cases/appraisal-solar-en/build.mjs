/**
 * Deterministic generator for the `appraisal-solar-en` eval case.
 *
 * Writes `rooftop-solar-appraisal.xlsx` — a rooftop solar project with uneven flows and one NEGATIVE
 * mid-life year (the inverter replacement), so the running total goes backwards before it pays back —
 * and `case.json` whose `truth` is computed here by plain arithmetic. Nothing from `@agentforge/core`
 * is imported. The sign pattern gives three sign changes in the flows, so the build asserts that
 * NPV(r) still crosses zero exactly once before trusting the IRR.
 *
 * The workbook XML is byte-identical on every run; only the zip entry timestamps archiver writes
 * differ, so a rebuild can still show up as a git change even when no number moved.
 *
 * Run from `packages/host`:  node eval/finance/cases/appraisal-solar-en/build.mjs
 */
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Pinned so every rebuild is byte-identical; exceljs otherwise stamps the workbook from the clock. */
const FIXED_TIMESTAMP = new Date(Date.UTC(2024, 0, 1));
const XLSX_NAME = "rooftop-solar-appraisal.xlsx";
const SHEET_NAME = "Solar Appraisal";

const YEARS = ["Year 0", "Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Year 6", "Year 7", "Year 8", "Year 9", "Year 10"];
const DISCOUNT_RATE_PCT = 8;

/** Rows as the sheet shows them; index 0 = Year 0. Costs are negative, as an appraisal sheet writes them. */
const ROWS = [
  { label: "Initial investment (array, inverters, install)", values: [-820_000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { label: "Avoided grid electricity cost", values: [0, 152_000, 156_000, 159_000, 163_000, 163_000, 165_000, 168_000, 171_000, 174_000, 177_000] },
  { label: "O&M, monitoring and insurance", values: [0, -14_000, -14_000, -14_000, -14_000, -14_000, -14_000, -14_000, -14_000, -14_000, -14_000] },
  { label: "Inverter replacement and roof works", values: [0, 0, 0, 0, 0, -214_000, 0, 0, 0, 0, 0] },
  { label: "Residual value of the array", values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 45_000] },
];

/** Net cash flow per year = Σ component rows. The sheet shows it as a subtotal row. */
const FLOWS = YEARS.map((_, year) => ROWS.reduce((total, row) => total + row.values[year], 0));

// ---------------------------------------------------------------- oracle ----

/**
 * NPV with flows[0] at t = 0, UNDISCOUNTED — the same timing convention as
 * `packages/core/src/finance/engine.ts#npv`. `rate` is a fraction (0.08 = 8%).
 */
function npv(rate, flows) {
  return flows.reduce((total, flow, year) => total + flow / (1 + rate) ** year, 0);
}

/** Bisection on NPV down to 1e-7 in rate. Only sound once the crossing is known to be unique. */
function irr(flows) {
  let low = -0.9999;
  let high = 10;
  if (npv(low, flows) * npv(high, flows) > 0) {
    throw new Error("IRR is not bracketed by [-0.9999, 10]");
  }
  while (high - low > 1e-7) {
    const mid = (low + high) / 2;
    if (npv(low, flows) * npv(mid, flows) <= 0) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return (low + high) / 2;
}

/** How many times NPV(r) changes sign across the plausible rate range — 1 means the IRR is unique. */
function npvSignChanges(flows) {
  const samples = [];
  for (let rate = -0.98; rate <= 6; rate += 0.0005) {
    samples.push(Math.sign(npv(rate, flows)));
  }
  return samples.filter((sign, i) => i > 0 && sign !== 0 && sign !== samples[i - 1]).length;
}

/** How many times the flows themselves change sign — Descartes' bound on the number of real IRRs. */
function flowSignChanges(flows) {
  const signs = flows.filter((flow) => flow !== 0).map((flow) => Math.sign(flow));
  return signs.filter((sign, i) => i > 0 && sign !== signs[i - 1]).length;
}

const runningTotal = (values, start, upTo) => values.slice(0, upTo + 1).reduce((total, value) => total + value, start);
const cumulative = (flows) => flows.map((_, year) => runningTotal(flows, 0, year));

/**
 * Years until the running total FIRST turns non-negative, plus a linear fraction inside that year:
 * payback = (t - 1) + |cum[t - 1]| / flow[t]. The Year 5 loss drags the running total back down, so a
 * reader that interpolates at the first year the total merely improves gets the wrong answer.
 */
function paybackYears(flows) {
  const cum = cumulative(flows);
  const crossing = cum.findIndex((total, year) => year >= 1 && total >= 0);
  if (crossing < 0) {
    throw new Error("the flows never pay back");
  }
  return crossing - 1 + -cum[crossing - 1] / flows[crossing];
}

const discountedFlows = (rate, flows) => flows.map((flow, year) => flow / (1 + rate) ** year);
const discountedPaybackYears = (rate, flows) => paybackYears(discountedFlows(rate, flows));

/** PI = PV of every flow from t = 1 on, divided by the initial outlay: (NPV - C0) / -C0. */
const profitabilityIndex = (rate, flows) => (npv(rate, flows) - flows[0]) / -flows[0];

/** Scale years 1..N by `factor` — including the negative Year 5, which gets 10% worse or 10% better. */
const scaled = (flows, factor) => flows.map((flow, year) => (year === 0 ? flow : flow * factor));

const rate = DISCOUNT_RATE_PCT / 100;
const baseNpv = npv(rate, FLOWS);
const baseIrr = irr(FLOWS);
const cumFlows = cumulative(FLOWS);
const cumDiscounted = cumulative(discountedFlows(rate, FLOWS));
const signChangesInFlows = flowSignChanges(FLOWS);
const crossings = npvSignChanges(FLOWS);

if (crossings !== 1) {
  throw new Error(`expected exactly one IRR, NPV(r) changes sign ${crossings} times`);
}

const RATE_PCTS = [6, 8, 10];
const FLOW_SHIFTS = [-10, 0, 10];
const sensitivity = RATE_PCTS.flatMap((ratePct) =>
  FLOW_SHIFTS.map((shiftPct) => ({
    ratePct,
    shiftPct,
    value: npv(ratePct / 100, scaled(FLOWS, 1 + shiftPct / 100)),
  })),
);

// ------------------------------------------------------------- workbook ----

const MONEY_FORMAT = '#,##0;(#,##0)';
const BOLD_LABELS = new Set(["Line item", "Net cash flow"]);

function sheetRows() {
  return [
    ["Harbour Lane Logistics — Rooftop Solar Appraisal"],
    [`All figures in USD. Discount rate ${DISCOUNT_RATE_PCT}% per year.`],
    [],
    ["Line item", ...YEARS],
    ...ROWS.map((row) => [row.label, ...row.values]),
    ["Net cash flow", ...FLOWS],
  ];
}

async function writeWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Harbour Lane Logistics";
  workbook.created = FIXED_TIMESTAMP;
  workbook.modified = FIXED_TIMESTAMP;
  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.columns = [{ width: 42 }, ...YEARS.map(() => ({ width: 14 }))];
  for (const values of sheetRows()) {
    const added = sheet.addRow(values);
    added.eachCell({ includeEmpty: false }, (cell, column) => {
      if (column > 1 && typeof cell.value === "number") {
        cell.numFmt = MONEY_FORMAT;
      }
    });
    if (BOLD_LABELS.has(values[0])) {
      added.font = { bold: true };
    }
  }
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 4 }];
  await workbook.xlsx.writeFile(join(HERE, XLSX_NAME));
}

// ------------------------------------------------------------- case.json ----

const EXACT = 1e-9;
const DERIVED = 1e-6;
const NPV_IRR = 0.005;
const figure = (key, label, value, unit, tolerance) => ({ key, label, value, unit, tolerance });
const shiftKey = (shiftPct) => (shiftPct === 0 ? "base" : shiftPct < 0 ? `minus${-shiftPct}` : `plus${shiftPct}`);

function truthLineItems() {
  return ROWS.flatMap((row) =>
    row.values.flatMap((amount, year) =>
      amount === 0 ? [] : [{ label: row.label, period: YEARS[year], amount, category: year === 0 ? "asset" : "cash" }],
    ),
  );
}

function truthFigures() {
  return [
    // Σ flow[t] / (1 + 0.08)^t, t = 0..10, year 0 undiscounted
    figure("npv", `NPV @ ${DISCOUNT_RATE_PCT}%`, baseNpv, "currency", NPV_IRR),
    // rate where NPV = 0, by bisection to 1e-7; verified unique
    figure("irrPct", "IRR", baseIrr * 100, "percent", NPV_IRR),
    // times the flows change sign — 3 here, so uniqueness has to be checked, not assumed
    figure("flowSignChanges", "Sign changes in the cash flows", signChangesInFlows, "count", EXACT),
    // times NPV(r) crosses zero over r in [-0.98, 6] — exactly 1
    figure("npvZeroCrossings", "Zero crossings of NPV(r)", crossings, "count", EXACT),
    // first year the running total turns non-negative, plus |cum[t-1]| / flow[t]
    figure("paybackYears", "Simple payback", paybackYears(FLOWS), "years", DERIVED),
    // the same rule on flows discounted at 8%
    figure("discountedPaybackYears", "Discounted payback", discountedPaybackYears(rate, FLOWS), "years", DERIVED),
    // (NPV - year 0 flow) / -year 0 flow
    figure("profitabilityIndex", "Profitability index", profitabilityIndex(rate, FLOWS), "ratio", DERIVED),
    // net cash flow per year = Σ component rows
    ...YEARS.map((year, i) => figure(`netCashFlow.${year}`, `Net cash flow ${year}`, FLOWS[i], "currency", EXACT)),
    // Σ net cash flow up to year t
    ...YEARS.map((year, i) => figure(`cumulativeCashFlow.${year}`, `Cumulative cash flow ${year}`, cumFlows[i], "currency", EXACT)),
    // Σ discounted flow up to year t, at 8%
    ...YEARS.map((year, i) =>
      figure(`cumulativeDiscountedCashFlow.${year}`, `Cumulative discounted cash flow ${year}`, cumDiscounted[i], "currency", NPV_IRR),
    ),
    // NPV at every (discount rate, cash-flow shift) pair
    ...sensitivity.map((cell) =>
      figure(
        `sensitivityNpv.rate${cell.ratePct}.flows${shiftKey(cell.shiftPct)}`,
        `NPV @ ${cell.ratePct}% with flows ${cell.shiftPct >= 0 ? "+" : ""}${cell.shiftPct}%`,
        cell.value,
        "currency",
        NPV_IRR,
      ),
    ),
  ];
}

const caseJson = {
  id: "appraisal-solar-en",
  task: "appraisal",
  locale: "en",
  currency: "USD",
  description: [
    "Synthetic rooftop solar appraisal: an outlay in Year 0, ten uneven years of net cash flow and a residual",
    "value in Year 10. Year 5 is NEGATIVE (inverter replacement plus roof works), so the running total goes",
    "backwards mid-life and payback must be taken at the FIRST non-negative crossing, not at the first year the",
    "total improves. The table uses a label column and year columns (Year 0…10); the last row 'Net cash flow'",
    "is a SUBTOTAL and must not be added to the component rows above it.",
    `Conventions this oracle used: (1) NPV puts flows[0] at t = 0 UNDISCOUNTED, matching engine npv(), rate ${DISCOUNT_RATE_PCT}%;`,
    "(2) IRR by bisection to 1e-7 — the flows change sign three times, so the build checks NPV(r) over",
    "r in [-0.98, 6] and confirms exactly one zero crossing before reporting an IRR;",
    "(3) payback = (first year cumulative >= 0) - 1 + |cumulative of the year before| / that year's flow;",
    "(4) discounted payback applies the same rule to flows discounted at 8%;",
    "(5) profitability index = (NPV - Year 0 flow) / -Year 0 flow, i.e. PV of Years 1-10 over the initial outlay;",
    "(6) the sensitivity grid scales ONLY Years 1-10 by -10% / 0 / +10% — including the negative Year 5, which",
    "gets 10% worse in the -10% column — while the Year 0 outlay stays fixed.",
    "All `tolerance` values are RELATIVE to the truth value (0.005 = 0.5%).",
  ].join(" "),
  files: [{ path: XLSX_NAME, sheet: SHEET_NAME }],
  prompt:
    "This is the appraisal for the rooftop solar system on our warehouse. Use an 8% discount rate. Work out " +
    "NPV, IRR, simple payback and discounted payback, the profitability index and the cumulative cash flow " +
    "each year, then give me a sensitivity grid of NPV for 6%, 8% and 10% against cash flows at -10%, base " +
    "and +10%. Note that Year 5 is negative because the inverters have to be replaced. Should we build it?",
  params: { discountRate: DISCOUNT_RATE_PCT, rateScenarios: RATE_PCTS, cashFlowShifts: FLOW_SHIFTS },
  truth: {
    lineItems: truthLineItems(),
    figures: truthFigures(),
    mustMention: ["NPV", "IRR", "payback", "sensitivity", "Year 5"],
    mustNotContain: ["[unverified figure]"],
  },
};

await writeWorkbook();
await writeFile(join(HERE, "case.json"), `${JSON.stringify(caseJson, null, 2)}\n`, "utf8");
process.stdout.write(
  `wrote ${XLSX_NAME} and case.json — NPV ${baseNpv.toFixed(2)}, IRR ${(baseIrr * 100).toFixed(4)}%, ` +
    `flow sign changes ${signChangesInFlows}, NPV crossings ${crossings}, ` +
    `payback ${paybackYears(FLOWS).toFixed(4)}y, disc. payback ${discountedPaybackYears(rate, FLOWS).toFixed(4)}y, ` +
    `${caseJson.truth.figures.length} figures\n`,
);

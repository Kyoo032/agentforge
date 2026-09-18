/**
 * Deterministic generator for the `appraisal-mesin` eval case.
 *
 * Writes `kelayakan-mesin-roasting.xlsx` — a machine purchase laid out with a label column and year
 * columns (Tahun 0…6) — and `case.json` whose `truth` is computed here by plain arithmetic. Nothing
 * from `@agentforge/core` is imported: NPV, IRR, payback and the sensitivity grid are re-derived from
 * first principles so the oracle is independent of the engine under test.
 *
 * The workbook XML is byte-identical on every run; only the zip entry timestamps archiver writes
 * differ, so a rebuild can still show up as a git change even when no number moved.
 *
 * Run from `packages/host`:  node eval/finance/cases/appraisal-mesin/build.mjs
 */
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Pinned so every rebuild is byte-identical; exceljs otherwise stamps the workbook from the clock. */
const FIXED_TIMESTAMP = new Date(Date.UTC(2024, 0, 1));
const XLSX_NAME = "kelayakan-mesin-roasting.xlsx";
const SHEET_NAME = "Kelayakan Mesin";

const YEARS = ["Tahun 0", "Tahun 1", "Tahun 2", "Tahun 3", "Tahun 4", "Tahun 5", "Tahun 6"];
const DISCOUNT_RATE_PCT = 12;

/** Rows as the sheet shows them; index 0 = Tahun 0. Outflows are negative, as an appraisal sheet writes them. */
const ROWS = [
  { label: "Investasi awal (mesin + instalasi)", values: [-1_450_000_000, 0, 0, 0, 0, 0, 0] },
  { label: "Penghematan biaya & tambahan pendapatan", values: [0, 345_000_000, 412_000_000, 470_000_000, 498_000_000, 492_000_000, 465_000_000] },
  { label: "Biaya operasi & perawatan", values: [0, -60_000_000, -72_000_000, -75_000_000, -78_000_000, -82_000_000, -85_000_000] },
  { label: "Nilai sisa (salvage)", values: [0, 0, 0, 0, 0, 0, 180_000_000] },
];

/** Arus kas bersih per tahun = Σ baris komponen. The sheet shows it as a subtotal row. */
const FLOWS = YEARS.map((_, year) => ROWS.reduce((total, row) => total + row.values[year], 0));

// ---------------------------------------------------------------- oracle ----

/**
 * NPV with flows[0] at t = 0, UNDISCOUNTED — the same timing convention as
 * `packages/core/src/finance/engine.ts#npv`. `rate` is a fraction (0.12 = 12%).
 */
function npv(rate, flows) {
  return flows.reduce((total, flow, year) => total + flow / (1 + rate) ** year, 0);
}

/** Bisection on NPV down to 1e-7 in rate. Assumes a single crossing (asserted below). */
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

/** Running total of the flows, index-aligned with the years. */
const runningTotal = (values, start, upTo) => values.slice(0, upTo + 1).reduce((total, value) => total + value, start);
const cumulative = (flows) => flows.map((_, year) => runningTotal(flows, 0, year));

/**
 * Years until the running total first turns non-negative, with a linear fraction inside that year:
 * payback = (t - 1) + |cum[t - 1]| / flow[t]. Years are counted from t = 0, where the outlay sits.
 * A year that pushes the running total further down (solar's mid-life maintenance) is simply skipped,
 * because only the FIRST non-negative crossing counts.
 */
function paybackYears(flows) {
  const cum = cumulative(flows);
  const crossing = cum.findIndex((total, year) => year >= 1 && total >= 0);
  if (crossing < 0) {
    throw new Error("the flows never pay back");
  }
  return crossing - 1 + -cum[crossing - 1] / flows[crossing];
}

/** Same rule applied to the discounted flows. */
const discountedFlows = (rate, flows) => flows.map((flow, year) => flow / (1 + rate) ** year);
const discountedPaybackYears = (rate, flows) => paybackYears(discountedFlows(rate, flows));

/** PI = PV of every flow from t = 1 on, divided by the initial outlay: (NPV - C0) / -C0. */
const profitabilityIndex = (rate, flows) => (npv(rate, flows) - flows[0]) / -flows[0];

/** Scale years 1..N by `factor`; the year-0 outlay is contractual and never scaled. */
const scaled = (flows, factor) => flows.map((flow, year) => (year === 0 ? flow : flow * factor));

const rate = DISCOUNT_RATE_PCT / 100;
const baseNpv = npv(rate, FLOWS);
const baseIrr = irr(FLOWS);
const cumFlows = cumulative(FLOWS);
const cumDiscounted = cumulative(discountedFlows(rate, FLOWS));

if (npvSignChanges(FLOWS) !== 1) {
  throw new Error(`expected exactly one IRR, NPV(r) changes sign ${npvSignChanges(FLOWS)} times`);
}

const RATE_PCTS = [10, 12, 14];
const FLOW_SHIFTS = [-10, 0, 10];
/** NPV at every (discount rate, cash-flow shift) pair. */
const sensitivity = RATE_PCTS.flatMap((ratePct) =>
  FLOW_SHIFTS.map((shiftPct) => ({
    ratePct,
    shiftPct,
    value: npv(ratePct / 100, scaled(FLOWS, 1 + shiftPct / 100)),
  })),
);

// ------------------------------------------------------------- workbook ----

const MONEY_FORMAT = '#,##0;(#,##0)';
const BOLD_LABELS = new Set(["Komponen", "Arus kas bersih"]);

function sheetRows() {
  return [
    ["PT Senja Roastery — Analisa Kelayakan Mesin Roasting"],
    [`Semua angka dalam Rupiah. Tingkat diskonto ${DISCOUNT_RATE_PCT}% per tahun.`],
    [],
    ["Komponen", ...YEARS],
    ...ROWS.map((row) => [row.label, ...row.values]),
    ["Arus kas bersih", ...FLOWS],
  ];
}

async function writeWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PT Senja Roastery";
  workbook.created = FIXED_TIMESTAMP;
  workbook.modified = FIXED_TIMESTAMP;
  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.columns = [{ width: 42 }, ...YEARS.map(() => ({ width: 18 }))];
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
    // Σ flow[t] / (1 + 0.12)^t, t = 0..6, year 0 undiscounted
    figure("npv", `NPV @ ${DISCOUNT_RATE_PCT}%`, baseNpv, "currency", NPV_IRR),
    // rate where NPV = 0, by bisection to 1e-7
    figure("irrPct", "IRR", baseIrr * 100, "percent", NPV_IRR),
    // first year the running total turns non-negative, plus |cum[t-1]| / flow[t]
    figure("paybackYears", "Payback sederhana", paybackYears(FLOWS), "years", DERIVED),
    // the same rule on flows discounted at 12%
    figure("discountedPaybackYears", "Payback terdiskonto", discountedPaybackYears(rate, FLOWS), "years", DERIVED),
    // (NPV - arus tahun 0) / -arus tahun 0
    figure("profitabilityIndex", "Profitability index", profitabilityIndex(rate, FLOWS), "ratio", DERIVED),
    // arus kas bersih per tahun = Σ baris komponen
    ...YEARS.map((year, i) => figure(`netCashFlow.${year}`, `Arus kas bersih ${year}`, FLOWS[i], "currency", EXACT)),
    // Σ arus kas bersih sampai tahun t
    ...YEARS.map((year, i) => figure(`cumulativeCashFlow.${year}`, `Arus kas kumulatif ${year}`, cumFlows[i], "currency", EXACT)),
    // Σ arus terdiskonto sampai tahun t, diskonto 12%
    ...YEARS.map((year, i) =>
      figure(`cumulativeDiscountedCashFlow.${year}`, `Arus terdiskonto kumulatif ${year}`, cumDiscounted[i], "currency", NPV_IRR),
    ),
    // NPV pada tiap pasangan (diskonto, pergeseran arus tahun 1-6)
    ...sensitivity.map((cell) =>
      figure(
        `sensitivityNpv.rate${cell.ratePct}.flows${shiftKey(cell.shiftPct)}`,
        `NPV @ ${cell.ratePct}% dengan arus ${cell.shiftPct >= 0 ? "+" : ""}${cell.shiftPct}%`,
        cell.value,
        "currency",
        NPV_IRR,
      ),
    ),
  ];
}

const caseJson = {
  id: "appraisal-mesin",
  task: "appraisal",
  locale: "id",
  currency: "IDR",
  description: [
    "Pembelian mesin roasting (sintetis): investasi awal di Tahun 0, enam tahun arus kas bersih, dan nilai",
    "sisa di tahun terakhir. Tabel memakai kolom tahun (Tahun 0…6) dengan satu kolom label, dan baris",
    "terakhir 'Arus kas bersih' adalah SUBTOTAL — tidak boleh dijumlahkan lagi bersama baris komponennya.",
    `Konvensi oracle: (1) NPV memakai flows[0] di t = 0 TANPA didiskonto (sama dengan engine npv()), rate ${DISCOUNT_RATE_PCT}%;`,
    "(2) IRR dicari dengan bisection sampai 1e-7 dan sudah diverifikasi tunggal (NPV(r) hanya sekali ganti tanda);",
    "(3) payback = tahun pertama arus kumulatif >= 0, dikurangi 1, ditambah |kumulatif tahun sebelumnya| / arus tahun itu;",
    "(4) payback terdiskonto memakai aturan yang sama atas arus yang sudah didiskonto 12%;",
    "(5) profitability index = (NPV - arus Tahun 0) / -arus Tahun 0, yaitu PV arus Tahun 1-6 dibagi investasi awal;",
    "(6) grid sensitivitas menggeser HANYA arus Tahun 1-6 sebesar -10% / 0 / +10%; investasi Tahun 0 tetap.",
    "Semua `tolerance` bersifat RELATIF terhadap nilai kebenaran (0.005 = 0,5%).",
  ].join(" "),
  files: [{ path: XLSX_NAME, sheet: SHEET_NAME }],
  prompt:
    "Ini rencana pembelian mesin roasting kami. Diskonto 12% per tahun. Tolong hitung NPV, IRR, payback " +
    "sederhana dan payback terdiskonto, profitability index, arus kas kumulatif tiap tahun, lalu buat grid " +
    "sensitivitas NPV untuk diskonto 10%, 12%, 14% dikali arus kas -10%, dasar, dan +10%. Layak atau tidak?",
  params: { discountRate: DISCOUNT_RATE_PCT, rateScenarios: RATE_PCTS, cashFlowShifts: FLOW_SHIFTS },
  truth: {
    lineItems: truthLineItems(),
    figures: truthFigures(),
    mustMention: ["NPV", "IRR", "payback", "sensitivitas"],
    mustNotContain: ["[unverified figure]", "[angka belum diverifikasi]"],
  },
};

await writeWorkbook();
await writeFile(join(HERE, "case.json"), `${JSON.stringify(caseJson, null, 2)}\n`, "utf8");
process.stdout.write(
  `wrote ${XLSX_NAME} and case.json — NPV ${baseNpv.toFixed(2)}, IRR ${(baseIrr * 100).toFixed(4)}%, ` +
    `payback ${paybackYears(FLOWS).toFixed(4)}y, disc. payback ${discountedPaybackYears(rate, FLOWS).toFixed(4)}y, ` +
    `${caseJson.truth.figures.length} figures\n`,
);

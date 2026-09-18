/**
 * Deterministic generator for the `cashflow-kafe-12m` eval case.
 *
 * Writes `buku-kas-kopi-senja-2024.xlsx` (a café's 12-month cash book, months as COLUMNS, the way an
 * Indonesian owner actually keeps it) and `case.json` whose `truth` is computed here by plain
 * arithmetic only — nothing from `@agentforge/core` is imported, so the oracle is independent of the
 * engine under test. Fixed literals throughout: no Math.random, no Date.now.
 *
 * The workbook XML is byte-identical on every run; only the zip entry timestamps archiver writes
 * differ, so a rebuild can still show up as a git change even when no number moved.
 *
 * Run from `packages/host`:  node eval/finance/cases/cashflow-kafe-12m/build.mjs
 */
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Pinned so every rebuild is byte-identical; exceljs otherwise stamps the workbook from the clock. */
const FIXED_TIMESTAMP = new Date(Date.UTC(2024, 0, 1));
const XLSX_NAME = "buku-kas-kopi-senja-2024.xlsx";
const SHEET_NAME = "Arus Kas 2024";

/** Column headers. Indonesian month names + the year, so each period label stands on its own. */
const MONTHS = [
  "Jan 2024",
  "Feb 2024",
  "Mar 2024",
  "Apr 2024",
  "Mei 2024",
  "Jun 2024",
  "Jul 2024",
  "Agu 2024",
  "Sep 2024",
  "Okt 2024",
  "Nov 2024",
  "Des 2024",
];

/** Cash in the till on 1 Jan 2024, written above the table the way the owner keeps it. */
const OPENING_CASH = 45_000_000;

const CASH_IN = [
  { label: "Penjualan tunai", values: [54_200_000, 51_800_000, 56_400_000, 60_900_000, 64_300_000, 58_100_000, 49_600_000, 59_200_000, 62_100_000, 55_700_000, 45_800_000, 42_300_000] },
  { label: "Penjualan QRIS & transfer", values: [33_600_000, 32_100_000, 35_900_000, 39_200_000, 41_700_000, 37_400_000, 31_200_000, 38_100_000, 40_300_000, 35_600_000, 28_900_000, 26_400_000] },
  { label: "Pendapatan katering", values: [0, 3_500_000, 0, 6_000_000, 4_500_000, 0, 0, 5_500_000, 0, 0, 2_000_000, 0] },
  { label: "Penjualan biji kopi retail", values: [4_200_000, 3_900_000, 4_600_000, 5_100_000, 5_400_000, 4_300_000, 3_600_000, 4_700_000, 5_000_000, 4_100_000, 3_200_000, 2_900_000] },
];

/** Cash out is written as a positive magnitude under "KAS KELUAR", as a paper cash book does. */
const CASH_OUT = [
  { label: "Pembelian bahan baku", kind: "variable", values: [34_100_000, 33_000_000, 36_200_000, 40_600_000, 42_800_000, 38_000_000, 32_000_000, 40_100_000, 41_400_000, 36_300_000, 30_400_000, 27_800_000] },
  { label: "Gaji & upah", kind: "fixed", values: [22_000_000, 22_000_000, 22_000_000, 33_000_000, 22_000_000, 22_000_000, 22_000_000, 22_000_000, 22_000_000, 22_000_000, 22_000_000, 22_000_000] },
  { label: "Sewa tempat", kind: "fixed", values: [15_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000, 15_000_000] },
  { label: "Listrik & air", kind: "fixed", values: [6_800_000, 6_500_000, 7_100_000, 7_600_000, 7_900_000, 7_300_000, 6_400_000, 7_200_000, 7_500_000, 7_000_000, 6_200_000, 5_900_000] },
  { label: "Internet & langganan", kind: "fixed", values: [1_250_000, 1_250_000, 1_250_000, 1_250_000, 1_250_000, 1_250_000, 1_250_000, 1_250_000, 1_250_000, 1_250_000, 1_250_000, 1_250_000] },
  { label: "Pemasaran & promosi", kind: "fixed", values: [3_000_000, 2_500_000, 3_500_000, 5_000_000, 4_000_000, 3_000_000, 2_000_000, 3_500_000, 4_000_000, 6_000_000, 9_000_000, 9_000_000] },
  { label: "Perlengkapan & kemasan", kind: "variable", values: [4_500_000, 4_200_000, 4_800_000, 5_300_000, 5_600_000, 4_900_000, 4_100_000, 5_000_000, 5_200_000, 4_600_000, 3_900_000, 3_600_000] },
  { label: "Pajak & retribusi", kind: "fixed", values: [2_100_000, 2_000_000, 2_200_000, 2_400_000, 2_500_000, 2_300_000, 1_900_000, 2_300_000, 2_400_000, 2_200_000, 1_800_000, 1_700_000] },
  { label: "Perawatan mesin (overhaul)", kind: "oneOff", values: [0, 0, 0, 0, 0, 0, 12_000_000, 0, 0, 0, 0, 0] },
];

const RENT_LABEL = "Sewa tempat";
const MONEY_FORMAT = '#,##0;(#,##0)';

// ---------------------------------------------------------------- oracle ----

/** Column-wise sum of every row in a block. */
function columnTotals(rows) {
  return MONTHS.map((_, i) => rows.reduce((sum, row) => sum + row.values[i], 0));
}

const totalIn = columnTotals(CASH_IN); // Total masuk[m] = Σ cash-in rows[m]
const totalOut = columnTotals(CASH_OUT); // Total keluar[m] = Σ cash-out rows[m]
const netCash = MONTHS.map((_, i) => totalIn[i] - totalOut[i]); // Arus kas bersih[m] = masuk[m] - keluar[m]

/** Saldo akhir[m] = saldo akhir[m-1] + net[m]; saldo akhir[-1] = saldo awal. */
const closing = netCash.map((_, i) => netCash.slice(0, i + 1).reduce((total, net) => total + net, OPENING_CASH));

const negativeIdx = netCash.flatMap((net, i) => (net < 0 ? [i] : []));
// Average burn over the loss-making months = -(Σ negative nets) / count(negative months)
const burnNegative = -negativeIdx.reduce((sum, i) => sum + netCash[i], 0) / negativeIdx.length;
const lastThree = netCash.slice(-3);
// Average burn over the last 3 months = -(Σ net of Okt..Des) / 3. Positive = cash leaving.
const burnLastThree = -lastThree.reduce((sum, net) => sum + net, 0) / 3;
const closingCash = closing.at(-1);
// Runway = closing cash / average monthly burn (engine convention: runwayMonths(cash, burn) = cash/burn)
const runwayLastThree = closingCash / burnLastThree;
const runwayNegative = closingCash / burnNegative;

// --------------------------------------------------- breakeven & what-if ----

const sumOf = (values) => values.reduce((sum, value) => sum + value, 0);
const outBy = (kind) => CASH_OUT.filter((row) => row.kind === kind);
const annualRevenue = sumOf(totalIn); // all 12 months of cash in
const annualVariable = sumOf(outBy("variable").map((row) => sumOf(row.values)));
const annualFixed = sumOf(outBy("fixed").map((row) => sumOf(row.values)));
// Contribution margin ratio = 1 - variable cost / revenue. One-off overhaul is excluded from both.
const contributionMarginRatio = 1 - annualVariable / annualRevenue;
// Breakeven revenue = fixed costs / contribution margin ratio (engine: fixed / (cm% / 100))
const breakevenAnnual = annualFixed / contributionMarginRatio;
const breakevenMonthly = annualFixed / 12 / contributionMarginRatio;

const DEC = MONTHS.length - 1;
const RENT_CUT = 0.15;
const SALES_LIFT = 0.10;
const decRent = CASH_OUT.find((row) => row.label === RENT_LABEL).values[DEC];
const decVariable = sumOf(outBy("variable").map((row) => row.values[DEC]));
// New net = old net + sales lift - variable cost that scales with the lift + rent saved.
const whatIfNet =
  netCash[DEC] + totalIn[DEC] * SALES_LIFT - decVariable * SALES_LIFT + decRent * RENT_CUT;
const whatIfRunway = closingCash / -whatIfNet; // still a burn, so runway = cash / -net

// Months of burn the closing balance survives, then the month the till hits zero.
const monthsToZero = runwayLastThree;
const ZERO_MONTH_LABEL = "September 2025"; // Des 2024 + ceil(8.28) months

// ------------------------------------------------------------- workbook ----

/** The table body: section captions, category rows and the three subtotal rows. */
function sheetRows() {
  const row = (label, values) => [label, ...values];
  return [
    ["Buku Kas — Kafe Kopi Senja"],
    ["Periode: Januari – Desember 2024 (dalam Rupiah)"],
    ["Saldo awal (1 Jan 2024)", OPENING_CASH],
    [],
    ["Keterangan", ...MONTHS],
    ["KAS MASUK"],
    ...CASH_IN.map((item) => row(item.label, item.values)),
    row("Total masuk", totalIn),
    ["KAS KELUAR"],
    ...CASH_OUT.map((item) => row(item.label, item.values)),
    row("Total keluar", totalOut),
    row("Arus kas bersih", netCash),
    row("Saldo akhir", closing),
  ];
}

const BOLD_LABELS = new Set([
  "Keterangan",
  "KAS MASUK",
  "KAS KELUAR",
  "Total masuk",
  "Total keluar",
  "Arus kas bersih",
  "Saldo akhir",
]);

async function writeWorkbook() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Kafe Kopi Senja";
  workbook.created = FIXED_TIMESTAMP;
  workbook.modified = FIXED_TIMESTAMP;
  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.columns = [{ width: 30 }, ...MONTHS.map(() => ({ width: 15 }))];
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
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 5 }];
  await workbook.xlsx.writeFile(join(HERE, XLSX_NAME));
}

// ------------------------------------------------------------- case.json ----

const EXACT = 1e-9;
const DERIVED = 1e-6;

const figure = (key, label, value, unit, tolerance) => ({ key, label, value, unit, tolerance });

/** One line item per month per side, so the runner can check the periods were split correctly. */
function truthLineItems() {
  return MONTHS.flatMap((period, i) => [
    { label: "Total kas masuk", period, amount: totalIn[i], category: "revenue" },
    { label: "Total kas keluar", period, amount: totalOut[i], category: "opex" },
  ]);
}

function truthFigures() {
  return [
    ...MONTHS.map((period, i) =>
      // net[m] = Σ cash-in rows[m] - Σ cash-out rows[m]
      figure(`netCash.${period}`, `Arus kas bersih ${period}`, netCash[i], "currency", EXACT),
    ),
    ...MONTHS.map((period, i) =>
      // saldo akhir[m] = saldo awal + Σ net[0..m]
      figure(`closingCash.${period}`, `Saldo akhir ${period}`, closing[i], "currency", EXACT),
    ),
    // Σ of the 12 monthly cash-in totals
    figure("totalCashIn.2024", "Total kas masuk 2024", annualRevenue, "currency", EXACT),
    // Σ of the 12 monthly cash-out totals
    figure("totalCashOut.2024", "Total kas keluar 2024", sumOf(totalOut), "currency", EXACT),
    // -(Σ net over Jul, Nov, Des) / 3
    figure("averageBurn.negativeMonths", "Rata-rata burn bulan minus", burnNegative, "currency", DERIVED),
    // -(net Okt + net Nov + net Des) / 3
    figure("averageBurn.last3Months", "Rata-rata burn 3 bulan terakhir", burnLastThree, "currency", DERIVED),
    // saldo akhir Des / burn over the 3 loss months
    figure("runwayMonths.negativeMonths", "Runway pada burn bulan minus", runwayNegative, "months", DERIVED),
    // saldo akhir Des / burn over Okt..Des
    figure("runwayMonths.last3Months", "Runway pada burn 3 bulan terakhir", runwayLastThree, "months", DERIVED),
    // same figure read as "how many months until the till is empty"
    figure("monthsToZeroCash", "Bulan sampai kas habis", monthsToZero, "months", DERIVED),
    // fixed costs / (1 - variable / revenue), per month
    figure("breakevenRevenue.monthly", "Pendapatan BEP per bulan", breakevenMonthly, "currency", DERIVED),
    // fixed costs / (1 - variable / revenue), full year
    figure("breakevenRevenue.annual", "Pendapatan BEP setahun", breakevenAnnual, "currency", DERIVED),
    // 1 - variable / revenue, as a percentage
    figure("contributionMarginPct", "Margin kontribusi", contributionMarginRatio * 100, "percent", DERIVED),
    // net Des + 10% of cash in Des - 10% of variable cost Des + 15% of rent Des
    figure("whatIf.netCash.monthly", "Arus kas bersih setelah skenario", whatIfNet, "currency", DERIVED),
    // saldo akhir Des / -(new net)
    figure("whatIf.runwayMonths", "Runway setelah skenario", whatIfRunway, "months", DERIVED),
  ];
}

const caseJson = {
  id: "cashflow-kafe-12m",
  task: "cashflow",
  locale: "id",
  currency: "IDR",
  description: [
    "Buku kas 12 bulan Kafe Kopi Senja (sintetis). Bulan sebagai KOLOM, saldo awal ditulis di atas tabel,",
    "dan ada tiga baris subtotal (Total masuk / Total keluar / Arus kas bersih) plus baris Saldo akhir —",
    "keempatnya tidak boleh ikut dijumlahkan sebagai kategori.",
    "Konvensi yang dipakai oracle ini: (1) arus kas bersih = total masuk - total keluar per bulan;",
    "(2) saldo akhir bulan = saldo akhir bulan sebelumnya + arus kas bersih, saldo awal 45.000.000;",
    "(3) burn = nilai positif dari arus kas bersih yang negatif; runway = saldo akhir Des / burn rata-rata",
    "(sama seperti runwayMonths(cash, burn) = cash / burn di engine);",
    "(4) biaya variabel = Pembelian bahan baku + Perlengkapan & kemasan, biaya tetap = sisanya KECUALI",
    "Perawatan mesin (overhaul) yang bersifat sekali jalan, sehingga BEP = biaya tetap / margin kontribusi;",
    "(5) skenario dihitung dari basis bulan Desember 2024: penjualan +10% ikut menaikkan biaya variabel 10%,",
    "sewa turun 15%.",
    "Semua `tolerance` bersifat RELATIF terhadap nilai kebenaran (0.005 = 0,5%).",
  ].join(" "),
  files: [{ path: XLSX_NAME, sheet: SHEET_NAME }],
  prompt:
    "Ini buku kas kafe saya sepanjang 2024. Tolong hitung arus kas bersih tiap bulan, saldo akhir tiap bulan, " +
    "rata-rata burn di bulan-bulan yang minus dan di 3 bulan terakhir, runway dari saldo akhir Desember, " +
    "bulan berapa kas saya habis kalau burn 3 bulan terakhir berlanjut, dan berapa omzet BEP per bulan. " +
    "Lalu satu skenario: kalau sewa dipotong 15% dan penjualan naik 10% mulai bulan depan, berapa arus kas " +
    "bersih dan runway barunya?",
  params: { openingCash: OPENING_CASH, rentCutPct: 15, salesLiftPct: 10 },
  truth: {
    lineItems: truthLineItems(),
    figures: truthFigures(),
    mustMention: ["runway", "saldo akhir", "burn", "BEP", ZERO_MONTH_LABEL],
    mustNotContain: ["[unverified figure]", "[angka belum diverifikasi]"],
  },
};

await writeWorkbook();
await writeFile(join(HERE, "case.json"), `${JSON.stringify(caseJson, null, 2)}\n`, "utf8");
process.stdout.write(
  `wrote ${XLSX_NAME} and case.json — net Des ${netCash[DEC]}, saldo akhir ${closingCash}, ` +
    `runway ${runwayLastThree.toFixed(4)} bulan, ${caseJson.truth.figures.length} figures\n`,
);

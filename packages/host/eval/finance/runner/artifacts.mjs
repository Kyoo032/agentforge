/**
 * The files the app produced, opened and read back.
 *
 * An export is the artefact the owner actually keeps, so it is checked as one: the
 * workbook is re-opened with exceljs and its Summary numbers are matched against
 * the report's own KPIs, and every live formula on the Calc sheet is asked for its
 * cached result — a formula whose cache disagrees with the number on screen is a
 * file that will change its mind the first time Excel recalculates it. The deck is
 * asked how many chart parts it really contains, because a chart that silently
 * became a picture of nothing is not visible from a byte count.
 *
 * The pure half (what the numbers should be, and what a mismatch is called) is
 * separated from the two functions that touch bytes, so it can be tested without
 * a running app.
 */
import ExcelJS from "exceljs";

/** Sheet names the xlsx renderer pins. Anything else is one sheet per extra table. */
export const SUMMARY_SHEET = "Summary";
export const CALC_SHEET = "Calc";
export const INPUTS_SHEET = "Inputs";

/** Row 1 is the header; data starts here. Matches `REPORT_TABLE_FIRST_DATA_ROW` in core. */
const FIRST_DATA_ROW = 2;

/**
 * A `heat` chart is drawn as a table of coloured cells, not as a chart part, so it
 * is not counted. Every other kind must reach the deck as a real chart.
 */
export function expectedChartParts(report) {
  return (report?.charts ?? []).filter((chart) => chart.kind !== "heat").length;
}

/** The chart parts inside a pptx, from the list of names its zip holds. */
export function chartPartNames(names) {
  return [...new Set((names ?? []).filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name)))].sort();
}

/**
 * Every numeric KPI the report puts on its Summary sheet, and whether the workbook
 * really carries it. A KPI whose value is a string (an "n/a", a band name) is not
 * a number and is not asked for.
 */
export function summaryNumbersCheck(report, workbook, matches) {
  const wanted = (report?.summary ?? []).filter((kpi) => typeof kpi.value === "number" && Number.isFinite(kpi.value));
  const sheet = (workbook?.sheets ?? []).find((one) => one.name === SUMMARY_SHEET);
  if (!sheet) {
    return {
      available: false,
      total: wanted.length,
      found: 0,
      missing: wanted.map((kpi) => kpi.label),
      why: `the workbook has no "${SUMMARY_SHEET}" sheet (sheets: ${(workbook?.sheetNames ?? []).join(", ") || "none"})`,
    };
  }
  const missing = wanted.filter((kpi) => !sheet.values.some((value) => matches(kpi.value, value, undefined)));
  return {
    available: true,
    total: wanted.length,
    found: wanted.length - missing.length,
    missing: missing.map((kpi) => `${kpi.label} = ${kpi.value}`),
    why: null,
  };
}

/**
 * Every live formula on the Calc sheet against the number the report states in the
 * same cell. A formula with no cached result at all is the worst case: the file
 * opens blank until it is recalculated.
 */
export function calcFormulaCheck(report, workbook, matches) {
  const sheet = (workbook?.sheets ?? []).find((one) => one.name === CALC_SHEET);
  const table = (report?.tables ?? []).find((one) => one.id === "calc");
  if (!sheet || !table) {
    return {
      available: false,
      total: 0,
      cached: 0,
      mismatches: [],
      uncached: [],
      why: sheet ? "the report has no calc table" : "the workbook has no Calc sheet",
    };
  }
  const mismatches = [];
  const uncached = [];
  for (const cell of sheet.formulaCells) {
    const expected = table.rows?.[cell.row - FIRST_DATA_ROW]?.[cell.column - 1];
    if (!Number.isFinite(cell.result)) {
      uncached.push({ address: cell.address, formula: cell.formula, expected });
      continue;
    }
    if (typeof expected === "number" && !matches(expected, cell.result, undefined)) {
      mismatches.push({ address: cell.address, formula: cell.formula, expected, cached: cell.result });
    }
  }
  return {
    available: true,
    total: sheet.formulaCells.length,
    cached: sheet.formulaCells.length - uncached.length,
    mismatches,
    uncached,
    why: null,
  };
}

/**
 * Re-open one workbook and read every number, every formula and every formula's
 * cached result back out of it.
 */
export async function readWorkbook(bytes) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  const sheets = workbook.worksheets.map((sheet) => {
    const values = [];
    const formulas = [];
    const formulaCells = [];
    sheet.eachRow((row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        const raw = cell.value;
        if (typeof raw === "number") {
          values.push(raw);
          return;
        }
        if (raw && typeof raw === "object" && typeof raw.formula === "string") {
          formulas.push(raw.formula);
          formulaCells.push({
            address: cell.address,
            row: rowNumber,
            column: columnNumber,
            formula: raw.formula,
            // exceljs drops a falsy `result` from `cell.value` (a cached 0 reads as absent); the cell
            // model keeps it, so a zero-valued formula is not miscounted as uncached.
            result: typeof cell.result === "number" ? cell.result : Number.NaN,
          });
          if (typeof cell.result === "number") {
            values.push(cell.result);
          }
        }
      });
    });
    return { name: sheet.name, values, formulas, formulaCells };
  });
  return { sheetNames: sheets.map((sheet) => sheet.name), sheets };
}

/**
 * The chart parts in a deck. `jszip` rides in with exceljs; when it cannot be
 * resolved the count is reported as unavailable rather than as zero, because zero
 * is a verdict and "we could not look" is not.
 */
export async function readDeckCharts(bytes) {
  let JSZip;
  try {
    ({ default: JSZip } = await import("jszip"));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { available: false, charts: 0, names: [], why: `the deck could not be opened: ${why}` };
  }
  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  const names = chartPartNames(Object.keys(zip.files));
  return { available: true, charts: names.length, names, why: null };
}

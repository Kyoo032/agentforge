import { describe, expect, it } from "vitest";
import { calcDrift, calcFormulaChecks } from "../__fixtures__/calc-formulas";
import { REPORT_TABLE_FIRST_DATA_ROW } from "../report";
import { ratiosTaskModule } from "../tasks/ratios";
import { manufakturRows } from "./__fixtures__/manufaktur";
import { ratioCalcTable, ratioInputsTable } from "./report-tables";

/** The two supporting lines a P&L does not print, which a reader types into the panel instead. */
const SUPPORTING_LABELS = new Set(["Beban Penyusutan dan Amortisasi", "Pembayaran Pokok Pinjaman"]);

function computedWith(rows: ReturnType<typeof manufakturRows>, params: Record<string, unknown>) {
  return ratiosTaskModule.compute(
    ratiosTaskModule.inputSchema.parse({
      items: rows.map((row) => ({ label: row.label, period: row.period, amount: row.amount, currency: "IDR" })),
      params,
    }),
  );
}

function tablesFor(rows: ReturnType<typeof manufakturRows>, params: Record<string, unknown> = {}) {
  const computed = computedWith(rows, params);
  return {
    computed,
    inputs: ratioInputsTable(computed.ratios, "en"),
    calc: ratioCalcTable(computed.ratios, "en", computed.period),
  };
}

describe("the ratio Calc sheet's live formulas", () => {
  it("compute what the report states when the statement carries every row", () => {
    const { inputs, calc } = tablesFor(manufakturRows());
    expect(calcDrift(calcFormulaChecks(inputs, calc))).toEqual([]);
  });

  // EBITDA and DSCR read a typed depreciation and repayment when no row carries them; the workbook
  // can only sum Inputs rows, so the typed figures have to be rows there too.
  it("compute EBITDA and DSCR from typed supporting figures the same way the report did", () => {
    const thin = manufakturRows().filter((row) => !SUPPORTING_LABELS.has(row.label));
    const { computed, inputs, calc } = tablesFor(thin, {
      depreciation: 750_000_000,
      principalRepayment: 1_050_000_000,
    });
    const values = computed.ratios.byPeriod.find((entry) => entry.period === "2024")?.values ?? {};
    expect(values.depreciation).toBe(750_000_000);
    expect(values.debtService).toBe(1_866_000_000);
    const checks = calcFormulaChecks(inputs, calc);
    expect(checks.map((check) => check.label)).toEqual(expect.arrayContaining(["EBITDA", "DSCR (EBITDA basis)"]));
    expect(calcDrift(checks)).toEqual([]);
  });

  // The schema lets a typed figure be negative; the workbook reads both buckets as sizes (`ABS`), so
  // the report has to as well, or EBITDA, debt service and both DSCRs say one thing and compute another.
  it("reads a typed figure written negative the way the workbook's formulas do", () => {
    const thin = manufakturRows().filter((row) => !SUPPORTING_LABELS.has(row.label));
    const { computed, inputs, calc } = tablesFor(thin, {
      depreciation: -750_000_000,
      principalRepayment: -1_050_000_000,
    });
    const values = computed.ratios.byPeriod.find((entry) => entry.period === "2024")?.values ?? {};
    expect(values.depreciation).toBe(750_000_000);
    expect(values.debtService).toBe(1_866_000_000);
    expect(values.dscrEbitda).toBeCloseTo(2.4598, 4);
    expect(calcDrift(calcFormulaChecks(inputs, calc))).toEqual([]);
    // The typed rows on Inputs carry the amount the report used, so an edit there moves both alike.
    const typed = inputs.rows.filter((row) => row[2] === "depreciation" || row[2] === "principal-repayment");
    expect(typed.map((row) => [row[1], row[2], row[3]])).toEqual([
      ["2023", "depreciation", 750_000_000],
      ["2023", "principal-repayment", 1_050_000_000],
      ["2024", "depreciation", 750_000_000],
      ["2024", "principal-repayment", 1_050_000_000],
    ]);
  });

  it("adds no typed row where a confirmed row already carries the figure", () => {
    const withRows = tablesFor(manufakturRows(), { depreciation: 1, principalRepayment: 1 });
    expect(withRows.inputs.rows).toHaveLength(manufakturRows().length);
  });

  it("names a typed row for what it is, in the report's language", () => {
    const thin = manufakturRows().filter((row) => !SUPPORTING_LABELS.has(row.label));
    const computed = computedWith(thin, { depreciation: 750_000_000 });
    const typed = ratioInputsTable(computed.ratios, "id").rows.filter((row) => row[2] === "depreciation");
    expect(typed.map((row) => [row[1], row[3]])).toEqual([
      ["2023", 750_000_000],
      ["2024", 750_000_000],
    ]);
    expect(String(typed[0]?.[0])).toMatch(/Penyusutan/);
  });
});

/** A section path is how the fixture says which statement a row came from. */
const BALANCE_SHEET_SECTION = /^(ASET|LIABILITAS)/;

type Rows = ReturnType<typeof manufakturRows>;

/**
 * Statements that leave piles out, each for a different reason. Between them every metric the
 * workbook writes a formula for is null in at least one of them.
 */
const THIN_STATEMENTS: ReadonlyArray<readonly [string, () => Rows, Record<string, unknown>]> = [
  [
    "no depreciation row and nothing typed",
    () => manufakturRows().filter((row) => !/Penyusutan dan/.test(row.label)),
    {},
  ],
  [
    "a repayment typed for 2024 only",
    () => manufakturRows().filter((row) => !SUPPORTING_LABELS.has(row.label)),
    { principalRepayment2024: 1_050_000_000 },
  ],
  [
    "a balance sheet with no P&L",
    () => manufakturRows().filter((row) => BALANCE_SHEET_SECTION.test(row.section ?? "")),
    {},
  ],
  [
    "a P&L with no balance sheet",
    () => manufakturRows().filter((row) => !BALANCE_SHEET_SECTION.test(row.section ?? "")),
    {},
  ],
  ["a single cash row", () => [{ label: "Kas", period: "2024", amount: 100, currency: "IDR" }], {}],
];

describe("a pile the statement does not carry", () => {
  // The report states nothing where a pile has no row, and no typed figure stands in. The workbook
  // has to show nothing too: a 0 there is a figure a reader will read, and one the report never said.
  it.each(THIN_STATEMENTS)("leaves the formula blank wherever the report states nothing: %s", (_name, rows, params) => {
    const { inputs, calc } = tablesFor(rows(), params);
    const checks = calcFormulaChecks(inputs, calc);
    expect(checks.some((check) => check.reported === null)).toBe(true);
    expect(calcDrift(checks)).toEqual([]);
  });

  it("covers every metric the workbook writes a formula for", () => {
    const blankSomewhere = new Set(
      THIN_STATEMENTS.flatMap(([, rows, params]) => {
        const { inputs, calc } = tablesFor(rows(), params);
        return calcFormulaChecks(inputs, calc)
          .filter((check) => check.reported === null)
          .map((check) => check.label);
      }),
    );
    const { inputs, calc } = tablesFor(manufakturRows());
    const withFormula = new Set(calcFormulaChecks(inputs, calc).map((check) => check.label));
    expect([...withFormula].filter((label) => !blankSomewhere.has(label))).toEqual([]);
  });

  // The promise of a live sheet: take a pile's rows off Inputs and the Calc cells move the way the
  // report's own arithmetic would have, blank and all.
  it("goes blank when a reader deletes a pile's last row on Inputs", () => {
    const full = tablesFor(manufakturRows());
    const withoutCash = manufakturRows().filter(
      (row) => !(row.label === "Kas dan Setara Kas" && row.period === "2024"),
    );
    const reference = tablesFor(withoutCash);
    const edited = {
      ...full.inputs,
      rows: full.inputs.rows.filter((row) => !(row[0] === "Kas dan Setara Kas" && row[1] === "2024")),
    };
    const afterEdit = calcFormulaChecks(edited, full.calc);
    const expected = calcFormulaChecks(reference.inputs, reference.calc);
    expect(afterEdit.map((check) => [check.label, check.period, check.computed])).toEqual(
      expected.map((check) => [check.label, check.period, check.reported]),
    );
    expect(afterEdit.find((check) => check.label === "Cash ratio" && check.period === "2024")?.computed).toBeNull();
  });

  it("writes the blank in the builder's own idiom: IF over a COUNTIFS of the pile's buckets", () => {
    const { calc } = tablesFor(manufakturRows().filter((row) => !/Penyusutan dan/.test(row.label)));
    const at = calc.rows.findIndex((row) => row[0] === "Depreciation and amortisation" && row[3] === "2024");
    const period = `$D${REPORT_TABLE_FIRST_DATA_ROW + at}`;
    // The formula inside is the one the builder always wrote; only the blank around it is new.
    expect(calc.formulas?.[at]?.[1]).toBe(
      `IF(COUNTIFS(Inputs!$C:$C,"depreciation",Inputs!$B:$B,${period})=0,"",` +
        `(ABS(SUMIFS(Inputs!$D:$D,Inputs!$C:$C,"depreciation",Inputs!$B:$B,${period}))))`,
    );
  });
});

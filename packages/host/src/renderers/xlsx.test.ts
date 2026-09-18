import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { FinanceBrief } from "@agentforge/core/artifacts";
import { CALC_TABLE_ID, REPORT_TABLE_FIRST_DATA_ROW, financeReportFromBrief } from "@agentforge/core/finance";
import { CALC_SHEET, INPUTS_SHEET, SUMMARY_SHEET, planCell, renderXlsx } from "./xlsx";
import { FORMULA_ESCAPE } from "./cells";
import { INJECTION_LABEL, INJECTION_PERIOD, bareReport, sampleReport } from "./__fixtures__/report";

async function reopen(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer as ArrayBuffer);
  return workbook;
}

const PERCENT_LABELS = /margin/i;

/** One period of the engine's profit ladder, in the order the engine itself emits it. */
function ladder(period: string, figures: readonly (readonly [string, string, number])[]) {
  return figures.map(([base, label, value]) => ({
    key: `${base} ${period}`,
    label: `${label} ${period}`,
    value,
    unit: PERCENT_LABELS.test(label) ? "%" : "IDR",
    period,
    formula: "engine",
  }));
}

/**
 * A brief whose Calc sheet exercises the whole ladder: the operating line on SUMIFS over Inputs,
 * and everything below it - where interest, other income and tax are roles no category can address -
 * on references to the Calc rows beside it. 2025 states tax, 2026 does not.
 */
function ladderBrief(): FinanceBrief {
  return {
    title: "Ladder",
    sections: [{ heading: "Margins", body: "Operating margin held.", tables: [], metrics: [] }],
    assumptions: [],
    computed: {
      metrics: [
        ...ladder("2025", [
          ["revenue", "Revenue", 1000],
          ["cogs", "Cost of revenue", 600],
          ["gross_profit", "Gross profit", 400],
          ["gross_margin", "Gross margin", 40],
          ["opex", "Operating expenses", 250],
          ["operating_profit", "Operating profit", 150],
          ["operating_margin", "Operating margin", 15],
          ["interest_expense", "Interest expense", 20],
          ["other_income", "Other income", 10],
          ["pretax_profit", "Profit before tax", 140],
          ["tax_expense", "Tax expense", 30],
          ["net_profit_after_tax", "Net profit after tax", 110],
          ["net_margin", "Net margin", 11],
        ]),
        ...ladder("2026", [
          ["revenue", "Revenue", 1200],
          ["cogs", "Cost of revenue", 780],
          ["gross_profit", "Gross profit", 420],
          ["gross_margin", "Gross margin", 35],
          ["opex", "Operating expenses", 400],
          ["operating_profit", "Operating profit", 20],
          ["operating_margin", "Operating margin", 1.6666666666666667],
          ["pretax_profit", "Profit before tax", 20],
          ["net_profit", "Net profit", 20],
          ["net_margin", "Net margin", 1.6666666666666667],
        ]),
      ],
      tables: [
        {
          name: "Line items",
          columns: ["Label", "Period", "Category", "Amount", "Currency"],
          rows: [
            ["Sales", "2025", "revenue", 1000, "IDR"],
            ["Hosting", "2025", "cogs", 600, "IDR"],
            ["Salaries", "2025", "opex", 250, "IDR"],
            ["Interest expense", "2025", "other", 20, "IDR"],
            ["Other income", "2025", "other", 10, "IDR"],
            ["Tax expense", "2025", "other", 30, "IDR"],
            ["Sales", "2026", "revenue", 1200, "IDR"],
            ["Hosting", "2026", "cogs", 780, "IDR"],
            ["Salaries", "2026", "opex", 400, "IDR"],
          ],
        },
      ],
    },
  };
}

type FormulaCell = {
  readonly address: string;
  readonly row: number;
  readonly column: number;
  readonly formula: string;
  readonly result: number;
};

/** Every live formula on a sheet with the result cached beside it, the way the eval harness reads one. */
function formulaCells(sheet: ExcelJS.Worksheet): FormulaCell[] {
  const cells: FormulaCell[] = [];
  sheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const formula = (cell.value as unknown as { formula?: string } | null)?.formula;
      if (typeof formula !== "string") {
        return;
      }
      // `cell.value.result` drops a falsy cache; the cell model keeps it.
      const cached = (cell as unknown as { result?: unknown }).result;
      cells.push({
        address: cell.address,
        row: rowNumber,
        column: columnNumber,
        formula,
        result: typeof cached === "number" ? cached : Number.NaN,
      });
    });
  });
  return cells;
}

/**
 * A calc table with the three cases a formula cell can be in: the figure is there, the report says
 * the quantity is undefined (variance % of a line with no budget), and the report never listed the
 * cell at all. Only the first may ship as a live formula.
 */
function gapReport(locale: "id" | "en") {
  return {
    ...bareReport(),
    locale,
    tables: [
      {
        id: "calc",
        title: "Calc",
        columns: ["Metric", "Value"],
        rows: [["Variance", 250], ["Variance %", null], ["Coverage"]],
        formulas: [
          [null, "Inputs!B2-Inputs!B3"],
          [null, 'IF(Inputs!B3=0,"",Inputs!B2/Inputs!B3)'],
          [null, "Inputs!B4"],
        ],
      },
    ],
  } as unknown as Parameters<typeof renderXlsx>[0];
}

/** Every formula cell in the whole workbook, not just the Calc sheet. */
function allFormulaCells(workbook: ExcelJS.Workbook): FormulaCell[] {
  return workbook.worksheets.flatMap((sheet) => formulaCells(sheet));
}

describe("planCell", () => {
  it("caches the report's own figure beside the formula, including a zero", () => {
    expect(planCell(0, true, "A1-A2", "n/a")).toEqual({ kind: "formula", formula: "A1-A2", result: 0 });
    expect(planCell("1.0x", true, "A1/A2", "n/a")).toEqual({ kind: "formula", formula: "A1/A2", result: "1.0x" });
  });

  it("writes the report's own words where the quantity is undefined, and no formula", () => {
    expect(planCell(null, true, "A1/A2", "not available")).toEqual({ kind: "value", value: "not available" });
    expect(planCell("", true, "A1/A2", "tidak tersedia")).toEqual({ kind: "value", value: "tidak tersedia" });
  });

  it("leaves a cell the report never listed blank rather than guessing at it", () => {
    expect(planCell(null, false, "A1/A2", "not available")).toEqual({ kind: "value", value: null });
  });

  it("passes a plain cell straight through", () => {
    expect(planCell("Revenue", true, null, "n/a")).toEqual({ kind: "value", value: "Revenue" });
  });
});

describe("renderXlsx", () => {
  it("returns a non-empty zip with the workbook mime and a safe filename", async () => {
    const file = await renderXlsx(sampleReport());
    expect(file.bytes.length).toBeGreaterThan(0);
    expect(file.bytes[0]).toBe(0x50);
    expect(file.bytes[1]).toBe(0x4b);
    expect(file.mime).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(file.filename).toBe("Margins-held-while-cash-thinned.xlsx");
  });

  it("writes Summary, Inputs, Calc and a sheet for every other table", async () => {
    const workbook = await reopen((await renderXlsx(sampleReport())).bytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      SUMMARY_SHEET,
      INPUTS_SHEET,
      CALC_SHEET,
      "Totals by period",
    ]);
  });

  it("styles the header row, freezes it and sizes the columns", async () => {
    const workbook = await reopen((await renderXlsx(sampleReport())).bytes);
    const inputs = workbook.getWorksheet(INPUTS_SHEET);
    const header = inputs?.getRow(1);
    expect(header?.getCell(1).value).toBe("Label");
    expect(header?.getCell(1).font?.bold).toBe(true);
    expect(header?.getCell(1).fill?.type).toBe("pattern");
    expect(inputs?.views?.[0]?.state).toBe("frozen");
    expect(inputs?.getColumn(1).width).toBeGreaterThan(0);
  });

  it("keeps the calc sheet's live formulas and the engine's value beside them", async () => {
    const workbook = await reopen((await renderXlsx(sampleReport())).bytes);
    const calc = workbook.getWorksheet(CALC_SHEET);
    const cell = calc?.getCell("B2");
    expect((cell?.value as { formula?: string })?.formula).toContain("SUMIFS(Inputs!");
    expect((cell?.value as { result?: number })?.result).toBe(1000);
    // A metric the builder could not derive stays a plain value.
    expect(calc?.getCell("B4").value).toBeNull();
  });

  it("carries the whole profit ladder, every cached result agreeing with the engine's own number", async () => {
    // The eval harness runs this check over a real export (`calcFormulaCheck`): a formula whose cache
    // disagrees with the number on screen is a file that changes its mind on the first recalculation.
    const report = financeReportFromBrief(ladderBrief());
    const table = report.tables.find((one) => one.id === CALC_TABLE_ID);
    const sheet = (await reopen((await renderXlsx(report)).bytes)).getWorksheet(CALC_SHEET);
    const cells = formulaCells(sheet as ExcelJS.Worksheet);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const stated = table?.rows[cell.row - REPORT_TABLE_FIRST_DATA_ROW]?.[cell.column - 1];
      expect(typeof stated).toBe("number");
      expect(Number.isFinite(cell.result)).toBe(true);
      expect(cell.result).toBeCloseTo(stated as number, 9);
    }

    const rowOf = (label: string) => (table?.rows.findIndex((row) => row[0] === label) ?? -1);
    const cellAt = (label: string) =>
      cells.find((cell) => cell.row === REPORT_TABLE_FIRST_DATA_ROW + rowOf(label) && cell.column === 2);
    expect(cellAt("Operating margin 2025")?.formula).toContain('Inputs!$C:$C,"opex"');
    // The net margin divides the ladder's own net profit cell, not (revenue - cogs - opex).
    expect(cellAt("Net margin 2025")?.formula).toBe(
      `IFERROR($B${REPORT_TABLE_FIRST_DATA_ROW + rowOf("Net profit after tax 2025")}/$B${REPORT_TABLE_FIRST_DATA_ROW + rowOf("Revenue 2025")}*100,"")`,
    );
    expect(cellAt("Net margin 2025")?.formula).not.toContain("SUMIFS");
    // Interest, other income and tax are role-based leaves: no formula, just the engine's value.
    expect(cellAt("Interest expense 2025")).toBeUndefined();
    expect(cellAt("Tax expense 2025")).toBeUndefined();
  });

  it("caches a formula result of exactly zero, so the cell is not blank before a recalculation", async () => {
    // A zero is a real answer — variance 0, net 0 — and it is the one number a truthiness test eats.
    const report = {
      ...bareReport(),
      tables: [
        {
          id: "calc",
          title: "Calc",
          columns: ["Metric", "Value"],
          rows: [
            ["Variance", 0],
            ["Other", 5],
          ],
          formulas: [
            [null, "Inputs!B2-Inputs!B3"],
            [null, "Inputs!B4"],
          ],
        },
      ],
    } as unknown as Parameters<typeof renderXlsx>[0];
    const workbook = await reopen((await renderXlsx(report)).bytes);
    const calc = workbook.getWorksheet(CALC_SHEET);
    // `cell.value` cannot answer this: exceljs copies a formula field only when it is truthy, so the
    // zero it read back out of the file is missing from that object. The cell model still has it.
    expect(calc?.getCell("B2").result).toBe(0);
    expect(calc?.getCell("B3").result).toBe(5);
    expect((calc?.getCell("B2").value as { formula?: string })?.formula).toBe("Inputs!B2-Inputs!B3");
  });

  it("neutralises every cell a spreadsheet would otherwise execute", async () => {
    const workbook = await reopen((await renderXlsx(sampleReport())).bytes);
    const inputs = workbook.getWorksheet(INPUTS_SHEET);
    expect(inputs?.getCell("A4").value).toBe(`${FORMULA_ESCAPE}${INJECTION_LABEL}`);
    expect(inputs?.getCell("B4").value).toBe(`${FORMULA_ESCAPE}${INJECTION_PERIOD}`);
  });

  it("puts the KPIs and the flags on the summary sheet with a conditional format for the levels", async () => {
    const workbook = await reopen((await renderXlsx(sampleReport())).bytes);
    const summary = workbook.getWorksheet(SUMMARY_SHEET);
    const text = JSON.stringify(summary?.getSheetValues());
    expect(text).toContain("Gross margin 2026");
    expect(text).toContain("Net margin 2026: -4%");
    const formats = (summary as unknown as { conditionalFormattings?: unknown[] })?.conditionalFormattings ?? [];
    expect(formats.length).toBeGreaterThan(0);
  });

  it("leaves no formula cell without a cached result, on any sheet", async () => {
    // What the eval harness counts as "uncached": a formula whose value only appears after Excel
    // recalculates. Protected View, Quick Look and every preview pane show the cache instead.
    for (const report of [sampleReport(), gapReport("en"), gapReport("id")]) {
      const workbook = await reopen((await renderXlsx(report)).bytes);
      const uncached = allFormulaCells(workbook).filter((cell) => !Number.isFinite(cell.result));
      expect(uncached.map((cell) => `${cell.address} ${cell.formula}`)).toEqual([]);
    }
  });

  it("says 'not available' in the reader's language where the report states no figure", async () => {
    const english = (await reopen((await renderXlsx(gapReport("en"))).bytes)).getWorksheet(CALC_SHEET);
    expect(english?.getCell("B3").value).toBe("not available");
    expect(english?.getCell("B2").result).toBe(250);
    const indonesian = (await reopen((await renderXlsx(gapReport("id"))).bytes)).getWorksheet(CALC_SHEET);
    expect(indonesian?.getCell("B3").value).toBe("tidak tersedia");
  });

  it("warns about the cells the report never gave a value for, naming each one", async () => {
    const file = await renderXlsx(gapReport("en"));
    expect(file.warnings).toEqual(["Calc!B4: Inputs!B4"]);
    expect((await renderXlsx(sampleReport())).warnings).toBeUndefined();
  });

  it("asks Excel to recalculate the whole book when it is opened", async () => {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(Buffer.from((await renderXlsx(sampleReport())).bytes));
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    expect(workbookXml).toContain('fullCalcOnLoad="1"');
  });

  it("still writes a workbook when the report has no tables at all", async () => {
    const file = await renderXlsx(bareReport());
    const workbook = await reopen(file.bytes);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([SUMMARY_SHEET]);
    expect(file.filename).toBe("Barereport-no-tables.xlsx");
  });
});

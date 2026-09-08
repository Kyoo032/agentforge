import { describe, expect, it } from "vitest";
import { isWorkbookBytes, listXlsxSheets, parseXlsx } from "./xlsx";
import { MAX_SHEET_NAME_CHARS, sanitizeSheetName, writeWorkbook } from "./xlsx-write";

describe("writeWorkbook", () => {
  it("round-trips rows through parseXlsx with headers, cells and null as empty", () => {
    const bytes = writeWorkbook([
      {
        name: "Deviations",
        rows: [
          ["Clause", "Severity", "Count"],
          ["§7.2(b)", "high", 3],
          ["§9.1", null, 0],
        ],
        widths: [14, 10, 8],
      },
      {
        name: "Summary",
        rows: [
          ["Severity", "Count"],
          ["high", 1],
        ],
      },
    ]);
    expect(isWorkbookBytes(bytes)).toBe(true);
    expect(listXlsxSheets(bytes)).toEqual(["Deviations", "Summary"]);
    const table = parseXlsx(bytes, { sheet: "Deviations" });
    expect(table?.headers).toEqual(["Clause", "Severity", "Count"]);
    expect(table?.rows).toEqual([
      ["§7.2(b)", "high", "3"],
      ["§9.1", "", "0"],
    ]);
    expect(parseXlsx(bytes, { sheet: "Summary" })?.rows).toEqual([["high", "1"]]);
  });

  it("does not mutate the input rows", () => {
    const rows = [
      ["a", "b"],
      ["1", null],
    ];
    const snapshot = JSON.stringify(rows);
    writeWorkbook([{ name: "S", rows }]);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("writes an empty sheet without throwing and rejects an empty workbook", () => {
    expect(listXlsxSheets(writeWorkbook([{ name: "Empty", rows: [] }]))).toEqual(["Empty"]);
    expect(() => writeWorkbook([])).toThrow(RangeError);
  });

  it("sanitises and de-duplicates sheet names", () => {
    const bytes = writeWorkbook([
      { name: "Bad/Name:Here?", rows: [["x"]] },
      { name: "Bad Name Here", rows: [["y"]] },
      { name: "", rows: [["z"]] },
    ]);
    expect(listXlsxSheets(bytes)).toEqual(["Bad Name Here", "Bad Name Here 1", "Sheet"]);
    expect(sanitizeSheetName("x".repeat(60))).toHaveLength(MAX_SHEET_NAME_CHARS);
    expect(sanitizeSheetName("[a]*b")).toBe("a  b");
  });
});

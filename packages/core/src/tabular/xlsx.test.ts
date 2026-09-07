import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTabular } from "./index";
import { listXlsxSheets, parseXlsx } from "./xlsx";

function workbookBytes(sheets: Record<string, (string | number)[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

const bytes = workbookBytes({
  Sales: [
    ["vendor", "spend"],
    ["Acme", 100],
    ["Beta", 40.5],
  ],
  Notes: [["note"], ["hello"]],
});

describe("parseXlsx", () => {
  it("returns headers and rows from the first sheet as strings", () => {
    const table = parseXlsx(bytes);
    expect(table?.headers).toEqual(["vendor", "spend"]);
    expect(table?.rows).toEqual([
      ["Acme", "100"],
      ["Beta", "40.5"],
    ]);
    expect(table?.delimiter).toBe("\t");
    expect(table?.ragged).toBe(false);
  });

  it("selects a sheet by name or index and caps rows", () => {
    expect(parseXlsx(bytes, { sheet: "Notes" })?.rows).toEqual([["hello"]]);
    expect(parseXlsx(bytes, { sheet: 1 })?.headers).toEqual(["note"]);
    expect(parseXlsx(bytes, { maxRows: 1 })?.rows).toEqual([["Acme", "100"]]);
  });

  it("returns null for an unknown sheet, a header-only sheet, or garbage bytes", () => {
    expect(parseXlsx(bytes, { sheet: "Missing" })).toBeNull();
    expect(parseXlsx(workbookBytes({ Only: [["a", "b"]] }))).toBeNull();
    expect(parseXlsx(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("listXlsxSheets", () => {
  it("lists sheet names in order", () => {
    expect(listXlsxSheets(bytes)).toEqual(["Sales", "Notes"]);
    expect(listXlsxSheets(new Uint8Array([1, 2, 3]))).toEqual([]);
  });
});

describe("parseTabular", () => {
  it("picks XLSX from the ZIP magic bytes without a filename", () => {
    expect(parseTabular({ bytes })?.headers).toEqual(["vendor", "spend"]);
  });

  it("picks XLSX from the filename", () => {
    expect(parseTabular({ bytes, filename: "Book.XLSX" })?.rows).toHaveLength(2);
  });

  it("decodes other bytes as UTF-8 delimited text", () => {
    const csv = new TextEncoder().encode("a;b\n1;2\n");
    expect(parseTabular({ bytes: csv, filename: "x.csv" })).toEqual({
      headers: ["a", "b"],
      rows: [["1", "2"]],
      delimiter: ";",
      ragged: false,
    });
  });

  it("uses text directly and returns null with no input", () => {
    expect(parseTabular({ text: "a\n1\n2", maxRows: 1 })?.rows).toEqual([["1"]]);
    expect(parseTabular({})).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { classifyCell, coerceCell, inferColumnType, parseDate, parseNumber, toTypedTable } from "./infer-types";

describe("classifyCell", () => {
  it.each(["", "   ", "NA", "n/a", "null", "NULL", "-"])("treats %j as empty", (raw) => {
    expect(classifyCell(raw)).toBe("empty");
  });

  it.each(["true", "False", "yes", "NO", "y", "N"])("treats %j as boolean", (raw) => {
    expect(classifyCell(raw)).toBe("boolean");
  });

  it.each([
    "1",
    "-3",
    "+7",
    "3.14",
    "1,234.56",
    "1.234,56",
    "1 234,56",
    "Rp 12.000",
    "$1,000",
    "€9",
    "£2.50",
    "12%",
    "-3%",
  ])("treats %j as number", (raw) => {
    expect(classifyCell(raw)).toBe("number");
  });

  it.each([
    "2024-01-31",
    "2024-01-31T10:20:30Z",
    "2024-01-31 10:20",
    "31/01/2024",
    "01/31/2024",
    "2024/01/31",
    "31 Jan 2024",
    "Jan 31, 2024",
    "31 January 2024",
  ])("treats %j as date", (raw) => {
    expect(classifyCell(raw)).toBe("date");
  });

  it.each(["hello", "1e5", "2024-13-01", "32/01/2024", "abc123", "1,2,3"])("treats %j as string", (raw) => {
    expect(classifyCell(raw)).toBe("string");
  });
});

describe("parseNumber", () => {
  it.each([
    ["1,234.56", 1234.56],
    ["1.234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["Rp 12.000", 12000],
    ["Rp12.000.000", 12000000],
    ["$1,000", 1000],
    ["-3%", -3],
    ["12%", 12],
    ["1.234", 1.234],
    ["1.234.567", 1234567],
    ["12,5", 12.5],
    [".5", 0.5],
    ["+42", 42],
    ["$-5", -5],
    ["-0", 0],
  ])("parses %j", (raw, expected) => {
    expect(parseNumber(raw)).toBe(expected);
  });

  it.each(["", "abc", "1,23,4", "--1", "1.2.3,4", "NA"])("rejects %j", (raw) => {
    expect(parseNumber(raw)).toBeNull();
  });
});

describe("parseDate", () => {
  it.each([
    ["2024-01-31", "2024-01-31"],
    ["2024-01-31T10:20:30Z", "2024-01-31"],
    ["31/01/2024", "2024-01-31"],
    ["01/31/2024", "2024-01-31"],
    ["05/06/2024", "2024-06-05"],
    ["2024/01/31", "2024-01-31"],
    ["31 Jan 2024", "2024-01-31"],
    ["Jan 31, 2024", "2024-01-31"],
    ["3 March 2024", "2024-03-03"],
  ])("normalises %j", (raw, iso) => {
    expect(parseDate(raw)).toBe(iso);
  });

  it.each(["2024-02-30", "31/04/2024", "Foo 1, 2024", "hello"])("rejects %j", (raw) => {
    expect(parseDate(raw)).toBeNull();
  });
});

describe("inferColumnType", () => {
  it("returns number at or above the 90% threshold", () => {
    const nine = Array.from({ length: 9 }, (_, i) => String(i));
    expect(inferColumnType([...nine, "x"])).toBe("number");
    expect(inferColumnType([...nine.slice(0, 8), "x", "y"])).toBe("string");
  });

  it("ignores empties when computing the ratio", () => {
    expect(inferColumnType(["1", "", "NA", "2", "-"])).toBe("number");
  });

  it("detects date and boolean columns", () => {
    expect(inferColumnType(["2024-01-01", "02/03/2024", ""])).toBe("date");
    expect(inferColumnType(["yes", "no", "TRUE"])).toBe("boolean");
  });

  it("falls back to string for all-empty or mixed columns", () => {
    expect(inferColumnType([])).toBe("string");
    expect(inferColumnType(["", "NA"])).toBe("string");
    expect(inferColumnType(["1", "2024-01-01", "yes", "x"])).toBe("string");
  });
});

describe("coerceCell", () => {
  it("coerces by column type", () => {
    expect(coerceCell("", "number")).toBeNull();
    expect(coerceCell("NA", "string")).toBeNull();
    expect(coerceCell("$1,000", "number")).toBe(1000);
    expect(coerceCell("abc", "number")).toBeNull();
    expect(coerceCell("yes", "boolean")).toBe(true);
    expect(coerceCell("N", "boolean")).toBe(false);
    expect(coerceCell("maybe", "boolean")).toBeNull();
    expect(coerceCell("31/01/2024", "date")).toBe("2024-01-31");
    expect(coerceCell("someday", "date")).toBe("someday");
    expect(coerceCell("12%", "string")).toBe("12%");
  });
});

describe("toTypedTable", () => {
  it("infers a type per column and coerces every row", () => {
    const typed = toTypedTable({
      headers: ["n", "d", "b", "s"],
      rows: [
        ["1,000", "2024-01-01", "yes", "a"],
        ["", "31/01/2024", "no", "NA"],
      ],
      delimiter: ",",
      ragged: false,
    });
    expect(typed.headers).toEqual(["n", "d", "b", "s"]);
    expect(typed.types).toEqual(["number", "date", "boolean", "string"]);
    expect(typed.rows).toEqual([
      [1000, "2024-01-01", true, "a"],
      [null, "2024-01-31", false, null],
    ]);
  });
});

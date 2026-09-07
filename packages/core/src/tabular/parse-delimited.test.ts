import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tableToCsv } from "./index";
import { DELIMITERS, parseDelimited, sniffDelimiter, tableFromRows, tokenize } from "./parse-delimited";

describe("sniffDelimiter", () => {
  it.each([
    [",", "a,b,c\n1,2,3\n4,5,6"],
    [";", "a;b;c\n1;2;3\n4;5;6"],
    ["\t", "a\tb\tc\n1\t2\t3"],
    ["|", "a|b|c\n1|2|3"],
  ])("detects %j", (delimiter, text) => {
    expect(sniffDelimiter(text)).toBe(delimiter);
  });

  it("defaults to comma for a single column or empty text", () => {
    expect(sniffDelimiter("a\n1\n2")).toBe(",");
    expect(sniffDelimiter("")).toBe(",");
  });

  it("ignores delimiters inside quoted fields", () => {
    expect(sniffDelimiter('a;b\n"1,2,3";4\n"5,6";7')).toBe(";");
  });

  it("prefers the consistent delimiter over a frequent but ragged one", () => {
    expect(sniffDelimiter("a;b\n1,2,3;4\n5;6,7")).toBe(";");
  });

  it("breaks ties in DELIMITERS order", () => {
    expect(DELIMITERS[0]).toBe(",");
    expect(sniffDelimiter("a,b;c\n1,2;3")).toBe(",");
  });
});

describe("parseDelimited", () => {
  it("parses a header plus rows and reports the delimiter", () => {
    expect(parseDelimited("vendor,spend\nAcme,100\nBeta,40\n")).toEqual({
      headers: ["vendor", "spend"],
      rows: [
        ["Acme", "100"],
        ["Beta", "40"],
      ],
      delimiter: ",",
      ragged: false,
    });
  });

  it("strips a UTF-8 BOM", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseDelimited(`${bom}a,b\n1,2`)?.headers).toEqual(["a", "b"]);
  });

  it("handles CRLF and lone CR line endings", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n3,4\r\n")?.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseDelimited("a,b\r1,2\r")?.rows).toEqual([["1", "2"]]);
  });

  it("keeps quoted delimiters, quoted newlines, and doubled quotes", () => {
    const table = parseDelimited('name,note\n"Acme, Inc","line1\nline2"\n"say ""hi""",x\n');
    expect(table?.rows).toEqual([
      ["Acme, Inc", "line1\nline2"],
      ['say "hi"', "x"],
    ]);
  });

  it("trims headers and cells", () => {
    const table = parseDelimited("a , b \n 1 , 2 ");
    expect(table?.headers).toEqual(["a", "b"]);
    expect(table?.rows).toEqual([["1", "2"]]);
  });

  it("pads and truncates ragged rows and flags them", () => {
    const table = parseDelimited("a,b,c\n1,2\n1,2,3,4\n");
    expect(table?.rows).toEqual([
      ["1", "2", ""],
      ["1", "2", "3"],
    ]);
    expect(table?.ragged).toBe(true);
  });

  it("names empty headers and de-duplicates repeated ones", () => {
    expect(parseDelimited("a,,a,a\n1,2,3,4")?.headers).toEqual(["a", "column_2", "a_2", "a_3"]);
  });

  it("skips fully empty rows", () => {
    expect(parseDelimited("a,b\n\n1,2\n,\n   \n")?.rows).toEqual([["1", "2"]]);
  });

  it("stops tokenizing once maxRows non-empty records are read", () => {
    expect(tokenize("h\n1\n\n2\n3\n", ",", 3)).toEqual([["h"], ["1"], [""], ["2"]]);
    const table = parseDelimited("a\n1\n\n2\n3\n", { maxRows: 2 });
    expect(table?.rows).toEqual([["1"], ["2"]]);
  });

  it("refuses text over the char cap", () => {
    expect(() => parseDelimited("a\n1\n", { maxChars: 3 })).toThrow(RangeError);
    expect(parseDelimited("a\n1\n", { maxChars: 4 })?.rows).toEqual([["1"]]);
  });

  it("caps data rows with maxRows", () => {
    const table = parseDelimited("a\n1\n2\n3\n", { maxRows: 2 });
    expect(table?.rows).toEqual([["1"], ["2"]]);
  });

  it("honours an explicit delimiter", () => {
    const table = parseDelimited("a;b\n1;2", { delimiter: "," });
    expect(table?.headers).toEqual(["a;b"]);
    expect(table?.rows).toEqual([["1;2"]]);
  });

  it("returns null without a header or data row", () => {
    expect(parseDelimited("")).toBeNull();
    expect(parseDelimited("a,b\n")).toBeNull();
    expect(parseDelimited("a,b\n\n,\n")).toBeNull();
  });

  it("does not mutate the rows given to tableFromRows", () => {
    const rows = [
      ["a", "b"],
      ["1", "2", "3"],
    ];
    const snapshot = rows.map((row) => [...row]);
    tableFromRows(rows, ",");
    expect(rows).toEqual(snapshot);
  });
});

const CELL_UNITS = ["a", "b", "1", "0", " ", ",", ";", "|", "\t", '"', "\n", "\r", "-"];
const cellArb = fc
  .string({ unit: fc.constantFrom(...CELL_UNITS), maxLength: 10 })
  .filter((value) => value === value.trim());
const headerArb = cellArb.filter((value) => value !== "");
const rowArb = (width: number) =>
  fc.array(cellArb, { minLength: width, maxLength: width }).filter((row) => row.some((cell) => cell !== ""));
const tableArb = (minWidth: number) =>
  fc.integer({ min: minWidth, max: 5 }).chain((width) =>
    fc.record({
      headers: fc.uniqueArray(headerArb, { minLength: width, maxLength: width }),
      rows: fc.array(rowArb(width), { minLength: 1, maxLength: 8 }),
    }),
  );

describe("parseDelimited round-trips tableToCsv", () => {
  it("with a sniffed delimiter for two or more columns", () => {
    fc.assert(
      fc.property(tableArb(2), ({ headers, rows }) => {
        const parsed = parseDelimited(tableToCsv({ headers, rows, delimiter: ",", ragged: false }));
        expect(parsed).toEqual({ headers, rows, delimiter: ",", ragged: false });
      }),
      { numRuns: 300 },
    );
  });

  it("with an explicit delimiter for any width", () => {
    fc.assert(
      fc.property(tableArb(1), ({ headers, rows }) => {
        const csv = tableToCsv({ headers, rows, delimiter: ",", ragged: false });
        expect(parseDelimited(csv, { delimiter: "," })).toEqual({ headers, rows, delimiter: ",", ragged: false });
      }),
      { numRuns: 300 },
    );
  });
});

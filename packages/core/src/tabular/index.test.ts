import { describe, expect, it } from "vitest";
import { tableSample, tableToCsv } from "./index";
import type { TabularTable } from "./types";

const table: TabularTable = {
  headers: ["name", "note"],
  rows: [
    ["Acme, Inc", 'say "hi"'],
    ["Beta", "line1\nline2"],
    ["Gamma", "a|b"],
  ],
  delimiter: ";",
  ragged: false,
};

describe("tableToCsv", () => {
  it("writes RFC-4180 comma separated text regardless of the source delimiter", () => {
    expect(tableToCsv(table)).toBe('name,note\n"Acme, Inc","say ""hi"""\nBeta,"line1\nline2"\nGamma,a|b');
  });
});

describe("tableSample", () => {
  it("renders a markdown table of the first rows with escaped pipes", () => {
    expect(tableSample(table, 2)).toBe(
      ["| name | note |", "| --- | --- |", '| Acme, Inc | say "hi" |', "| Beta | line1 line2 |"].join("\n"),
    );
    expect(tableSample(table)).toContain("| Gamma | a\\|b |");
  });
});

import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse-csv";

describe("parseCsv", () => {
  it("parses a header plus rows", () => {
    const table = parseCsv("vendor,spend\nAcme,100\nBeta,40\n");
    expect(table).toEqual({
      headers: ["vendor", "spend"],
      rows: [
        ["Acme", "100"],
        ["Beta", "40"],
      ],
    });
  });

  it("returns null without a data row", () => {
    expect(parseCsv("vendor,spend\n")).toBeNull();
  });

  it("handles quoted commas", () => {
    const table = parseCsv('name,note\n"Acme, Inc",ok\n');
    expect(table?.rows[0]).toEqual(["Acme, Inc", "ok"]);
  });
});

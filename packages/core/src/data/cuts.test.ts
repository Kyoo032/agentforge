import { describe, expect, it } from "vitest";
import type { TableProfile } from "../tabular/types";
import { planDataCuts, sheetLimit } from "./cuts";

function profile(columns: TableProfile["columns"], rowCount = 4): TableProfile {
  return { rowCount, columnCount: columns.length, columns };
}

const vendor = { name: "vendor", type: "string" as const, nulls: 0, distinct: 2, topK: [] };
const spend = { name: "spend", type: "number" as const, nulls: 0, distinct: 4, topK: [] };
const month = { name: "month", type: "date" as const, nulls: 0, distinct: 2, topK: [] };
const note = { name: "note", type: "string" as const, nulls: 2, distinct: 2, topK: [] };

describe("planDataCuts", () => {
  it("picks comparison, time, and blanks when the question names no method", () => {
    const cuts = planDataCuts(profile([vendor, spend, month, note]), "What is going on here?");
    expect(cuts.map((cut) => cut.kind)).toEqual(["compare", "over_time", "blanks"]);
    expect(cuts[0]).toMatchObject({ columns: ["vendor", "spend"], aggregate: "sum" });
  });

  it("follows a named date and switches the total to an average when asked", () => {
    const cuts = planDataCuts(profile([vendor, spend, month]), "What is the average spend over month?");
    expect(cuts[0]).toMatchObject({ kind: "over_time", columns: ["month", "spend"], aggregate: "avg" });
  });

  it("counts a category when the sheet has no number", () => {
    const cuts = planDataCuts(profile([vendor]), "How does this split?");
    expect(cuts).toEqual([{ kind: "split", columns: ["vendor"], aggregate: "count" }]);
  });

  it("counts rows when every column is an identifier", () => {
    const id = { name: "ref", type: "string" as const, nulls: 0, distinct: 80, topK: [] };
    expect(planDataCuts(profile([id], 80), "hello")).toEqual([{ kind: "rows", columns: [], aggregate: "count" }]);
  });
});

describe("sheetLimit", () => {
  it("names a forecast and a second table, and ignores an ordinary question", () => {
    expect(sheetLimit("Forecast next month")).toBe("forecast");
    expect(sheetLimit("Gabungkan dengan tabel lain")).toBe("other_table");
    expect(sheetLimit("Who spends most?")).toBeNull();
  });
});

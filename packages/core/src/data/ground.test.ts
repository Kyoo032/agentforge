import { describe, expect, it } from "vitest";
import { numberIsGrounded, stripUngroundedSentences, ungroundedNumbers } from "./ground";

const tables = [
  {
    columns: ["vendor", "total"],
    rows: [
      ["Acme", 15000],
      ["Beta", 4100],
    ],
  },
  { columns: ["month"], rows: [["2024-01-01"]] },
];

describe("number grounding", () => {
  it("accepts a cell, a thousands separator, and a date part", () => {
    expect(numberIsGrounded("15000", tables)).toBe(true);
    expect(numberIsGrounded("15,000", tables)).toBe(true);
    expect(numberIsGrounded("2024", tables)).toBe(true);
    expect(numberIsGrounded("01", tables)).toBe(true);
  });

  it("rejects a figure that is only a prefix of a cell", () => {
    expect(ungroundedNumbers("Acme is 71% and the share is 150.", tables)).toEqual(["71%", "150"]);
  });

  it("drops only the sentence that invented a number", () => {
    const kept = stripUngroundedSentences("Acme total = 15000. The share is 71%. Beta total = 4100.", tables);
    expect(kept).toBe("Acme total = 15000. Beta total = 4100.");
  });
});

import { describe, expect, it } from "vitest";
import {
  EMPTY_FINANCE_PII,
  financeWarningCount,
  financeWarningText,
  parseFinancePii,
  parseFinanceWarnings,
} from "./finance-import-warnings";

describe("financeWarningCount", () => {
  it("counts the list when the detail is the list itself", () => {
    expect(financeWarningCount({ code: "dropped_columns", message: "", detail: ["No", "NPWP", "Gaji Pokok"] })).toBe(3);
  });

  it("reads the number when the detail is one summary line", () => {
    expect(financeWarningCount({ code: "truncated", message: "", detail: ["12 lines"] })).toBe(12);
    expect(financeWarningCount({ code: "dropped_rows", message: "", detail: ["4 rows"] })).toBe(4);
  });

  it("is zero for a warning that carries no detail at all", () => {
    expect(financeWarningCount({ code: "compacted", message: "", detail: [] })).toBe(0);
  });

  it("does not mistake a single row label for a count", () => {
    expect(financeWarningCount({ code: "dropped_rows", message: "", detail: ["Saldo awal"] })).toBe(1);
  });
});

describe("financeWarningText", () => {
  it("writes the sentence from the code and the count, never from the host's English", () => {
    expect(financeWarningText({ code: "dropped_columns", message: "raw", detail: ["a", "b", "c"] })).toBe(
      "3 columns were not imported",
    );
    expect(financeWarningText({ code: "direction_mismatch", message: "raw", detail: ["a", "b", "c", "d"] })).toBe(
      "4 rows disagree with their direction label",
    );
  });

  it("says nothing at all for a code this build has no words for", () => {
    expect(financeWarningText({ code: "something_new", message: "raw", detail: [] })).toBeNull();
  });
});

describe("parseFinanceWarnings", () => {
  it("keeps the warning-shaped entries and drops everything else", () => {
    expect(
      parseFinanceWarnings([
        { code: "dropped_columns", message: "3 columns were not imported", detail: ["No", "NPWP", "Gaji Pokok"] },
        { message: "no code" },
        { code: "   " },
        null,
        "nope",
      ]),
    ).toEqual([
      { code: "dropped_columns", message: "3 columns were not imported", detail: ["No", "NPWP", "Gaji Pokok"] },
    ]);
  });

  it("coerces the detail cells and answers an empty list for a missing field", () => {
    expect(parseFinanceWarnings([{ code: "truncated", detail: [12, null] }])).toEqual([
      { code: "truncated", message: "", detail: ["12", ""] },
    ]);
    expect(parseFinanceWarnings(undefined)).toEqual([]);
    expect(parseFinanceWarnings({ code: "dropped_rows" })).toEqual([]);
  });
});

describe("parseFinancePii", () => {
  it("reads the count and the kinds, and treats zero as nothing to say", () => {
    expect(parseFinancePii({ count: 51, kinds: ["name", "nik"] })).toEqual({ count: 51, kinds: ["name", "nik"] });
    expect(parseFinancePii({ count: 0, kinds: [] })).toBe(EMPTY_FINANCE_PII);
    expect(parseFinancePii(undefined)).toBe(EMPTY_FINANCE_PII);
    expect(parseFinancePii({ count: "many" })).toBe(EMPTY_FINANCE_PII);
  });
});

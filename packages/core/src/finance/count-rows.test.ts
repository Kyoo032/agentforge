import { describe, expect, it } from "vitest";
import { COUNT_WORDS, dropCountRows, isCountRow } from "./count-rows";
import type { LineItem } from "./types";

function row(overrides: Partial<LineItem>): LineItem {
  return { label: "Revenue", period: "", amount: 1, currency: "", category: "other", ...overrides };
}

describe("isCountRow", () => {
  it("drops the '12 outlets' row the parse step used to invent", () => {
    expect(isCountRow(row({ label: "outlets", amount: 12, currency: "", category: "other" }))).toBe(true);
  });

  it("keeps 'units sold 12000 IDR' because it carries a currency", () => {
    expect(isCountRow(row({ label: "units sold", amount: 12_000, currency: "IDR", category: "revenue" }))).toBe(false);
  });

  it("keeps a large whole number even without a currency", () => {
    expect(isCountRow(row({ label: "customers", amount: 12_000 }))).toBe(false);
  });

  it("keeps a fractional amount such as a rate", () => {
    expect(isCountRow(row({ label: "months", amount: 7.5 }))).toBe(false);
  });

  it("keeps a monetary label that no count word matches", () => {
    expect(isCountRow(row({ label: "Rent", amount: 12 }))).toBe(false);
  });

  it("matches singular and mixed-case count labels", () => {
    expect(isCountRow(row({ label: "Outlet", amount: 1 }))).toBe(true);
    expect(isCountRow(row({ label: "New branch opened", amount: 3 }))).toBe(true);
    expect(isCountRow(row({ label: "Headcount", amount: 48 }))).toBe(true);
  });

  it("matches every count word on a small currency-free integer", () => {
    for (const word of COUNT_WORDS) {
      expect(isCountRow(row({ label: word, amount: 12 }))).toBe(true);
    }
  });

  it("does not match a count word inside a longer word", () => {
    expect(isCountRow(row({ label: "daysheet", amount: 12 }))).toBe(false);
  });
});

describe("dropCountRows", () => {
  it("returns a new list with only the monetary rows", () => {
    const items = [
      row({ label: "outlets", amount: 12 }),
      row({ label: "Revenue", amount: 18_400_000_000, currency: "IDR", category: "revenue" }),
      row({ label: "units sold", amount: 12_000, currency: "IDR", category: "revenue" }),
    ];
    const kept = dropCountRows(items);
    expect(kept.map((item) => item.label)).toEqual(["Revenue", "units sold"]);
    expect(items).toHaveLength(3);
    expect(kept).not.toBe(items);
  });

  it("leaves a list with no count rows untouched in content", () => {
    const items = [row({ label: "Rent", amount: 12, currency: "USD", category: "opex" })];
    expect(dropCountRows(items)).toEqual(items);
  });
});

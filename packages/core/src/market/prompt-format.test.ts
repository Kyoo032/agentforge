import { describe, expect, it } from "vitest";
import { formatFixed, formatPercent, formatPrice, presentationValues } from "./prompt-format";

describe("formatFixed", () => {
  it("keeps trailing zeros, never prints negative zero, and rounds half away", () => {
    expect(formatFixed(4.804, 2)).toBe("4.80");
    expect(formatFixed(57.66191, 1)).toBe("57.7");
    expect(formatFixed(-0.001, 2)).toBe("0.00");
    expect(formatFixed(1255, 0)).toBe("1255");
    expect(formatFixed(0.5575757, 2)).toBe("0.56");
  });
});

describe("formatPrice", () => {
  it("uses two decimals below 1000 and whole units at or above 1000 or in IDR", () => {
    expect(formatPrice(886.26, "USD")).toBe("886.26");
    expect(formatPrice(935.6381, "USD")).toBe("935.64");
    expect(formatPrice(1000.26, "USD")).toBe("1000");
    expect(formatPrice(6678.201, "")).toBe("6678");
    expect(formatPrice(8.925, "IDR")).toBe("9");
    expect(formatPrice(17547.4, "IDR")).toBe("17547");
    expect(formatPrice(26_367_138, "USD")).toBe("26367138");
  });
});

describe("formatPercent", () => {
  it("signs positives and shows two decimals", () => {
    expect(formatPercent(3.730993)).toBe("+3.73%");
    expect(formatPercent(-0.055985)).toBe("-0.06%");
    expect(formatPercent(0)).toBe("0.00%");
    expect(formatPercent(-0.001)).toBe("0.00%");
  });
});

describe("presentationValues", () => {
  it("returns the raw value with its 0, 1, and 2-decimal presentations, and absolute values for negatives", () => {
    expect(presentationValues(57.66191)).toEqual([57.66191, 58, 57.7, 57.66]);
    expect(presentationValues(-2.145016)).toEqual([-2.145016, -2, -2.1, -2.15, 2.145016, 2, 2.1, 2.15]);
    expect(presentationValues(1255)).toEqual([1255]);
    expect(presentationValues(-0.03)).toEqual([-0.03, 0, 0.03]);
  });
});

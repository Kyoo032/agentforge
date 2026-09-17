import { describe, expect, it } from "vitest";
import {
  amountsMatch,
  extractFigures,
  figureValues,
  isFreeFigure,
  normaliseAccountingNegatives,
  unitsCompatible,
} from "./numbers.mjs";

/** The first figure the extractor found, so a case can assert on one number at a time. */
function first(text, locale = "en") {
  const found = extractFigures(text, locale);
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}

describe("extractFigures — en number culture", () => {
  it("reads grouped thousands with a decimal point", () => {
    expect(first("Revenue was 1,250,000.50 for the year.").value).toBeCloseTo(1250000.5, 6);
  });

  it("reads a dollar magnitude suffix", () => {
    const figure = first("Cash stood at $1.2M at close.");
    expect(figure.value).toBe(1200000);
    expect(figure.unit).toBe("currency");
  });

  it("reads an Indonesian magnitude word under the en decimal mark", () => {
    expect(first("Revenue reached 2.35 juta this year.").value).toBe(2350000);
  });

  it("reads a percentage", () => {
    const figure = first("Gross margin held at 41.6% through Q4.");
    expect(figure.value).toBeCloseTo(41.6, 6);
    expect(figure.unit).toBe("percent");
  });

  it("tags a month count as months, not money", () => {
    const figure = first("Runway is 18 months at the current burn.");
    expect(figure.value).toBe(18);
    expect(figure.unit).toBe("months");
  });

  it("tags a multiple as a ratio", () => {
    expect(first("The current ratio sits at 1.8x.").unit).toBe("ratio");
  });
});

describe("extractFigures — id number culture", () => {
  it("reads point thousands with a comma decimal", () => {
    const figure = first("Pendapatan Rp 1.250.000,50 tahun ini.", "id");
    expect(figure.value).toBeCloseTo(1250000.5, 6);
    expect(figure.unit).toBe("currency");
  });

  it("expands a rupiah magnitude word", () => {
    const figure = first("Kas tersisa Rp 1,25 miliar.", "id");
    expect(figure.value).toBe(1_250_000_000);
    expect(figure.unit).toBe("currency");
  });

  it("reads a comma-decimal percentage", () => {
    const figure = first("Marjin kotor 41,6% pada 2025.", "id");
    expect(figure.value).toBeCloseTo(41.6, 6);
    expect(figure.unit).toBe("percent");
  });

  it("tags bulan as months", () => {
    expect(first("Runway 12 bulan.", "id").unit).toBe("months");
  });

  it("keeps both readings of a genuinely ambiguous group", () => {
    // "4.804" is four thousand eight hundred and four in id, and 4.804 in en.
    expect(figureValues(first("Beban 4.804 rupiah.", "id"))).toContain(4804);
  });

  it("keeps both locale readings of an ambiguous magnitude token", () => {
    const values = figureValues(first("Beban 4.804 juta rupiah.", "id"));
    expect(values).toContain(4_804_000_000);
    expect(values).toContain(4_804_000);
  });
});

describe("accounting parentheses", () => {
  it("turns a parenthesised amount into a negative", () => {
    expect(normaliseAccountingNegatives("Operating loss (1.200) this year")).toContain("-1.200");
  });

  it("reads the negative back out", () => {
    expect(figureValues(first("Operating loss (1.200) this year", "id"))).toContain(-1200);
  });

  it("leaves a bare year alone", () => {
    expect(normaliseAccountingNegatives("In the base year (2024) revenue held")).toBe(
      "In the base year (2024) revenue held",
    );
  });

  it("leaves prose in parentheses alone", () => {
    expect(normaliseAccountingNegatives("Revenue rose (see note 3)")).toBe("Revenue rose (see note 3)");
  });

  it("keeps a currency mark inside the parentheses", () => {
    expect(figureValues(first("Net ($1,200) for the quarter."))).toContain(-1200);
  });
});

describe("free figures", () => {
  it("frees a calendar year", () => {
    expect(isFreeFigure(first("The 2024 accounts close in March."))).toBe(true);
  });

  it("frees a small count", () => {
    expect(isFreeFigure(first("Across 3 scenarios."))).toBe(true);
  });

  it("does not free a real amount", () => {
    expect(isFreeFigure(first("Revenue of 1,250,000."))).toBe(false);
  });
});

describe("amountsMatch", () => {
  it("accepts a percentage the product's own guard would call verified", () => {
    expect(amountsMatch(41.6, 41.62, 0.005)).toBe(true);
  });

  it("rejects a percentage well outside the guard's tolerance", () => {
    expect(amountsMatch(41.6, 44.0, 0.005)).toBe(false);
  });

  it("reads the case tolerance as an absolute widening", () => {
    expect(amountsMatch(1_000_000, 1_020_000, 25_000)).toBe(true);
    expect(amountsMatch(1_000_000, 1_020_000, 1)).toBe(false);
  });

  it("falls back to the product's own guard tolerance", () => {
    expect(amountsMatch(1_250_000, 1_250_100, undefined)).toBe(true);
    expect(amountsMatch(1_250_000, 1_350_000, undefined)).toBe(false);
  });

  it("refuses a non-finite candidate", () => {
    expect(amountsMatch(10, Number.NaN, undefined)).toBe(false);
  });
});

describe("unitsCompatible", () => {
  it("never lets a percentage stand in for money", () => {
    expect(unitsCompatible("currency", "percent")).toBe(false);
  });

  it("lets an unmarked number stand in for money", () => {
    expect(unitsCompatible("currency", "number")).toBe(true);
  });

  it("matches percent to percent only", () => {
    expect(unitsCompatible("percent", "percent")).toBe(true);
    expect(unitsCompatible("percent", "number")).toBe(false);
  });
});

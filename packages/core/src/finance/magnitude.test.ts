import { describe, expect, it } from "vitest";
import { expandMagnitudes, looksScaled, magnitudeValues } from "./magnitude";
import type { LineItem } from "./types";

const EN_BRIEF = "Q3 2026 review: revenue IDR 18.4B, COGS IDR 7.9B, opex IDR 6.1B, net profit IDR 2.6B";
const ID_BRIEF = "Tinjauan Q3 2026: pendapatan Rp 18,4 M, HPP Rp 7,9 M, opex Rp 6,1 M, laba bersih Rp 2,6 M";

function row(overrides: Partial<LineItem>): LineItem {
  return { label: "Revenue", period: "", amount: 0, currency: "IDR", category: "revenue", ...overrides };
}

describe("expandMagnitudes", () => {
  it("expands the English brief and keeps the currency tokens", () => {
    expect(expandMagnitudes(EN_BRIEF, "en")).toBe(
      "Q3 2026 review: revenue IDR 18400000000, COGS IDR 7900000000, opex IDR 6100000000, net profit IDR 2600000000",
    );
  });

  it("expands the Indonesian brief, reading the decimal comma and M as miliar", () => {
    expect(expandMagnitudes(ID_BRIEF, "id")).toBe(
      "Tinjauan Q3 2026: pendapatan Rp 18400000000, HPP Rp 7900000000, opex Rp 6100000000, laba bersih Rp 2600000000",
    );
  });

  it("reads M as a million in English and as miliar in Indonesian", () => {
    expect(expandMagnitudes("USD 3M", "en")).toBe("USD 3000000");
    expect(expandMagnitudes("Rp 3 M", "id")).toBe("Rp 3000000000");
  });

  it("covers the Indonesian word suffixes", () => {
    expect(expandMagnitudes("Rp 500 rb, Rp 2,5 juta, Rp 1,2 miliar, Rp 3 triliun", "id")).toBe(
      "Rp 500000, Rp 2500000, Rp 1200000000, Rp 3000000000000",
    );
  });

  it("covers the English word suffixes and a currency with no gap", () => {
    expect(expandMagnitudes("40k burn, 1.5 million users, $2bn raised, 12 thousand seats", "en")).toBe(
      "40000 burn, 1500000 users, $2000000000 raised, 12000 seats",
    );
    expect(expandMagnitudes("Rp7,9M", "id")).toBe("Rp7900000000");
  });

  it("reads grouped digits with the locale's own separators", () => {
    expect(expandMagnitudes("USD 1,250.5k", "en")).toBe("USD 1250500");
    expect(expandMagnitudes("Rp 1.250,5 rb", "id")).toBe("Rp 1250500");
  });

  it("keeps the sign on a negative figure", () => {
    expect(expandMagnitudes("net -2.6B", "en")).toBe("net -2600000000");
  });

  it("leaves periods, counts, identifiers and unknown words alone", () => {
    expect(expandMagnitudes("Q3 2026 review", "en")).toBe("Q3 2026 review");
    expect(expandMagnitudes("12 outlets across 3 branches", "en")).toBe("12 outlets across 3 branches");
    expect(expandMagnitudes("gpt-5.6-luna and deepseek-v4-flash", "en")).toBe("gpt-5.6-luna and deepseek-v4-flash");
    expect(expandMagnitudes("18 months, 4 weeks, 30 days", "en")).toBe("18 months, 4 weeks, 30 days");
    expect(expandMagnitudes("12 m of cable", "en")).toBe("12 m of cable");
    expect(expandMagnitudes("", "en")).toBe("");
  });

  it("leaves a plain amount that has no suffix", () => {
    expect(expandMagnitudes("revenue IDR 18400000000", "en")).toBe("revenue IDR 18400000000");
  });
});

describe("magnitudeValues", () => {
  it("lists what each suffixed figure stands for, in order", () => {
    expect(magnitudeValues(EN_BRIEF, "en")).toEqual([18_400_000_000, 7_900_000_000, 6_100_000_000, 2_600_000_000]);
    expect(magnitudeValues(ID_BRIEF, "id")).toEqual([18_400_000_000, 7_900_000_000, 6_100_000_000, 2_600_000_000]);
  });

  it("is empty when nothing is suffixed", () => {
    expect(magnitudeValues("12 outlets, Q3 2026, gpt-5.6-luna", "en")).toEqual([]);
  });
});

describe("looksScaled", () => {
  it("restores the mantissas the model copied out of the English brief", () => {
    const items = [
      row({ label: "revenue", amount: 18.4, category: "revenue" }),
      row({ label: "COGS", amount: 7.9, category: "cogs" }),
      row({ label: "opex", amount: 6.1, category: "opex" }),
      row({ label: "net profit", amount: 2.6, category: "other" }),
    ];
    expect(looksScaled(EN_BRIEF, items, "en").map((item) => item.amount)).toEqual([
      18_400_000_000, 7_900_000_000, 6_100_000_000, 2_600_000_000,
    ]);
    expect(items.map((item) => item.amount)).toEqual([18.4, 7.9, 6.1, 2.6]);
  });

  it("restores them from the Indonesian brief too", () => {
    const items = [row({ label: "pendapatan", amount: 18.4, category: "revenue" })];
    expect(looksScaled(ID_BRIEF, items, "id")[0]?.amount).toBe(18_400_000_000);
  });

  it("leaves rows the model already read correctly", () => {
    const items = [row({ label: "revenue", amount: 18_400_000_000, category: "revenue" })];
    expect(looksScaled(EN_BRIEF, items, "en")).toEqual(items);
  });

  it("leaves a row no magnitude token explains", () => {
    const items = [row({ label: "headcount cost", amount: 4200 })];
    expect(looksScaled(EN_BRIEF, items, "en")[0]?.amount).toBe(4200);
  });

  it("leaves everything alone when the text has no suffixed figure", () => {
    const items = [row({ label: "revenue", amount: 18.4, category: "revenue" })];
    expect(looksScaled("revenue IDR 18.4 for the quarter", items, "en")).toEqual(items);
  });

  it("does not touch a zero amount", () => {
    const items = [row({ label: "grants", amount: 0 })];
    expect(looksScaled(EN_BRIEF, items, "en")[0]?.amount).toBe(0);
  });

  it("returns a new array and never mutates the input rows", () => {
    const items = [row({ label: "revenue", amount: 18.4, category: "revenue" })];
    const kept = looksScaled(EN_BRIEF, items, "en");
    expect(kept).not.toBe(items);
    expect(items[0]?.amount).toBe(18.4);
  });
});

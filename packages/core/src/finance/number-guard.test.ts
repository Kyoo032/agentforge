import { describe, expect, it } from "vitest";
import { UNVERIFIED_MARKER, extractNumbers, guardNumbers, isFreeNumber, matchesAllowed } from "./number-guard";

describe("extractNumbers", () => {
  it("reads grouped, currency, percent, and scaled numbers", () => {
    const tokens = extractNumbers(
      "Revenue was $1,250,000 (up 12.5%) with Rp 12.000 spent; burn is 40k a month, 2x cover, 1.5 million users.",
    );
    expect(tokens.map((token) => [token.value, token.unit])).toEqual([
      [1_250_000, ""],
      [12.5, "%"],
      [12_000, ""],
      [40_000, ""],
      [2, "x"],
      [1_500_000, ""],
    ]);
  });

  it("skips identifiers and treats small counts and years as free", () => {
    expect(extractNumbers("Q1 FY26 S1 v2").map((token) => token.value)).toEqual([]);
    expect(isFreeNumber({ text: "3", value: 3, unit: "", index: 0 })).toBe(true);
    expect(isFreeNumber({ text: "2026", value: 2026, unit: "", index: 0 })).toBe(true);
    expect(isFreeNumber({ text: "3%", value: 3, unit: "%", index: 0 })).toBe(false);
    expect(isFreeNumber({ text: "250", value: 250, unit: "", index: 0 })).toBe(false);
  });

  // A year and a small count are free only as they are written bare. A currency mark, a scale or a
  // separator makes the same value a money figure, and a money figure has to trace.
  it("frees only a bare year or a bare small count, never a written amount", () => {
    for (const text of ["$2,000", "2k", "Rp 1.950", "2,024", "Rp 5", "$12", "12.0", "-3", "1.5 million"]) {
      const flagged = guardNumbers(`The figure was ${text} in total.`, []).flagged.map((token) => token.text);
      expect(flagged, text).toEqual([text]);
    }
    for (const text of ["2024", "1950", "3", "12", "07"]) {
      expect(guardNumbers(`Seen in ${text} places.`, []).flagged, text).toEqual([]);
    }
    expect(guardNumbers("From 2023-2024 across 3 outlets and 12 months.", []).flagged).toEqual([]);
  });

  it("skips index names, 24/7 publisher clocks, and day-count labels", () => {
    expect(
      extractNumbers("S&P 500 futures and Nasdaq 100 held the 50-day average; 24/7 Wall St. and SMA 200.").map(
        (token) => token.text,
      ),
    ).toEqual([]);
    expect(extractNumbers("Russell 2000 and 200-hari, EMA 50.").map((token) => token.text)).toEqual([]);
  });
});

describe("guardNumbers", () => {
  it("passes figures that match inputs or metrics within tolerance and flags the rest", () => {
    const allowed = [1_250_000, 40_000, 31.25, 14];
    const text =
      "Revenue of $1.25 million and burn of 40k give 14 months of runway at a 31.3% margin; churn was 9% in 3 markets.";
    const result = guardNumbers(text, allowed);
    expect(result.flagged.map((token) => token.text)).toEqual(["9%"]);
    expect(result.text).toBe(
      `Revenue of $1.25 million and burn of 40k give 14 months of runway at a 31.3% margin; churn was ${UNVERIFIED_MARKER} in 3 markets.`,
    );
    expect(result.verified).toHaveLength(5);
  });

  it("flags invented figures and keeps text without numbers untouched", () => {
    const result = guardNumbers("Margins reached 48% last year.", [40]);
    expect(result.flagged).toHaveLength(1);
    expect(result.text).toBe(`Margins reached ${UNVERIFIED_MARKER} last year.`);
    expect(guardNumbers("No figures here.", [])).toEqual({ text: "No figures here.", flagged: [], verified: [] });
    const dated = guardNumbers("As of 2025-09-15 the cash balance was $90,000.", [90000]);
    expect(dated.flagged).toEqual([]);
    expect(dated.text).toBe("As of 2025-09-15 the cash balance was $90,000.");
    expect(matchesAllowed(100.4, [100])).toBe(true);
    expect(matchesAllowed(101, [100])).toBe(false);
    expect(matchesAllowed(4.5, [4.667])).toBe(false);
    expect(matchesAllowed(4.7, [4.667])).toBe(true);
    expect(matchesAllowed(31.3, [31.25])).toBe(true);
  });

  it("does not flag label text, and still replaces a real unverified figure", () => {
    const text = "S&P 500 held the 50-day; 24/7 Wall St. cited Nasdaq 100. Fair value is 1234.5.";
    const result = guardNumbers(text, []);
    expect(result.flagged.map((token) => token.text)).toEqual(["1234.5"]);
    expect(result.text).toBe(
      `S&P 500 held the 50-day; 24/7 Wall St. cited Nasdaq 100. Fair value is ${UNVERIFIED_MARKER}.`,
    );
  });
});

describe("three-decimal tokens (4.804 is 4,804 in id-ID and 4.804 in en-US)", () => {
  it("keeps both readings so either one can be verified", () => {
    const [token] = extractNumbers("US 10Y at 4.804");
    expect(token).toMatchObject({ value: 4804, alternate: 4.804, unit: "" });
    expect(guardNumbers("US 10Y at 4.804 and DXY 98.658", [4.804, 98.658]).flagged).toEqual([]);
    expect(guardNumbers("Rp 12.000 spent", [12_000]).flagged).toEqual([]);
    expect(guardNumbers("US 10Y at 4.804", [4.2]).flagged.map((hit) => hit.text)).toEqual(["4.804"]);
  });

  it("reads signed, percent, and leading-zero tokens as decimals first", () => {
    const tokens = extractNumbers("pre-market -0.056% then +3.731%, MACD -2.145 vs 0.790");
    expect(tokens.map((token) => [token.value, token.unit])).toEqual([
      [-0.056, "%"],
      [3.731, "%"],
      [-2.145, ""],
      [0.79, ""],
    ]);
    expect(tokens[0]?.alternate).toBeUndefined();
    expect(tokens[2]?.alternate).toBe(-2145);
    expect(guardNumbers("pre-market -0.056%", [-0.055985]).flagged).toEqual([]);
  });

  it("leaves multi-group and 4+ digit numbers unambiguous", () => {
    expect(
      extractNumbers("1,250,000 and 6678.201 and 935.6381").map((token) => [token.value, token.alternate]),
    ).toEqual([
      [1_250_000, undefined],
      [6678.201, undefined],
      [935.6381, undefined],
    ]);
  });
});

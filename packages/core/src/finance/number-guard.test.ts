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
});

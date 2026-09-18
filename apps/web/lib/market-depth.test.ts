/**
 * The two rules the depth control rests on, tested away from the component
 * (`apps/web` runs vitest without a DOM):
 *
 *  - which desks offer the analyst team, and what happens to the chosen depth
 *    when the rail moves to one that does not;
 *  - which vendors the source badge names once a desk reads sentiment.
 */
import { describe, expect, it } from "vitest";
import { MARKET_SOURCES, MARKET_SPECIALISTS, analystsFor, harnessFor } from "@agentforge/core/market";
import {
  DEFAULT_MARKET_DEPTH,
  MARKET_ANALYSTS,
  MARKET_DEPTHS,
  nextDepth,
  sourceProviderIds,
  specialistAnalysts,
  specialistProviderIds,
  specialistProviders,
  specialistSourcesLine,
  teamAvailable,
} from "./market-specialist";

/** The three desks the contract leaves without analysts. */
const NO_TEAM = ["scanner", "sector-rotation", "elliott-wave"] as const;

describe("market depth", () => {
  it("offers exactly two depths and starts at quick", () => {
    expect([...MARKET_DEPTHS]).toEqual(["quick", "team"]);
    expect(DEFAULT_MARKET_DEPTH).toBe("quick");
  });

  it("offers the team on a desk whose harness names analysts, and nowhere else", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      const analysts = specialistAnalysts(specialist);
      expect(teamAvailable(specialist), specialist).toBe(analysts.length > 0);
      // Whatever the desk runs is drawn from the four core analysts, no duplicates.
      expect(new Set(analysts).size, specialist).toBe(analysts.length);
      for (const analyst of analysts) {
        expect([...MARKET_ANALYSTS], specialist).toContain(analyst);
      }
    }
  });

  it("reads the desk's analysts straight off core rather than keeping a second list", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      expect([...specialistAnalysts(specialist)], specialist).toEqual([...analystsFor(specialist)]);
    }
  });

  it("names the four analysts on the equities desk and none on the table desks", () => {
    expect([...MARKET_ANALYSTS]).toEqual(["technical", "fundamentals", "sentiment", "news"]);
    expect([...specialistAnalysts("saham")]).toEqual([...MARKET_ANALYSTS]);
    for (const specialist of NO_TEAM) {
      expect(specialistAnalysts(specialist), specialist).toHaveLength(0);
      expect(teamAvailable(specialist), specialist).toBe(false);
    }
  });

  it("keeps the chosen depth on a desk that offers the team", () => {
    for (const depth of MARKET_DEPTHS) {
      expect(nextDepth({ depth, specialist: "saham" })).toBe(depth);
      expect(nextDepth({ depth, specialist: "crypto" })).toBe(depth);
    }
  });

  it("falls back to quick when the rail moves to a desk with no analysts", () => {
    for (const specialist of NO_TEAM) {
      expect(nextDepth({ depth: "team", specialist }), specialist).toBe("quick");
      expect(nextDepth({ depth: "quick", specialist }), specialist).toBe("quick");
    }
  });

  it("clamps every desk to a depth the host can actually run", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      const clamped = nextDepth({ depth: "team", specialist });
      expect(clamped === "team" ? teamAvailable(specialist) : true, specialist).toBe(true);
    }
  });
});

describe("market source badge", () => {
  it("names a provider for every packet section core ships", () => {
    for (const source of MARKET_SOURCES) {
      expect(sourceProviderIds(source).length, `no provider for ${source}`).toBeGreaterThan(0);
    }
  });

  it("reads sentiment off StockTwits and Reddit, in that order", () => {
    expect([...sourceProviderIds("sentiment")]).toEqual(["stocktwits", "reddit"]);
    expect(specialistProviders("saham", "Computed on device")).toEqual(
      expect.arrayContaining(["StockTwits", "Reddit"]),
    );
  });

  it("adds StockTwits · Reddit to the badge of every desk that reads sentiment", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      const reads = harnessFor(specialist).sources.includes("sentiment");
      const line = specialistSourcesLine({
        specialist,
        prefix: "Sources",
        computedLabel: "Computed on device",
      });
      expect(line.includes("StockTwits · Reddit"), `${specialist}: ${line}`).toBe(reads);
    }
  });

  it("leaves a desk with no sentiment section untouched", () => {
    expect(specialistProviderIds("scanner")).not.toContain("stocktwits");
    expect(specialistProviderIds("scanner")).not.toContain("reddit");
  });

  it("keeps each provider once and in harness order", () => {
    for (const specialist of MARKET_SPECIALISTS) {
      const ids = specialistProviderIds(specialist);
      expect(new Set(ids).size, specialist).toBe(ids.length);
      expect(ids[0], specialist).toBe("yahoo");
    }
  });
});

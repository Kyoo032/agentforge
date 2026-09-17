import { describe, expect, it } from "vitest";
import {
  HISTORY_MONTHS_ALLOWED,
  MARKET_HARNESS,
  MARKET_SOURCES,
  MARKET_TOOL_KEYS,
  harnessFor,
  type MarketSource,
} from "./harness";
import { MARKET_SPECIALISTS } from "./specialist-ids";

const SOURCES: ReadonlySet<string> = new Set(MARKET_SOURCES);
const TOOLS: ReadonlySet<string> = new Set(MARKET_TOOL_KEYS);

describe("MARKET_HARNESS", () => {
  it("has a spec per specialist, keyed by its own id", () => {
    expect(Object.keys(MARKET_HARNESS).sort()).toEqual([...MARKET_SPECIALISTS].sort());
    for (const id of MARKET_SPECIALISTS) {
      expect(MARKET_HARNESS[id].specialist).toBe(id);
    }
  });

  it("names only known sources, without duplicates, and always fetches quotes", () => {
    for (const id of MARKET_SPECIALISTS) {
      const { sources } = MARKET_HARNESS[id];
      expect(sources.length).toBeGreaterThan(0);
      expect(new Set(sources).size).toBe(sources.length);
      for (const source of sources) {
        expect(SOURCES.has(source)).toBe(true);
      }
      expect(sources).toContain("quotes");
    }
  });

  it("renders only sections it also fetches (packetOrder is a subset of sources)", () => {
    for (const id of MARKET_SPECIALISTS) {
      const spec = MARKET_HARNESS[id];
      const fetched: ReadonlySet<MarketSource> = new Set(spec.sources);
      expect(spec.packetOrder.length).toBeGreaterThan(0);
      expect(new Set(spec.packetOrder).size).toBe(spec.packetOrder.length);
      for (const section of spec.packetOrder) {
        expect(fetched.has(section)).toBe(true);
      }
    }
  });

  it("binds a non-empty tool set from the known keys, always including the calculator", () => {
    for (const id of MARKET_SPECIALISTS) {
      const { tools } = MARKET_HARNESS[id];
      expect(tools.length).toBeGreaterThan(0);
      expect(new Set(tools).size).toBe(tools.length);
      for (const tool of tools) {
        expect(TOOLS.has(tool)).toBe(true);
      }
      expect(tools).toContain("calculator");
    }
  });

  it("requests a history depth of 6, 12, or 24 months and a non-negative headline cap", () => {
    for (const id of MARKET_SPECIALISTS) {
      const spec = MARKET_HARNESS[id];
      expect(HISTORY_MONTHS_ALLOWED).toContain(spec.historyMonths);
      expect(Number.isInteger(spec.headlineCap)).toBe(true);
      expect(spec.headlineCap).toBeGreaterThanOrEqual(0);
      expect(typeof spec.webResearch).toBe("boolean");
    }
  });

  it("gives the desks the depth and the reach the contract asks for", () => {
    expect(MARKET_HARNESS["elliott-wave"].historyMonths).toBe(24);
    expect(MARKET_HARNESS.saham.historyMonths).toBe(12);
    expect(MARKET_HARNESS.forex.historyMonths).toBe(12);
    expect(MARKET_HARNESS.news.headlineCap).toBe(10);
    expect(MARKET_HARNESS.scanner.headlineCap).toBe(0);
    expect(MARKET_HARNESS["sector-rotation"].headlineCap).toBe(0);
    expect(MARKET_HARNESS.indices.webResearch).toBe(false);
    expect(MARKET_HARNESS.saham.webResearch).toBe(true);
  });

  /**
   * `computeTechnical` needs ~200 daily bars for `sma200` and 252 for the
   * 52-week high and low, so six months silently drops those fields for every
   * ticker TradingView does not cover. `signals` and `rotation` are computed
   * from the same bars, so they carry the same floor.
   */
  it("asks for at least 12 months of bars wherever the chart is computed in code", () => {
    const COMPUTED: readonly MarketSource[] = ["technicals", "signals", "rotation"];
    for (const id of MARKET_SPECIALISTS) {
      const spec = MARKET_HARNESS[id];
      if (spec.sources.some((source) => COMPUTED.includes(source))) {
        expect({ id, deepEnough: spec.historyMonths >= 12 }).toEqual({ id, deepEnough: true });
      }
    }
  });

  it("leaves the quote-and-headline desks at six months, and the wave counter at two years", () => {
    expect(MARKET_HARNESS.summary.historyMonths).toBe(6);
    expect(MARKET_HARNESS.news.historyMonths).toBe(6);
    expect(MARKET_HARNESS["elliott-wave"].historyMonths).toBe(24);
    for (const id of ["summary", "news"] as const) {
      expect(MARKET_HARNESS[id].sources).not.toContain("technicals");
    }
  });

  it("gives each desk the computed section its job needs", () => {
    expect(MARKET_HARNESS.scanner.sources).toContain("signals");
    expect(MARKET_HARNESS["sector-rotation"].sources).toContain("rotation");
    expect(MARKET_HARNESS["elliott-wave"].sources).toContain("swings");
    expect(MARKET_HARNESS.crypto.sources).toContain("crypto");
    expect(MARKET_HARNESS.gold.sources).toContain("metals");
    expect(MARKET_HARNESS.summary.sources).toContain("sessions");
  });

  it("only asks for headlines when it also asks for a headline budget", () => {
    for (const id of MARKET_SPECIALISTS) {
      const spec = MARKET_HARNESS[id];
      if (spec.sources.includes("headlines")) {
        expect(spec.headlineCap).toBeGreaterThan(0);
      }
    }
  });

  it("is frozen so a caller cannot rewrite another desk's harness", () => {
    expect(Object.isFrozen(MARKET_HARNESS)).toBe(true);
  });
});

describe("harnessFor", () => {
  it("returns that specialist's spec", () => {
    for (const id of MARKET_SPECIALISTS) {
      expect(harnessFor(id)).toBe(MARKET_HARNESS[id]);
    }
  });
});

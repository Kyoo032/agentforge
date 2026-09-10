import { describe, expect, it } from "vitest";
import { LQ45_UNIVERSE, findConstituent, isKnownTicker } from "./universe";

describe("LQ45_UNIVERSE", () => {
  it("has 45 constituents and is frozen", () => {
    expect(LQ45_UNIVERSE.index).toBe("LQ45");
    expect(LQ45_UNIVERSE.constituents).toHaveLength(45);
    expect(Object.isFrozen(LQ45_UNIVERSE)).toBe(true);
    expect(Object.isFrozen(LQ45_UNIVERSE.constituents)).toBe(true);
    expect(Object.isFrozen(LQ45_UNIVERSE.constituents[0])).toBe(true);
  });

  it("has unique tickers with Yahoo suffixes", () => {
    const tickers = LQ45_UNIVERSE.constituents.map((item) => item.ticker);
    expect(new Set(tickers).size).toBe(45);
    expect(LQ45_UNIVERSE.constituents.every((item) => item.yahoo === `${item.ticker}.JK`)).toBe(true);
  });
});

describe("findConstituent", () => {
  it("resolves a ticker case-insensitively", () => {
    expect(findConstituent("BBCA")?.name).toBe("Bank Central Asia");
    expect(findConstituent("bbca")?.yahoo).toBe("BBCA.JK");
  });

  it("resolves an alias and a full name", () => {
    expect(findConstituent("BCA")?.ticker).toBe("BBCA");
    expect(findConstituent("bank central asia")?.ticker).toBe("BBCA");
  });

  it("trims whitespace and returns null for unknown input", () => {
    expect(findConstituent("  bbca ")?.ticker).toBe("BBCA");
    expect(findConstituent("ZZZZ")).toBeNull();
    expect(findConstituent("")).toBeNull();
  });
});

describe("isKnownTicker", () => {
  it("is true for tickers and aliases, false otherwise", () => {
    expect(isKnownTicker("BBCA")).toBe(true);
    expect(isKnownTicker("Astra")).toBe(true);
    expect(isKnownTicker("AAPL")).toBe(false);
  });
});

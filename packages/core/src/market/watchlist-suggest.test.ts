import { describe, expect, it } from "vitest";
import { canonicalWatchTicker, lookupWatchTicker, suggestWatchlistTickers } from "./watchlist-suggest";

describe("suggestWatchlistTickers", () => {
  it("matches an IDX alias and a company name fragment", () => {
    expect(suggestWatchlistTickers("bca")[0]?.ticker).toBe("BBCA");
    expect(suggestWatchlistTickers("bank central").map((item) => item.ticker)).toContain("BBCA");
    expect(suggestWatchlistTickers("astra")[0]?.ticker).toBe("ASII");
  });

  it("matches a familiar US name", () => {
    expect(suggestWatchlistTickers("nvid")[0]?.ticker).toBe("NVDA");
    expect(suggestWatchlistTickers("micron")[0]?.ticker).toBe("MU");
  });

  it("ranks a ticker prefix ahead of a looser name hit", () => {
    const tickers = suggestWatchlistTickers("bb").map((item) => item.ticker);
    expect(tickers[0]).toMatch(/^BB/);
  });

  it("omits tickers already on the list and returns nothing for a blank query", () => {
    expect(suggestWatchlistTickers("bbca", { exclude: ["BBCA"] })).toEqual([]);
    expect(suggestWatchlistTickers("   ")).toEqual([]);
  });
});

describe("canonicalWatchTicker", () => {
  it("rewrites an alias to the chip ticker", () => {
    expect(canonicalWatchTicker("BCA")).toBe("BBCA");
    expect(canonicalWatchTicker("nvidia")).toBe("NVDA");
    expect(canonicalWatchTicker("mu")).toBe("MU");
  });

  it("uppercases unknown symbols instead of inventing a match", () => {
    expect(canonicalWatchTicker("zzzz")).toBe("ZZZZ");
    expect(lookupWatchTicker("zzzz")).toBeNull();
    expect(lookupWatchTicker("BCA")).toBe("BBCA");
  });
});

import { describe, expect, it } from "vitest";
import type { MacroSnapshot, Quote, TickerPacket } from "@agentforge/core/market";
import { deriveMetals } from "./metals";

const OBSERVED_AT = "2026-09-17T08:00:00.000Z";

function ref(symbol: string) {
  return {
    source: "yahoo" as const,
    sourceUrl: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    observedAt: OBSERVED_AT,
  };
}

function quote(symbol: string, price: number | null, previousClose: number | null = null): Quote {
  return {
    symbol,
    name: "",
    price,
    changePercent: null,
    previousClose,
    preMarketPrice: null,
    preMarketChangePercent: null,
    postMarketPrice: null,
    postMarketChangePercent: null,
    volume: null,
    marketCap: null,
    marketState: "REGULAR",
    currency: "USD",
    exchange: "",
    ref: ref(symbol),
  };
}

function ticker(symbol: string, price: number | null, previousClose: number | null = null): TickerPacket {
  return {
    symbol: { input: symbol, yahoo: symbol, tradingview: null, name: "", exchange: "", currency: "USD" },
    quote: quote(symbol, price, previousClose),
    technical: null,
    history: null,
    chart: null,
    news: [],
    failures: [],
  };
}

function macro(rows: ReadonlyArray<[string, number]>): MacroSnapshot {
  return { quotes: rows.map(([symbol, price]) => ({ ...quote(symbol, price), label: symbol })), failures: [] };
}

describe("deriveMetals", () => {
  it("reads DXY and the US 10Y from the macro snapshot when it carries them", () => {
    const metals = deriveMetals(
      [],
      macro([
        ["DX-Y.NYB", 97.4],
        ["^TNX", 4.132],
      ]),
      OBSERVED_AT,
    );
    expect(metals).toEqual({ dxy: 97.4, us10y: 4.132, source: "computed", observedAt: OBSERVED_AT });
  });

  it("falls back to the watchlist quotes when the macro snapshot is empty", () => {
    const metals = deriveMetals(
      [ticker("DX-Y.NYB", 98.1), ticker("^TNX", 4.2)],
      { quotes: [], failures: [] },
      OBSERVED_AT,
    );
    expect(metals).toMatchObject({ dxy: 98.1, us10y: 4.2 });
  });

  it("computes the gold/silver ratio from the two futures closes", () => {
    const metals = deriveMetals([ticker("GC=F", 4000), ticker("SI=F", 50)], null, OBSERVED_AT);
    expect(metals?.goldSilverRatio).toBe(80);
    expect(metals?.goldFuturesVsSpotPct).toBeUndefined();
    expect(metals?.goldFuturesVsGldPct).toBeUndefined();
  });

  it("uses the previous close and then the last bar when there is no live price", () => {
    const stale = ticker("GC=F", null, 4100);
    const barsOnly: TickerPacket = {
      ...ticker("SI=F", null),
      quote: null,
      history: {
        symbol: "SI=F",
        interval: "1d",
        bars: [
          { date: "2026-09-16", open: 49, high: 51, low: 48, close: 50, volume: 1 },
          { date: "2026-09-17", open: 50, high: 52, low: 49, close: 41, volume: 1 },
        ],
        ref: ref("SI=F"),
      },
    };
    expect(deriveMetals([stale, barsOnly], null, OBSERVED_AT)?.goldSilverRatio).toBe(100);
  });

  it("publishes a spot basis only against XAUUSD=X", () => {
    const metals = deriveMetals([ticker("GC=F", 4040), ticker("XAUUSD=X", 4000)], null, OBSERVED_AT);
    expect(metals?.goldFuturesVsSpotPct).toBeCloseTo(1, 10);
    expect(metals?.goldFuturesVsGldPct).toBeUndefined();
  });

  it("labels the GLD comparison honestly and never calls it spot", () => {
    // Ten GLD shares (376.0) stand in for an ounce; GC=F at 3798.6 is 1.028% above that proxy.
    const metals = deriveMetals([ticker("GC=F", 3798.6), ticker("GLD", 376)], null, OBSERVED_AT);
    expect(metals?.goldFuturesVsGldPct).toBeCloseTo(1.0266, 3);
    expect(metals).not.toHaveProperty("goldFuturesVsSpotPct");
  });

  it("prefers real spot over the GLD proxy when both are on the watchlist", () => {
    const metals = deriveMetals(
      [ticker("GC=F", 4040), ticker("XAUUSD=X", 4000), ticker("GLD", 376)],
      null,
      OBSERVED_AT,
    );
    expect(metals?.goldFuturesVsSpotPct).toBeCloseTo(1, 10);
    expect(metals?.goldFuturesVsGldPct).toBeUndefined();
  });

  it("omits a field it cannot derive and the whole section when nothing is derivable", () => {
    // Gold alone has no counterpart, so only the macro legs survive.
    const partial = deriveMetals([ticker("GC=F", 4000)], macro([["DX-Y.NYB", 97.4]]), OBSERVED_AT);
    expect(partial).toEqual({ dxy: 97.4, source: "computed", observedAt: OBSERVED_AT });

    expect(deriveMetals([ticker("GC=F", 4000)], null, OBSERVED_AT)).toBeUndefined();
    expect(deriveMetals([ticker("MU", 100), ticker("BBCA.JK", 9000)], null, OBSERVED_AT)).toBeUndefined();
    expect(deriveMetals([], null, OBSERVED_AT)).toBeUndefined();
    // A zero silver close is not a division by zero; the ratio is simply absent.
    expect(deriveMetals([ticker("GC=F", 4000), ticker("SI=F", 0)], null, OBSERVED_AT)).toBeUndefined();
  });

  it("does not mutate the packets it reads", () => {
    const tickers = [ticker("GC=F", 4000), ticker("SI=F", 50)];
    const before = JSON.stringify(tickers);
    deriveMetals(tickers, null, OBSERVED_AT);
    expect(JSON.stringify(tickers)).toBe(before);
  });
});

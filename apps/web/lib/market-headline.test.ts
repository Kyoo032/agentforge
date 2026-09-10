import { describe, expect, it } from "vitest";
import { headlineOf } from "@/lib/market-headline";
import type { Quote } from "@/lib/market-client";

const REF = {
  source: "yahoo" as const,
  sourceUrl: "https://finance.yahoo.com/quote/MU",
  observedAt: "2026-09-10T12:00:00+00:00",
};

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "MU",
    name: "Micron",
    price: 1027.77,
    changePercent: 2.75,
    previousClose: 1000,
    preMarketPrice: null,
    preMarketChangePercent: null,
    postMarketPrice: null,
    postMarketChangePercent: null,
    volume: null,
    marketCap: null,
    marketState: "REGULAR",
    currency: "USD",
    exchange: "NMS",
    ref: REF,
    ...overrides,
  };
}

describe("headlineOf", () => {
  it("leads with the last close during the regular session", () => {
    const headline = headlineOf(quote());
    expect(headline.price).toBe("1,027.77 USD");
    expect(headline.percent).toBe(2.75);
    expect(headline.caption).toBe("");
    expect(headline.note).toBe("");
  });

  it("leads with the pre-market print, not yesterday's close and yesterday's move", () => {
    const headline = headlineOf(quote({ marketState: "PRE", preMarketPrice: 1000.77, preMarketChangePercent: -2.63 }));
    expect(headline.price).toBe("1,000.77");
    expect(headline.percent).toBe(-2.63);
    expect(headline.caption).toBe("Pre-market");
    // The regular-session figures move to a clearly labelled second line.
    expect(headline.note).toBe("Previous close 1,027.77 USD (+2.75%)");
  });

  it("leads with the after-hours print when the session has closed", () => {
    const headline = headlineOf(quote({ marketState: "POST", postMarketPrice: 1040, postMarketChangePercent: 1.19 }));
    expect(headline.price).toBe("1,040.00");
    expect(headline.caption).toBe("After hours");
    expect(headline.note).toContain("Previous close");
  });

  it("never prices an index or a currency pair in a currency", () => {
    expect(headlineOf(quote({ symbol: "^VIX", price: 17.07, currency: "USD" })).price).toBe("17.07");
    expect(headlineOf(quote({ symbol: "IDR=X", price: 17535, currency: "IDR" })).price).toBe("17,535.00");
    expect(headlineOf(quote({ symbol: "BBCA.JK", price: 6425, currency: "IDR" })).price).toBe("6,425.00 IDR");
  });

  it("is blank for a ticker with no quote at all", () => {
    expect(headlineOf(null)).toEqual({ price: "", percent: null, caption: "", note: "" });
  });
});

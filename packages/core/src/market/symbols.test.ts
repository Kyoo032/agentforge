import { describe, expect, it } from "vitest";
import {
  isValidTicker,
  normalizeTickerInput,
  partitionTickerInput,
  toTradingViewSymbol,
  toYahooSymbol,
  tradingViewLabel,
  tradingViewMarket,
} from "./symbols";
import { WATCHLIST_MAX } from "./watch-schemas";

describe("normalizeTickerInput", () => {
  it("splits on commas, whitespace, and semicolons; strips $; uppercases; dedupes", () => {
    expect(normalizeTickerInput("mu, $INTC;nvda  bbca\nMU")).toEqual(["MU", "INTC", "NVDA", "BBCA"]);
  });

  it("keeps suffixes and index/futures symbols intact", () => {
    expect(normalizeTickerInput("bbca.jk ^vix es=f idr=x dx-y.nyb brk-b")).toEqual([
      "BBCA.JK",
      "^VIX",
      "ES=F",
      "IDR=X",
      "DX-Y.NYB",
      "BRK-B",
    ]);
  });

  it("drops empties and caps at WATCHLIST_MAX", () => {
    expect(normalizeTickerInput("  , ; ")).toEqual([]);
    const many = Array.from({ length: WATCHLIST_MAX + 5 }, (_, index) => `T${index}`).join(" ");
    expect(normalizeTickerInput(many)).toHaveLength(WATCHLIST_MAX);
  });
});

describe("toYahooSymbol", () => {
  it("keeps symbols that already carry a suffix, futures, indices, or FX", () => {
    for (const symbol of ["BBCA.JK", "ES=F", "^VIX", "IDR=X", "DX-Y.NYB", "0700.HK", "7203.T", "SHEL.L"]) {
      expect(toYahooSymbol(symbol)).toBe(symbol);
    }
  });

  it("resolves an IDX constituent or alias to its .JK symbol", () => {
    expect(toYahooSymbol("BBCA")).toBe("BBCA.JK");
    expect(toYahooSymbol("bca")).toBe("BBCA.JK");
    expect(toYahooSymbol("Astra")).toBe("ASII.JK");
  });

  it("defaults everything else to the bare U.S. symbol, upper-cased and trimmed", () => {
    expect(toYahooSymbol(" mu ")).toBe("MU");
    expect(toYahooSymbol("$nvda")).toBe("NVDA");
    expect(toYahooSymbol("BRK-B")).toBe("BRK-B");
  });
});

describe("toTradingViewSymbol", () => {
  it("maps Yahoo exchange codes to TradingView exchanges", () => {
    expect(toTradingViewSymbol("MU", "NMS")).toBe("NASDAQ:MU");
    expect(toTradingViewSymbol("ABC", "NGM")).toBe("NASDAQ:ABC");
    expect(toTradingViewSymbol("ABC", "NCM")).toBe("NASDAQ:ABC");
    expect(toTradingViewSymbol("ABC", "NAS")).toBe("NASDAQ:ABC");
    expect(toTradingViewSymbol("IBM", "NYQ")).toBe("NYSE:IBM");
    expect(toTradingViewSymbol("SPY", "PCX")).toBe("AMEX:SPY");
    expect(toTradingViewSymbol("XYZ", "ASE")).toBe("AMEX:XYZ");
    expect(toTradingViewSymbol("BBCA.JK", "JKT")).toBe("IDX:BBCA");
    expect(toTradingViewSymbol("SHEL.L", "LSE")).toBe("LSE:SHEL");
    expect(toTradingViewSymbol("7203.T", "TYO")).toBe("TSE:7203");
    expect(toTradingViewSymbol("7203.T", "JPX")).toBe("TSE:7203");
    expect(toTradingViewSymbol("0700.HK", "HKG")).toBe("HKEX:700");
  });

  it("infers the exchange from a known suffix when the code is missing", () => {
    expect(toTradingViewSymbol("BBCA.JK", "")).toBe("IDX:BBCA");
    expect(toTradingViewSymbol("SHEL.L", "")).toBe("LSE:SHEL");
  });

  it("converts a Yahoo share-class dash to the TradingView dot", () => {
    expect(toTradingViewSymbol("BRK-B", "NYQ")).toBe("NYSE:BRK.B");
  });

  it("returns null for futures, indices, FX, and unknown exchanges", () => {
    expect(toTradingViewSymbol("ES=F", "CME")).toBeNull();
    expect(toTradingViewSymbol("^VIX", "CBOE")).toBeNull();
    expect(toTradingViewSymbol("IDR=X", "CCY")).toBeNull();
    expect(toTradingViewSymbol("DX-Y.NYB", "NYB")).toBeNull();
    expect(toTradingViewSymbol("ABC", "XYZ")).toBeNull();
    expect(toTradingViewSymbol("ABC", "")).toBeNull();
  });
});

describe("tradingViewMarket", () => {
  it("maps the TradingView exchange prefix to the scanner market", () => {
    expect(tradingViewMarket("NASDAQ:MU")).toBe("america");
    expect(tradingViewMarket("NYSE:IBM")).toBe("america");
    expect(tradingViewMarket("AMEX:SPY")).toBe("america");
    expect(tradingViewMarket("IDX:BBCA")).toBe("indonesia");
    expect(tradingViewMarket("LSE:SHEL")).toBe("uk");
    expect(tradingViewMarket("TSE:7203")).toBe("japan");
    expect(tradingViewMarket("HKEX:700")).toBe("hongkong");
  });

  it("returns null for unknown or malformed symbols", () => {
    expect(tradingViewMarket("XETR:SAP")).toBeNull();
    expect(tradingViewMarket("MU")).toBeNull();
    expect(tradingViewMarket("")).toBeNull();
  });
});

describe("tradingViewLabel", () => {
  it("quotes TradingView's own thresholds", () => {
    expect(tradingViewLabel(0.56)).toBe("STRONG_BUY");
    expect(tradingViewLabel(0.51)).toBe("STRONG_BUY");
    expect(tradingViewLabel(0.5)).toBe("BUY");
    expect(tradingViewLabel(0.11)).toBe("BUY");
    expect(tradingViewLabel(0.1)).toBe("NEUTRAL");
    expect(tradingViewLabel(0)).toBe("NEUTRAL");
    expect(tradingViewLabel(-0.1)).toBe("NEUTRAL");
    expect(tradingViewLabel(-0.11)).toBe("SELL");
    expect(tradingViewLabel(-0.5)).toBe("SELL");
    expect(tradingViewLabel(-0.51)).toBe("STRONG_SELL");
  });

  it("is empty for null", () => {
    expect(tradingViewLabel(null)).toBe("");
  });
});

describe("isValidTicker / partitionTickerInput", () => {
  it("accepts the symbol shapes every supported venue uses", () => {
    for (const symbol of ["MU", "BRK-B", "BBCA.JK", "^VIX", "ES=F", "IDR=X", "DX-Y.NYB", "0700.HK", "7203.T"]) {
      expect(isValidTicker(symbol)).toBe(true);
    }
  });

  it("refuses punctuation, spaces, and anything past the 20-character API cap", () => {
    for (const symbol of ["HELLO!!", "MU$", "A B", "", "^", "ABCDEFGHIJKLMNOPQRSTUVWXY"]) {
      expect(isValidTicker(symbol)).toBe(false);
    }
  });

  it("refuses a bare quantity but keeps numeric tickers that carry a venue suffix", () => {
    for (const quantity of ["100", "7", "2026"]) {
      expect(isValidTicker(quantity)).toBe(false);
    }
    for (const symbol of ["0700.HK", "7203.T"]) {
      expect(isValidTicker(symbol)).toBe(true);
    }
    expect(partitionTickerInput("buy 100 shares")).toEqual({
      tickers: ["BUY", "SHARES"],
      rejected: ["100"],
    });
  });

  it("splits typed text into what is a ticker and what is not", () => {
    expect(partitionTickerInput("mu, hello!!, nvda")).toEqual({ tickers: ["MU", "NVDA"], rejected: ["HELLO!!"] });
  });

  it("reports each bad token once and keeps normalizeTickerInput free of them", () => {
    expect(partitionTickerInput("oops! oops! MU").rejected).toEqual(["OOPS!"]);
    expect(normalizeTickerInput("oops! MU")).toEqual(["MU"]);
  });

  it("caps the accepted list and tolerates a non-string", () => {
    const many = Array.from({ length: WATCHLIST_MAX + 5 }, (_, index) => `T${index}`).join(" ");
    expect(partitionTickerInput(many).tickers).toHaveLength(WATCHLIST_MAX);
    expect(partitionTickerInput(undefined as unknown as string)).toEqual({ tickers: [], rejected: [] });
  });
});

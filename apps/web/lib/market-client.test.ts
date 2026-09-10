import { ADVICE_MARKER, ADVICE_PATTERN, WATCHLIST_MAX } from "@agentforge/core/market";
import { describe, expect, it } from "vitest";
import {
  MARKET_STARTERS,
  applyRegeneratedSection,
  collectFailures,
  formatNumber,
  formatPercent,
  friendlyMarketError,
  humanRating,
  mergeTickersReporting,
  needsKey,
  KEY_HINT,
  NO_TICKER_HINT,
  OFFLINE_HINT,
  isGuardedSection,
  mergeTickers,
  parseTickers,
  percentVsSma200,
  type MarketWatchResult,
  type Quote,
  type Technical,
} from "./market-client";

/** Studio copy rule on top of the core guard: no imperative trade phrase in a preset. */
const IMPERATIVE_RULE = /\b(buy now|sell now|beli sekarang|jual sekarang)\b/i;

const REF = {
  source: "yahoo" as const,
  sourceUrl: "https://finance.yahoo.com/quote/MU",
  observedAt: "2026-09-09T12:00:00+00:00",
};

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "MU",
    name: "Micron",
    price: 100,
    changePercent: 1.5,
    previousClose: 98.5,
    preMarketPrice: null,
    preMarketChangePercent: null,
    postMarketPrice: null,
    postMarketChangePercent: null,
    volume: null,
    marketCap: null,
    marketState: "PRE",
    currency: "USD",
    exchange: "NMS",
    ref: REF,
    ...overrides,
  };
}

function technical(overrides: Partial<Technical> = {}): Technical {
  return {
    symbol: "MU",
    tradingview: null,
    rsi14: 55,
    sma50: 95,
    sma200: 80,
    ema200: null,
    macd: null,
    macdSignal: null,
    change1dPercent: null,
    change5dPercent: null,
    change1mPercent: null,
    high52w: null,
    low52w: null,
    ref: REF,
    ...overrides,
  };
}

describe("parseTickers", () => {
  it("uppercases, strips prefixes, splits on any separator, and dedupes", () => {
    const parsed = parseTickers("$MU, nvda  bbca.jk;WDC");
    expect(parsed).toHaveLength(4);
    expect(parsed).toEqual(["MU", "NVDA", "BBCA.JK", "WDC"]);
    expect(parseTickers("mu, MU, $mu")).toEqual(["MU"]);
  });

  it("caps the watchlist at WATCHLIST_MAX", () => {
    const many = Array.from({ length: WATCHLIST_MAX + 5 }, (_, index) => `T${index}`).join(", ");
    expect(parseTickers(many)).toHaveLength(WATCHLIST_MAX);
  });

  it("returns nothing for blank input", () => {
    expect(parseTickers("")).toEqual([]);
    expect(parseTickers("  , ; ")).toEqual([]);
  });
});

describe("mergeTickers", () => {
  it("keeps the current chips first and skips duplicates", () => {
    const current = ["MU", "NVDA"];
    const next = mergeTickers(current, "nvda, wdc");
    expect(next).toEqual(["MU", "NVDA", "WDC"]);
    expect(current).toEqual(["MU", "NVDA"]);
  });

  it("still honours the cap", () => {
    const current = Array.from({ length: WATCHLIST_MAX }, (_, index) => `T${index}`);
    expect(mergeTickers(current, "EXTRA")).toHaveLength(WATCHLIST_MAX);
  });
});

describe("MARKET_STARTERS", () => {
  it("has three presets with valid, capped watchlists", () => {
    expect(MARKET_STARTERS).toHaveLength(3);
    for (const starter of MARKET_STARTERS) {
      expect(starter.tickers.length).toBeGreaterThan(0);
      expect(starter.tickers.length).toBeLessThanOrEqual(WATCHLIST_MAX);
      expect(parseTickers(starter.tickers.join(","))).toEqual([...starter.tickers]);
    }
  });

  it("carries no imperative phrase and passes the core advice guard", () => {
    for (const starter of MARKET_STARTERS) {
      expect(starter.label).not.toMatch(IMPERATIVE_RULE);
      expect(starter.hint).not.toMatch(IMPERATIVE_RULE);
      expect(starter.label).not.toMatch(ADVICE_PATTERN);
      expect(starter.hint).not.toMatch(ADVICE_PATTERN);
    }
  });
});

describe("isGuardedSection", () => {
  it("detects the advice marker in a section body or heading", () => {
    expect(isGuardedSection({ heading: "A", body: `Revenue grew. ${ADVICE_MARKER}` })).toBe(true);
    expect(isGuardedSection({ heading: ADVICE_MARKER, body: "Revenue grew." })).toBe(true);
    expect(isGuardedSection({ heading: "A", body: "Revenue grew." })).toBe(false);
  });
});

describe("formatting", () => {
  it("formats numbers and percentages, blank for null", () => {
    expect(formatNumber(null)).toBe("");
    expect(formatNumber(1234.5)).toBe("1,234.50");
    expect(formatNumber(55.25, 1)).toBe("55.3");
    expect(formatPercent(null)).toBe("");
    expect(formatPercent(1.5)).toBe("+1.50%");
    expect(formatPercent(-0.25)).toBe("-0.25%");
  });

  it("computes the distance from SMA200 only when both sides exist", () => {
    expect(percentVsSma200(quote(), technical())).toBeCloseTo(25);
    expect(percentVsSma200(quote({ price: null }), technical())).toBeNull();
    expect(percentVsSma200(quote(), technical({ sma200: null }))).toBeNull();
    expect(percentVsSma200(null, null)).toBeNull();
  });
});

const BASE: MarketWatchResult = {
  briefing: {
    title: "Pre-market briefing",
    language: "id",
    generatedAt: "2026-09-09T12:00:00+00:00",
    sections: [
      { heading: "One", body: `first ${ADVICE_MARKER}` },
      { heading: "Two", body: "second" },
    ],
    packet: {
      tickers: [
        {
          symbol: {
            input: "MU",
            yahoo: "MU",
            tradingview: "NASDAQ:MU",
            name: "Micron",
            exchange: "NMS",
            currency: "USD",
          },
          quote: quote(),
          technical: technical(),
          history: null,
          chart: null,
          news: [],
          failures: ["news: rss timed out"],
        },
      ],
      macro: { quotes: [], failures: ["^VIX: quote unavailable"] },
      clock: { runAt: "2026-09-09T12:00:00+00:00", usSession: "pre", note: "" },
      positionContext: "",
    },
    sources: [],
    guardedSections: 1,
    disclaimer: "d",
  },
  artifactId: "art-1",
  markdown: "# Pre-market briefing",
  guard: { flagged: [{ section: 0, text: "12%" }], total: 1, adviceReplaced: 1 },
};

describe("collectFailures", () => {
  it("prefixes each failure with its ticker and lists macro last", () => {
    expect(collectFailures(BASE.briefing.packet)).toEqual([
      "MU: news: rss timed out",
      "Macro: ^VIX: quote unavailable",
    ]);
  });
});

describe("applyRegeneratedSection", () => {
  it("swaps the section, drops the artifact id, and recounts guarded sections without mutating", () => {
    const next = applyRegeneratedSection(BASE, 0, {
      section: { heading: "One", body: "rewritten" },
      guard: { flagged: [], total: 0, adviceReplaced: 0 },
    });
    expect(next).not.toBe(BASE);
    expect(next.briefing).not.toBe(BASE.briefing);
    expect(next.briefing.sections).not.toBe(BASE.briefing.sections);
    expect(BASE.briefing.sections[0]?.body).toBe(`first ${ADVICE_MARKER}`);
    expect(BASE.artifactId).toBe("art-1");
    expect(next.briefing.sections[0]?.body).toBe("rewritten");
    expect(next.briefing.sections[1]).toBe(BASE.briefing.sections[1]);
    expect(next.briefing.packet).toBe(BASE.briefing.packet);
    expect(next.artifactId).toBeNull();
    expect(next.briefing.guardedSections).toBe(0);
    expect(next.guard).toEqual({ flagged: [], total: 0, adviceReplaced: 0 });
  });

  it("keeps the count when the rewrite still carried advice", () => {
    const next = applyRegeneratedSection(BASE, 1, {
      section: { heading: "Two", body: `still ${ADVICE_MARKER}` },
      guard: { flagged: [{ section: 0, text: "9.5%" }], total: 1, adviceReplaced: 2 },
    });
    expect(next.briefing.guardedSections).toBe(2);
    expect(next.guard.flagged).toEqual([{ section: 1, text: "9.5%" }]);
    expect(next.guard.adviceReplaced).toBe(2);
  });
});

describe("friendlyMarketError / needsKey", () => {
  it("turns the gateway refusal into a sentence that says charts still work", () => {
    const message = "Market needs a live gateway. Paste a Toko Token API key in Settings, then try again.";
    expect(needsKey(message)).toBe(true);
    expect(friendlyMarketError(message)).toBe(KEY_HINT);
    expect(KEY_HINT).toMatch(/without a key/i);
  });

  it("explains an unresolvable watchlist and an unreachable network in plain words", () => {
    expect(friendlyMarketError("No ticker resolved: ZZZZ: unknown symbol")).toBe(NO_TICKER_HINT);
    expect(friendlyMarketError("Market data could not be fetched: MU: quote: timeout")).toBe(OFFLINE_HINT);
    expect(friendlyMarketError("fetch failed")).toBe(OFFLINE_HINT);
  });

  it("passes anything it does not recognise straight through and calls it no key", () => {
    expect(friendlyMarketError("Something else broke")).toBe("Something else broke");
    expect(needsKey("Something else broke")).toBe(false);
  });
});

describe("humanRating", () => {
  it("reads TradingView's shouting as words", () => {
    expect(humanRating("STRONG_BUY")).toBe("Strong buy");
    expect(humanRating("NEUTRAL")).toBe("Neutral");
    expect(humanRating("")).toBe("");
  });
});

describe("mergeTickersReporting", () => {
  it("adds what is a ticker and reports what is not", () => {
    expect(mergeTickersReporting(["MU"], "nvda, hello!!")).toEqual({
      tickers: ["MU", "NVDA"],
      rejected: ["HELLO!!"],
      overflow: false,
    });
  });

  it("keeps the existing chips when nothing typed was usable", () => {
    const result = mergeTickersReporting(["MU"], "!!!");
    expect(result.tickers).toEqual(["MU"]);
    expect(result.rejected).toEqual(["!!!"]);
  });

  it("never exceeds the watchlist cap", () => {
    const full = Array.from({ length: WATCHLIST_MAX }, (_, index) => `T${index}`);
    expect(mergeTickersReporting(full, "MU").tickers).toHaveLength(WATCHLIST_MAX);
  });
});

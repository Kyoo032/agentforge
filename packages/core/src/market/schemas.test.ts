import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as briefing from "../artifacts/market-briefing";
import { lintSchemaFields } from "./schema-lint";
import { DEFAULT_MARKET_SPECIALIST, MARKET_SPECIALISTS } from "./specialists";
import * as schemas from "./schemas";
import { FORBIDDEN_FIELD_NAMES, httpUrlSchema, isHttpUrl } from "./schemas";
import * as watch from "./watch-schemas";

function zodExports(module: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(
    Object.entries(module).filter((entry): entry is [string, z.ZodTypeAny] => entry[1] instanceof z.ZodType),
  );
}

describe("isHttpUrl / httpUrlSchema", () => {
  it("accepts absolute http(s) urls only", () => {
    expect(isHttpUrl("https://example.test/a")).toBe(true);
    expect(isHttpUrl("http://example.test/a")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("ftp://example.test/a")).toBe(false);
    expect(isHttpUrl("data:text/plain,hi")).toBe(false);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });

  it("is enforced by the schema and by every v2 ref/link field", () => {
    expect(httpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(httpUrlSchema.safeParse("https://example.test/a").success).toBe(true);
    const ref = { source: "yahoo", sourceUrl: "javascript:alert(1)", observedAt: "2026-09-09T10:00:00Z" };
    expect(watch.watchRefSchema.safeParse(ref).success).toBe(false);
    expect(watch.watchRefSchema.safeParse({ ...ref, sourceUrl: "https://example.test" }).success).toBe(true);
    const goodRef = { ...ref, sourceUrl: "https://example.test" };
    expect(watch.watchNewsItemSchema.safeParse({ title: "T", link: "ftp://x.test/a", ref: goodRef }).success).toBe(
      false,
    );
  });
});

describe("forbidden-field lint (C1) over the v2 schemas", () => {
  const exported = { ...zodExports(schemas), ...zodExports(watch), ...zodExports(briefing) };

  it("only httpUrlSchema remains in schemas.ts", () => {
    expect(Object.keys(zodExports(schemas))).toEqual(["httpUrlSchema"]);
  });

  it("finds the v2 zod schemas", () => {
    expect(Object.keys(exported)).toEqual(
      expect.arrayContaining([
        "marketWatchPacketSchema",
        "tickerPacketSchema",
        "quoteSchema",
        "technicalSchema",
        "marketWatchRequestSchema",
        "marketBriefingSchema",
      ]),
    );
  });

  it("finds no forbidden field on any exported market schema", () => {
    expect(lintSchemaFields(exported)).toEqual([]);
  });

  it("flags a schema that carries a directive field", () => {
    expect(lintSchemaFields({ bad: z.object({ action: z.string() }) })).toEqual(["bad.action"]);
  });

  it("flags case-insensitively and through wrappers", () => {
    const wrapped = z
      .object({
        rows: z.array(z.object({ TargetPrice: z.number().nullable().default(null) })).default([]),
        inner: z.object({ Verdict: z.string() }).nullable(),
      })
      .refine(() => true);
    expect(lintSchemaFields({ wrapped })).toEqual(["wrapped.rows[].TargetPrice", "wrapped.inner.Verdict"]);
  });

  it("keeps the forbidden list lower-case comparable", () => {
    for (const name of FORBIDDEN_FIELD_NAMES) {
      expect(lintSchemaFields({ probe: z.object({ [name.toUpperCase()]: z.string() }) })).toHaveLength(1);
    }
  });
});

describe("v2 array bounds at the API boundary", () => {
  const ref = { source: "yahoo", sourceUrl: "https://example.test", observedAt: "2026-09-09T10:00:00Z" };
  const bar = { date: "2026-09-09", open: 1, high: 1, low: 1, close: 1, volume: 0 };

  it("caps history bars, news per ticker, and the watchlist", () => {
    const bars = Array.from({ length: watch.HISTORY_BARS_MAX + 1 }, () => bar);
    expect(watch.priceHistorySchema.safeParse({ symbol: "MU", bars, ref }).success).toBe(false);
    expect(watch.priceHistorySchema.safeParse({ symbol: "MU", bars: bars.slice(1), ref }).success).toBe(true);
    const request = { prompt: "p", tickers: Array.from({ length: watch.WATCHLIST_MAX + 1 }, () => "MU") };
    expect(watch.marketWatchRequestSchema.safeParse(request).success).toBe(false);
    expect(watch.marketWatchRequestSchema.safeParse({ ...request, tickers: ["MU"] }).success).toBe(true);
  });
});

describe("marketWatchRequestSchema specialist", () => {
  const base = { prompt: "p", tickers: ["MU"] };

  it("defaults to the saham agent", () => {
    const parsed = watch.marketWatchRequestSchema.parse(base);
    expect(parsed.specialist).toBe(DEFAULT_MARKET_SPECIALIST);
    expect(parsed.specialist).toBe("saham");
  });

  it("accepts every named agent and refuses anything else", () => {
    for (const id of MARKET_SPECIALISTS) {
      expect(watch.marketWatchRequestSchema.parse({ ...base, specialist: id }).specialist).toBe(id);
    }
    for (const bad of ["", "stocks", "SAHAM", 1, null]) {
      expect(watch.marketWatchRequestSchema.safeParse({ ...base, specialist: bad }).success).toBe(false);
    }
  });
});

describe("tickerPacketSchema swings", () => {
  it("is optional and capped, and each row is a dated pivot", () => {
    const symbol = { input: "MU", yahoo: "MU" };
    expect(watch.tickerPacketSchema.parse({ symbol }).swings).toBeUndefined();
    const swing = { date: "2026-08-01", price: 910.5, kind: "high" };
    expect(watch.tickerPacketSchema.parse({ symbol, swings: [swing] }).swings).toEqual([swing]);
    expect(watch.swingPointSchema.safeParse({ ...swing, kind: "sideways" }).success).toBe(false);
    expect(watch.swingPointSchema.safeParse({ ...swing, date: "01-08-2026" }).success).toBe(false);
    const tooMany = Array.from({ length: watch.SWING_POINTS_MAX + 1 }, () => swing);
    expect(watch.tickerPacketSchema.safeParse({ symbol, swings: tooMany }).success).toBe(false);
  });
});

describe("harness packet sections (C1 clean, optional, capped)", () => {
  const symbol = { input: "BTC-USD", yahoo: "BTC-USD" };
  const observedAt = "2026-09-09T10:00:00Z";

  it("keeps every new section off the packet until the host computes it", () => {
    const packet = watch.marketWatchPacketSchema.parse({
      tickers: [],
      macro: { quotes: [], failures: [] },
      clock: { runAt: observedAt, usSession: "pre" },
    });
    expect(packet.cryptoGlobal).toBeUndefined();
    expect(packet.metals).toBeUndefined();
    expect(packet.signals).toBeUndefined();
    expect(packet.rotation).toBeUndefined();
    expect(packet.sessions).toBeUndefined();
    expect(watch.tickerPacketSchema.parse({ symbol }).crypto).toBeUndefined();
  });

  it("carries a per-ticker crypto row", () => {
    const crypto = {
      marketCapUsd: 1.2e12,
      volume24hUsd: 3.4e10,
      change7dPct: -4.2,
      dominancePct: 54.1,
      fundingRatePct: 0.011,
      source: "web",
      observedAt,
    };
    expect(watch.tickerPacketSchema.parse({ symbol, crypto }).crypto).toEqual(crypto);
    // every figure is optional; only the attribution is required
    expect(watch.tickerCryptoSchema.safeParse({ source: "web", observedAt }).success).toBe(true);
    expect(watch.tickerCryptoSchema.safeParse({ source: "nasdaq", observedAt }).success).toBe(false);
  });

  it("carries the global crypto and metals context rows", () => {
    const cryptoGlobal = { totalMarketCapUsd: 3.9e12, btcDominancePct: 54.1, ethDominancePct: 13.2, source: "web", observedAt };
    expect(watch.cryptoGlobalSchema.parse(cryptoGlobal)).toEqual(cryptoGlobal);
    const metals = { dxy: 97.4, us10y: 4.12, goldSilverRatio: 82.5, goldFuturesVsSpotPct: 0.34, source: "computed", observedAt };
    expect(watch.metalsContextSchema.parse(metals)).toEqual(metals);
    expect(watch.metalsContextSchema.safeParse({ source: "computed", observedAt }).success).toBe(true);
    // the GLD proxy premium travels under its own name, alongside or without a real spot basis
    const gldOnly = { goldFuturesVsGldPct: 1.03, source: "computed", observedAt };
    expect(watch.metalsContextSchema.parse(gldOnly)).toEqual(gldOnly);
    expect(watch.metalsContextSchema.parse({ ...metals, goldFuturesVsGldPct: 1.03 }).goldFuturesVsGldPct).toBe(1.03);
  });

  it("names the code-computed signal kinds and refuses anything else", () => {
    const row = { ticker: "MU", kind: "rsi-oversold", value: 28.4, note: "RSI14 in the oversold band" };
    expect(watch.marketSignalSchema.parse(row)).toEqual(row);
    expect(watch.marketSignalSchema.safeParse({ ...row, kind: "moon-cross" }).success).toBe(false);
    expect(watch.MARKET_SIGNAL_KINDS).toContain("macd-bull-cross");
    expect(watch.MARKET_SIGNAL_KINDS).toContain("unusual-move");
    const tooMany = Array.from({ length: watch.SIGNALS_MAX + 1 }, () => row);
    const base = { tickers: [], macro: { quotes: [], failures: [] }, clock: { runAt: observedAt, usSession: "pre" } };
    expect(watch.marketWatchPacketSchema.safeParse({ ...base, signals: tooMany }).success).toBe(false);
    expect(watch.marketWatchPacketSchema.safeParse({ ...base, signals: tooMany.slice(1) }).success).toBe(true);
  });

  it("carries the rotation ranking with nullable windows", () => {
    const row = { ticker: "XLK", ret1dPct: 0.4, ret5dPct: 1.9, ret1mPct: 5.2, ret6mPct: null, rank1m: 1 };
    expect(watch.rotationRowSchema.parse(row)).toEqual(row);
    expect(watch.rotationRowSchema.safeParse({ ...row, rank1m: 0 }).success).toBe(false);
  });

  it("carries one session row per exchange with a nullable next change", () => {
    const row = { exchange: "IDX", state: "open", nextChangeAt: "2026-09-09T05:00:00.000Z" };
    expect(watch.marketSessionSchema.parse(row)).toEqual(row);
    expect(watch.marketSessionSchema.parse({ exchange: "CRYPTO", state: "always", nextChangeAt: null }).nextChangeAt).toBeNull();
    expect(watch.marketSessionSchema.safeParse({ ...row, exchange: "IDXX" }).success).toBe(false);
    expect(watch.marketSessionSchema.safeParse({ ...row, state: "lunch" }).success).toBe(false);
  });

  it("carries the reported company figures, every one of them optional", () => {
    const parsed = watch.tickerFundamentalsSchema.parse({ source: "yahoo", observedAt });
    expect(parsed).toEqual({ source: "yahoo", observedAt });
    const full = { sector: "Technology", trailingPe: 24.53, roePct: 28.44, source: "yahoo", observedAt } as const;
    expect(watch.tickerFundamentalsSchema.parse(full)).toEqual(full);
    expect(watch.tickerFundamentalsSchema.safeParse({ ...full, trailingPe: "cheap" }).success).toBe(false);
  });

  it("counts insider filings over the one window it supports", () => {
    const row = { buys: 3, sells: 7, netShares: -128_400, source: "yahoo", observedAt };
    expect(watch.tickerInsidersSchema.parse(row).window).toBe(watch.INSIDER_WINDOW);
    expect(watch.INSIDER_WINDOW_DAYS).toBe(90);
    expect(watch.tickerInsidersSchema.safeParse({ ...row, window: "30d" }).success).toBe(false);
    expect(watch.tickerInsidersSchema.safeParse({ ...row, buys: -1 }).success).toBe(false);
    expect(watch.tickerInsidersSchema.safeParse({ ...row, sells: 1.5 }).success).toBe(false);
  });

  it("keeps the crowd read to counts and a few short, sourced samples", () => {
    const sample = { source: "stocktwits", title: "heavy volume into the close" };
    const row = { stocktwits: { total: 184, bullish: 121, bearish: 39, sampled: 3 }, samples: [sample], observedAt };
    expect(watch.tickerSentimentSchema.parse(row).samples).toEqual([sample]);
    expect(watch.tickerSentimentSchema.parse({ observedAt }).samples).toEqual([]);
    expect(watch.tickerSentimentSchema.safeParse({ ...row, samples: [{ ...sample, source: "x" }] }).success).toBe(
      false,
    );
    const long = { ...sample, title: "x".repeat(watch.SENTIMENT_SAMPLE_CHARS_MAX + 1) };
    expect(watch.tickerSentimentSchema.safeParse({ ...row, samples: [long] }).success).toBe(false);
    const many = Array.from({ length: watch.SENTIMENT_SAMPLES_MAX + 1 }, () => sample);
    expect(watch.tickerSentimentSchema.safeParse({ ...row, samples: many }).success).toBe(false);
    expect(watch.tickerSentimentSchema.safeParse({ ...row, samples: many.slice(1) }).success).toBe(true);
  });

  it("caps the macro headline list and tags every row with its query", () => {
    const item = { title: "Fed holds", publisher: "Reuters", query: "Federal Reserve interest rate decision" };
    expect(watch.globalNewsItemSchema.parse(item)).toEqual(item);
    expect(watch.globalNewsItemSchema.safeParse({ ...item, query: "" }).success).toBe(false);
    const base = { tickers: [], macro: { quotes: [], failures: [] }, clock: { runAt: observedAt, usSession: "pre" } };
    const tooMany = Array.from({ length: watch.GLOBAL_NEWS_MAX + 1 }, () => item);
    expect(watch.marketWatchPacketSchema.safeParse({ ...base, globalNews: tooMany }).success).toBe(false);
    expect(watch.marketWatchPacketSchema.safeParse({ ...base, globalNews: tooMany.slice(1) }).success).toBe(true);
  });

  it("defaults the request and the briefing to quick depth", () => {
    const request = watch.marketWatchRequestSchema.parse({ prompt: "brief me", tickers: ["MU"] });
    expect(request.depth).toBe("quick");
    expect(watch.marketWatchRequestSchema.safeParse({ prompt: "p", tickers: ["MU"], depth: "deep" }).success).toBe(
      false,
    );
    expect(watch.marketWatchRequestSchema.parse({ prompt: "p", tickers: ["MU"], depth: "team" }).depth).toBe("team");
  });

  it("finds no forbidden field on the new sections", () => {
    expect(
      lintSchemaFields({
        tickerFundamentalsSchema: watch.tickerFundamentalsSchema,
        tickerInsidersSchema: watch.tickerInsidersSchema,
        tickerSentimentSchema: watch.tickerSentimentSchema,
        globalNewsItemSchema: watch.globalNewsItemSchema,
        tickerCryptoSchema: watch.tickerCryptoSchema,
        cryptoGlobalSchema: watch.cryptoGlobalSchema,
        metalsContextSchema: watch.metalsContextSchema,
        marketSignalSchema: watch.marketSignalSchema,
        rotationRowSchema: watch.rotationRowSchema,
        marketSessionSchema: watch.marketSessionSchema,
        marketWatchPacketSchema: watch.marketWatchPacketSchema,
      }),
    ).toEqual([]);
  });
});

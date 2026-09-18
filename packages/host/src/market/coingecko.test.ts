import { describe, expect, it } from "vitest";
import fundingFixture from "./__fixtures__/binance-funding.json";
import globalFixture from "./__fixtures__/coingecko-global.json";
import marketsFixture from "./__fixtures__/coingecko-markets.json";
import {
  CRYPTO_BODY_MAX_BYTES,
  coingeckoId,
  cryptoBase,
  cryptoMarketsUrl,
  fetchCryptoGlobal,
  fetchCryptoMarkets,
  fetchFundingRate,
  fundingRateUrl,
  parseCryptoMarkets,
} from "./coingecko";

const NOW = new Date("2026-09-17T08:00:00.000Z");
const now = () => NOW;

type Call = { url: string };

/** Every response is served from a fixture; no test in this file opens a socket. */
function stub(
  body: unknown,
  opts: { status?: number; text?: string; headers?: Record<string, string> } = {},
  calls: Call[] = [],
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url });
    const payload = opts.text ?? JSON.stringify(body);
    return new Response(payload, { status: opts.status ?? 200, headers: opts.headers });
  }) as typeof fetch;
}

describe("coingeckoId", () => {
  it("maps the known -USD bases and skips everything else", () => {
    expect(coingeckoId("BTC-USD")).toBe("bitcoin");
    expect(coingeckoId("eth-usd")).toBe("ethereum");
    expect(coingeckoId("SOL-USD")).toBe("solana");
    expect(coingeckoId("BNB-USD")).toBe("binancecoin");
    expect(coingeckoId("XRP-USD")).toBe("ripple");
    expect(coingeckoId("ADA-USD")).toBe("cardano");
    expect(coingeckoId("DOGE-USD")).toBe("dogecoin");
    expect(coingeckoId("AVAX-USD")).toBe("avalanche-2");
    expect(coingeckoId("DOT-USD")).toBe("polkadot");
    expect(coingeckoId("LINK-USD")).toBe("chainlink");
    expect(coingeckoId("MATIC-USD")).toBe("polygon-ecosystem-token");
    expect(coingeckoId("POL-USD")).toBe("polygon-ecosystem-token");
    expect(coingeckoId("TON-USD")).toBe("the-open-network");

    expect(coingeckoId("WHATEVER-USD")).toBeNull();
    expect(coingeckoId("MU")).toBeNull();
    expect(coingeckoId("BTC-EUR")).toBeNull();
    expect(cryptoBase("MU")).toBeNull();
  });
});

describe("fetchCryptoGlobal", () => {
  it("reads the total market cap and BTC/ETH dominance from the fixture", async () => {
    const calls: Call[] = [];
    const result = await fetchCryptoGlobal({ fetchImpl: stub(globalFixture, {}, calls), now });

    expect(result.failure).toBeNull();
    expect(result.global).toEqual({
      totalMarketCapUsd: 3421987654321.2,
      btcDominancePct: 57.42,
      ethDominancePct: 12.08,
      source: "coingecko",
      observedAt: NOW.toISOString(),
    });
    expect(calls).toEqual([{ url: "https://api.coingecko.com/api/v3/global" }]);
  });

  it("reports HTTP, non-JSON, oversize and schema drift as a failure with no payload", async () => {
    const http = await fetchCryptoGlobal({ fetchImpl: stub(null, { status: 429 }), now });
    expect(http.global).toBeUndefined();
    expect(http.failure).toBe("crypto-global: HTTP 429");

    const notJson = await fetchCryptoGlobal({ fetchImpl: stub(null, { text: "<html>rate limited</html>" }), now });
    expect(notJson.failure).toBe("crypto-global: response was not JSON");

    const oversize = await fetchCryptoGlobal({
      fetchImpl: stub(null, { text: "{}", headers: { "content-length": String(CRYPTO_BODY_MAX_BYTES + 1) } }),
      now,
    });
    expect(oversize.global).toBeUndefined();
    expect(oversize.failure).toContain("byte cap");

    const drift = await fetchCryptoGlobal({ fetchImpl: stub({ data: { total_market_cap: {} } }), now });
    expect(drift.global).toBeUndefined();
    expect(drift.failure).toContain("crypto-global:");
  });
});

describe("fetchCryptoMarkets", () => {
  it("batches the mapped ids, maps the rows back to tickers and keeps only numbers", async () => {
    const calls: Call[] = [];
    const { markets, failures } = await fetchCryptoMarkets(["BTC-USD", "ETH-USD", "SOL-USD"], {
      fetchImpl: stub(marketsFixture, {}, calls),
      now,
    });

    expect(failures).toEqual([]);
    expect(calls[0]?.url).toBe(cryptoMarketsUrl(["bitcoin", "ethereum", "solana"]));
    expect(calls[0]?.url).toContain("price_change_percentage=7d");
    expect(markets.get("BTC-USD")).toEqual({
      ticker: "BTC-USD",
      marketCapUsd: 2067890123456,
      volume24hUsd: 48213456789,
      change7dPct: 3.87,
      source: "coingecko",
      observedAt: NOW.toISOString(),
    });
    expect(markets.get("ETH-USD")?.change7dPct).toBe(-2.14);
    // A null 7d change stays null rather than becoming 0.
    expect(markets.get("SOL-USD")?.change7dPct).toBeNull();
  });

  it("skips tickers it has no id for and never calls out when none are crypto", async () => {
    const calls: Call[] = [];
    const only = await fetchCryptoMarkets(["MU", "BBCA.JK", "BTC-USD", "WHATEVER-USD"], {
      fetchImpl: stub(marketsFixture, {}, calls),
      now,
    });
    expect(calls[0]?.url).toBe(cryptoMarketsUrl(["bitcoin"]));
    expect([...only.markets.keys()]).toEqual(["BTC-USD"]);

    const none = await fetchCryptoMarkets(["MU", "BBCA.JK"], { fetchImpl: stub(marketsFixture, {}, calls), now });
    expect(none.markets.size).toBe(0);
    expect(none.failures).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("notes an id the batch omitted and turns a failed batch into one failure string", async () => {
    const partial = await fetchCryptoMarkets(["BTC-USD", "DOGE-USD"], { fetchImpl: stub(marketsFixture), now });
    expect(partial.markets.has("BTC-USD")).toBe(true);
    expect(partial.failures).toEqual(["crypto: DOGE-USD was not in the CoinGecko batch"]);

    const down = await fetchCryptoMarkets(["BTC-USD"], { fetchImpl: stub(null, { status: 503 }), now });
    expect(down.markets.size).toBe(0);
    expect(down.failures).toEqual(["crypto: HTTP 503"]);

    const shape = await fetchCryptoMarkets(["BTC-USD"], { fetchImpl: stub({ error: "nope" }), now });
    expect(shape.failures).toEqual(["crypto: response was not a list of coins"]);
  });

  it("ignores rows for ids that were not asked for", () => {
    const rows = parseCryptoMarkets(marketsFixture, new Map([["ethereum", "ETH-USD"]]), NOW.toISOString());
    expect([...rows.keys()]).toEqual(["ETH-USD"]);
  });
});

describe("fetchFundingRate", () => {
  it("returns lastFundingRate as a percentage from the USDT perp", async () => {
    const calls: Call[] = [];
    const funding = await fetchFundingRate("BTC-USD", { fetchImpl: stub(fundingFixture, {}, calls), now });

    expect(calls).toEqual([{ url: fundingRateUrl("BTC") }]);
    expect(calls[0]?.url).toBe("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT");
    expect(funding).toEqual({
      ticker: "BTC-USD",
      fundingRatePct: 0.0125,
      source: "binance",
      observedAt: NOW.toISOString(),
    });
  });

  it("is undefined for every error and never throws out", async () => {
    const blocked = () => Promise.reject(new Error("ECONNRESET"));
    await expect(
      fetchFundingRate("BTC-USD", { fetchImpl: blocked as unknown as typeof fetch, now }),
    ).resolves.toBeUndefined();
    await expect(fetchFundingRate("BTC-USD", { fetchImpl: stub(null, { status: 451 }), now })).resolves.toBeUndefined();
    await expect(fetchFundingRate("BTC-USD", { fetchImpl: stub({}), now })).resolves.toBeUndefined();
    await expect(
      fetchFundingRate("BTC-USD", { fetchImpl: stub({ lastFundingRate: "not-a-number" }), now }),
    ).resolves.toBeUndefined();
    // Not a crypto ticker: no call at all.
    const calls: Call[] = [];
    await expect(fetchFundingRate("MU", { fetchImpl: stub(fundingFixture, {}, calls), now })).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });
});

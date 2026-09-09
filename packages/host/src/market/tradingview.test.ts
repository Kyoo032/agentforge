import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/tradingview-scan.json";
import { AdapterSchemaError } from "./errors";
import {
  TRADINGVIEW_COLUMNS,
  TRADINGVIEW_USER_AGENT,
  fetchTradingViewRatings,
  parseScanResponse,
  scanBody,
  scanUrl,
  tradingViewTechnicalsUrl,
} from "./tradingview";

const NOW = new Date("2026-09-09T03:00:00.000Z");
const now = () => NOW;
const OBSERVED = NOW.toISOString();

type Recorded = { url: string; init: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(
  handler: (
    market: string,
    body: { symbols: { tickers: string[] }; columns: string[] },
  ) => Response | Promise<Response>,
): typeof fetch & { calls: Recorded[] } {
  const calls: Recorded[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    const market = new URL(url).pathname.split("/")[1] ?? "";
    return handler(market, JSON.parse(String(init?.body)));
  }) as typeof fetch & { calls: Recorded[] };
  impl.calls = calls;
  return impl;
}

describe("tradingViewTechnicalsUrl", () => {
  it("turns EXCHANGE:SYMBOL into the public technicals page", () => {
    expect(tradingViewTechnicalsUrl("NASDAQ:MU")).toBe("https://www.tradingview.com/symbols/NASDAQ-MU/technicals/");
    expect(tradingViewTechnicalsUrl("IDX:BBCA")).toBe("https://www.tradingview.com/symbols/IDX-BBCA/technicals/");
  });
});

describe("scanBody", () => {
  it("sends the tickers and the fixed column list", () => {
    expect(JSON.parse(scanBody(["NASDAQ:MU"]))).toEqual({
      symbols: { tickers: ["NASDAQ:MU"], query: { types: [] } },
      columns: [...TRADINGVIEW_COLUMNS],
    });
    expect(scanUrl("america")).toBe("https://scanner.tradingview.com/america/scan");
  });
});

describe("parseScanResponse", () => {
  it("reads the rating scores, label, and indicators by column index", () => {
    const rows = parseScanResponse("america", fixture.america, ["NASDAQ:MU", "NASDAQ:NVDA"], OBSERVED);
    expect([...rows.keys()]).toEqual(["NASDAQ:MU", "NASDAQ:NVDA"]);
    const mu = rows.get("NASDAQ:MU");
    expect(mu).toMatchObject({
      symbol: "NASDAQ:MU",
      summary: 0.5575,
      movingAverages: 0.933,
      oscillators: 0.18,
      rsi: 57.66,
      close: 1000.26,
      changePercent: -1.6,
      volume: 26603800,
      ema200: 671.7,
      sma50: 902.4,
      sma200: 618.9,
      macd: 21.4,
      macdSignal: 18.2,
      high52w: 1042.5,
      low52w: 402.1,
      ref: { source: "tradingview", sourceUrl: tradingViewTechnicalsUrl("NASDAQ:MU"), observedAt: OBSERVED },
    });
    expect(mu?.label).not.toBe("");
    expect(rows.get("NASDAQ:NVDA")?.oscillators).toBe(-0.0429);
  });

  it("ignores rows that were not asked for and clamps scores to [-1, 1]", () => {
    const payload = {
      data: [
        { s: "NASDAQ:MU", d: [1.7, -3, null, 50, 1, 0, 0, 1, 1, 1, 0, 0, 2, 0.5] },
        { s: "NASDAQ:OTHER", d: new Array(TRADINGVIEW_COLUMNS.length).fill(0) },
      ],
    };
    const rows = parseScanResponse("america", payload, ["NASDAQ:MU"], OBSERVED);
    expect([...rows.keys()]).toEqual(["NASDAQ:MU"]);
    expect(rows.get("NASDAQ:MU")).toMatchObject({ summary: 1, movingAverages: -1, oscillators: null });
  });

  it("throws AdapterSchemaError on a missing data array, a row without s, or a short d vector", () => {
    expect(() => parseScanResponse("america", { totalCount: 0 }, ["NASDAQ:MU"], OBSERVED)).toThrow(AdapterSchemaError);
    expect(() => parseScanResponse("america", { data: [{ d: [] }] }, ["NASDAQ:MU"], OBSERVED)).toThrow("data[0].s");
    expect(() =>
      parseScanResponse("america", { data: [{ s: "NASDAQ:MU", d: [0.5, 0.9] }] }, ["NASDAQ:MU"], OBSERVED),
    ).toThrow(`data[0].d[${TRADINGVIEW_COLUMNS.length}]`);
  });
});

describe("fetchTradingViewRatings", () => {
  it("posts one scan per market with the browser headers and merges the rows", async () => {
    const fetchImpl = fakeFetch((market) => jsonResponse(fixture[market as "america" | "indonesia"]));
    const result = await fetchTradingViewRatings(["NASDAQ:MU", "IDX:BBCA", "NASDAQ:NVDA", "NASDAQ:MU"], {
      fetchImpl,
      now,
    });
    expect(fetchImpl.calls.map((call) => call.url).sort()).toEqual([
      "https://scanner.tradingview.com/america/scan",
      "https://scanner.tradingview.com/indonesia/scan",
    ]);
    const america = fetchImpl.calls.find((call) => call.url.includes("/america/"));
    expect(america?.init.method).toBe("POST");
    expect(america?.init.headers).toMatchObject({
      "Content-Type": "application/json",
      "User-Agent": TRADINGVIEW_USER_AGENT,
    });
    expect(JSON.parse(String(america?.init.body)).symbols.tickers).toEqual(["NASDAQ:MU", "NASDAQ:NVDA"]);
    expect(america?.init.signal).toBeInstanceOf(AbortSignal);
    expect([...result.ratings.keys()].sort()).toEqual(["IDX:BBCA", "NASDAQ:MU", "NASDAQ:NVDA"]);
    expect(result.ratings.get("IDX:BBCA")?.summary).toBe(-0.1212);
    expect(result.failures).toEqual([]);
  });

  it("keeps the other market when one fails, and reports symbols the scan omitted", async () => {
    const fetchImpl = fakeFetch((market) =>
      market === "america" ? jsonResponse({ error: "rate limited" }, 429) : jsonResponse(fixture.indonesia),
    );
    const result = await fetchTradingViewRatings(["NASDAQ:MU", "IDX:BBCA", "IDX:BBRI"], { fetchImpl, now });
    expect([...result.ratings.keys()]).toEqual(["IDX:BBCA"]);
    expect(result.failures).toEqual([
      "america: TradingView returned HTTP 429",
      "IDX:BBRI: not in the TradingView scan",
    ]);
  });

  it("reports schema drift as a failure for that market", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ rows: [] }));
    const result = await fetchTradingViewRatings(["NASDAQ:MU"], { fetchImpl, now });
    expect(result.ratings.size).toBe(0);
    expect(result.failures).toEqual([
      "america: tradingview.scan returned an unexpected shape for america: missing data",
    ]);
  });

  it("skips symbols without a market mapping without touching the network", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(fixture.america));
    const result = await fetchTradingViewRatings(["MOON:XYZ"], { fetchImpl, now });
    expect(fetchImpl.calls).toEqual([]);
    expect(result.failures).toEqual(["MOON:XYZ: no TradingView market for this exchange"]);
  });
});

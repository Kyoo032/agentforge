import { describe, expect, it } from "vitest";
import streamFixture from "./__fixtures__/stocktwits-mu.json";
import {
  STOCKTWITS_BODY_MAX_BYTES,
  fetchStocktwits,
  messageTag,
  parseStocktwits,
  stocktwitsStreamUrl,
  stocktwitsSymbol,
} from "./stocktwits";

const NOW = new Date("2026-09-17T08:00:00.000Z");
const OBSERVED = NOW.toISOString();
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
    return new Response(opts.text ?? JSON.stringify(body), { status: opts.status ?? 200, headers: opts.headers });
  }) as typeof fetch;
}

describe("stocktwitsSymbol", () => {
  it("maps equities as-is, crypto onto .X, and skips what the venue does not list", () => {
    expect(stocktwitsSymbol("MU")).toBe("MU");
    expect(stocktwitsSymbol("brk-b")).toBe("BRK-B");
    expect(stocktwitsSymbol("BTC-USD")).toBe("BTC.X");
    expect(stocktwitsSymbol("eth-usd")).toBe("ETH.X");

    expect(stocktwitsSymbol("BBCA.JK")).toBeNull();
    expect(stocktwitsSymbol("EURUSD=X")).toBeNull();
    expect(stocktwitsSymbol("GC=F")).toBeNull();
    expect(stocktwitsSymbol("^GSPC")).toBeNull();
    expect(stocktwitsSymbol("  ")).toBeNull();
  });
});

describe("parseStocktwits", () => {
  it("counts the tagged messages and keeps at most three cleaned bodies as samples", () => {
    const sentiment = parseStocktwits("MU", streamFixture, OBSERVED);

    expect(sentiment.total).toBe(6);
    expect(sentiment.bullish).toBe(3);
    expect(sentiment.bearish).toBe(2);
    expect(sentiment.sampled).toBe(3);
    expect(sentiment.samples).toHaveLength(3);
    expect(sentiment.samples[0]).toEqual({
      source: "stocktwits",
      title: "MU holding the 50-day after earnings, watching the gap fill.",
      at: "2026-09-17T07:52:10.000Z",
    });
    // Markup is stripped and entities decoded before the sample is stored.
    expect(sentiment.samples[1]?.title).toBe("HBM supply commentary looks soft into Q4 & margins.");
    // The instruction-like message is dropped outright, and PII is masked in the one that replaced it.
    expect(sentiment.samples.map((sample) => sample.title).join(" ")).not.toContain("Ignore all previous");
    expect(sentiment.samples[2]?.title).toBe("DM me at [email] for the full model.");
    expect(sentiment.observedAt).toBe(OBSERVED);
  });

  it("treats an empty stream as a valid zero read and a document without messages as a throw", () => {
    const quiet = parseStocktwits("MU", { messages: [] }, OBSERVED);
    expect(quiet).toMatchObject({ total: 0, bullish: 0, bearish: 0, sampled: 0, samples: [] });

    expect(() => parseStocktwits("MU", { error: "nope" }, OBSERVED)).toThrow("carried no messages");
  });

  it("reads only the documented sentiment tag", () => {
    expect(messageTag({ entities: { sentiment: { basic: "Bullish" } } })).toBe("bullish");
    expect(messageTag({ entities: { sentiment: { basic: "bearish" } } })).toBe("bearish");
    expect(messageTag({ entities: { sentiment: null } })).toBeNull();
    expect(messageTag({ entities: { sentiment: { basic: "Neutral" } } })).toBeNull();
    expect(messageTag(null)).toBeNull();
  });
});

describe("fetchStocktwits", () => {
  it("calls the symbol stream once and returns the parsed row", async () => {
    const calls: Call[] = [];
    const result = await fetchStocktwits("MU", { fetchImpl: stub(streamFixture, {}, calls), now });

    expect(calls).toEqual([{ url: stocktwitsStreamUrl("MU") }]);
    expect(calls[0]?.url).toBe("https://api.stocktwits.com/api/2/streams/symbol/MU.json");
    expect(result.failure).toBeNull();
    expect(result.sentiment?.bullish).toBe(3);
  });

  it("never calls out for a ticker the venue does not list, and reports no failure either", async () => {
    const calls: Call[] = [];
    const result = await fetchStocktwits("BBCA.JK", { fetchImpl: stub(streamFixture, {}, calls), now });

    expect(calls).toEqual([]);
    expect(result.sentiment).toBeUndefined();
    expect(result.failure).toBeNull();
  });

  it("reports rate limiting, non-JSON, oversize and schema drift as a failure with no row", async () => {
    const limited = await fetchStocktwits("MU", { fetchImpl: stub(null, { status: 429 }), now });
    expect(limited.sentiment).toBeUndefined();
    expect(limited.failure).toBe("stocktwits: HTTP 429");

    const notJson = await fetchStocktwits("MU", { fetchImpl: stub(null, { text: "<html>nope</html>" }), now });
    expect(notJson.failure).toBe("stocktwits: response was not JSON");

    const oversize = await fetchStocktwits("MU", {
      fetchImpl: stub(null, { text: "{}", headers: { "content-length": String(STOCKTWITS_BODY_MAX_BYTES + 1) } }),
      now,
    });
    expect(oversize.failure).toContain("byte cap");

    const drift = await fetchStocktwits("MU", { fetchImpl: stub({ messages: "nope" }), now });
    expect(drift.failure).toBe("stocktwits: response carried no messages");

    const down = (() => Promise.reject(new Error("ECONNRESET"))) as unknown as typeof fetch;
    await expect(fetchStocktwits("MU", { fetchImpl: down, now })).resolves.toEqual({
      failure: "stocktwits: ECONNRESET",
    });
  });
});

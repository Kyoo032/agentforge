import { describe, expect, it } from "vitest";
import macroFixture from "./__fixtures__/yahoo-search-macro.json";
import { GLOBAL_NEWS_ITEMS_MAX, fetchGlobalNews, parseGlobalNews } from "./global-news";
import type { YahooClient } from "./yahoo";

const NOW = new Date("2026-09-17T08:00:00.000Z");
const OBSERVED = NOW.toISOString();
const now = () => NOW;

const QUERIES = ["federal reserve rate decision", "rupiah", "oil prices"] as const;

type Call = { query: string; count: number };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Every response comes from the fixture; no test in this file opens a socket. */
function client(calls: Call[] = [], failing: readonly string[] = []): YahooClient {
  const byQuery = clone(macroFixture) as unknown as Record<string, { news: unknown[] } | undefined>;
  return {
    async quote() {
      throw new Error("not used");
    },
    async chart() {
      throw new Error("not used");
    },
    async quoteSummary() {
      throw new Error("not used");
    },
    async search(query, newsCount) {
      calls.push({ query, count: newsCount });
      if (failing.includes(query)) {
        throw new Error("HTTP 502");
      }
      return byQuery[query] ?? { news: [] };
    },
  };
}

describe("parseGlobalNews", () => {
  it("keeps cleaned titles with their publisher, time and query", () => {
    const items = parseGlobalNews("rupiah", clone(macroFixture.rupiah), 4);

    expect(items[1]).toEqual({
      title: "Rupiah steadies near 15,900 as BI leaves policy unchanged",
      publisher: "Bloomberg",
      // Yahoo's epoch seconds become an ISO instant.
      at: new Date(1789000000 * 1000).toISOString(),
      query: "rupiah",
    });
    // A blank publisher and a missing time are simply absent, never empty strings.
    expect(items[2]?.publisher).toBeUndefined();
    expect(items[2]?.at).toBeUndefined();
    expect(items[2]?.title).toContain("[phone]");
  });

  it("drops instruction-like titles, decodes entities, strips markup and respects the limit", () => {
    const items = parseGlobalNews("federal reserve rate decision", clone(macroFixture["federal reserve rate decision"]), 4);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.title).join(" ")).not.toContain("Ignore all previous");
    expect(items[1]?.title).toBe("Treasury yields slip & the dollar eases after the statement");

    expect(parseGlobalNews("rupiah", clone(macroFixture.rupiah), 1)).toHaveLength(1);
  });

  it("yields nothing for a document without a news list rather than throwing", () => {
    expect(parseGlobalNews("x", { quotes: [] }, 4)).toEqual([]);
    expect(parseGlobalNews("x", null, 4)).toEqual([]);
  });
});

describe("fetchGlobalNews", () => {
  it("searches every query once and dedupes the syndicated story across them", async () => {
    const calls: Call[] = [];
    const result = await fetchGlobalNews(QUERIES, { client: client(calls), now });

    expect(calls.map((call) => call.query)).toEqual([...QUERIES]);
    expect(result.failures).toEqual([]);
    expect(result.news.observedAt).toBe(OBSERVED);
    // The Fed story appears under Reuters and Antara; only the first survives.
    expect(result.news.items.filter((item) => item.title.startsWith("Fed holds rates steady"))).toHaveLength(1);
    expect(result.news.items).toHaveLength(4);
    expect(result.news.items[0]?.query).toBe("federal reserve rate decision");
  });

  it("caps the union and never asks for more than the cap allows", async () => {
    const capped = await fetchGlobalNews(QUERIES, { client: client(), now, max: 2 });
    expect(capped.news.items).toHaveLength(2);

    const clamped = await fetchGlobalNews(QUERIES, { client: client(), now, max: 99 });
    expect(clamped.news.items.length).toBeLessThanOrEqual(GLOBAL_NEWS_ITEMS_MAX);
  });

  it("keeps the queries that answered and reports the one that did not", async () => {
    const result = await fetchGlobalNews(QUERIES, { client: client([], ["rupiah"]), now });

    expect(result.failures).toEqual(["globalNews: rupiah HTTP 502"]);
    expect(result.news.items.every((item) => item.query !== "rupiah")).toBe(true);
    expect(result.news.items.length).toBeGreaterThan(0);
  });

  it("collapses duplicate and blank queries and calls out for none of them when the list is empty", async () => {
    const calls: Call[] = [];
    const deduped = await fetchGlobalNews(["rupiah", " rupiah ", ""], { client: client(calls), now });
    expect(calls.map((call) => call.query)).toEqual(["rupiah"]);
    expect(deduped.failures).toEqual([]);

    const empty = await fetchGlobalNews([], { client: client(calls), now });
    expect(calls).toHaveLength(1);
    expect(empty.news).toEqual({ items: [], observedAt: OBSERVED });
  });
});

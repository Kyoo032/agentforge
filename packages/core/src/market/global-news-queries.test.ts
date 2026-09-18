import { describe, expect, it } from "vitest";
import { ADVICE_PATTERN } from "./advice-guard";
import {
  GLOBAL_NEWS_QUERIES,
  GLOBAL_NEWS_QUERY_COUNT,
  GLOBAL_NEWS_QUERY_KEYS,
  globalNewsQueries,
  globalNewsQuery,
} from "./global-news-queries";

describe("GLOBAL_NEWS_QUERIES", () => {
  it("is the five fixed macro queries, one row per key, in key order", () => {
    expect(GLOBAL_NEWS_QUERIES).toHaveLength(GLOBAL_NEWS_QUERY_COUNT);
    expect(GLOBAL_NEWS_QUERY_COUNT).toBe(5);
    expect(GLOBAL_NEWS_QUERIES.map((query) => query.key)).toEqual([...GLOBAL_NEWS_QUERY_KEYS]);
  });

  it("carries an Indonesian and an English phrasing for every key", () => {
    for (const query of GLOBAL_NEWS_QUERIES) {
      for (const language of ["id", "en"] as const) {
        expect(query[language].trim()).not.toBe("");
        expect(query[language]).not.toMatch(ADVICE_PATTERN);
      }
      expect(query.id).not.toBe(query.en);
    }
  });

  it("keeps every phrasing distinct so the host never fetches the same feed twice", () => {
    for (const language of ["id", "en"] as const) {
      const phrasings = globalNewsQueries(language);
      expect(new Set(phrasings).size).toBe(GLOBAL_NEWS_QUERY_COUNT);
    }
  });

  it("covers rates, inflation, geopolitics, energy, and the Indonesian market", () => {
    expect([...GLOBAL_NEWS_QUERY_KEYS]).toEqual(["rates", "inflation", "geopolitics", "energy", "indonesia"]);
    expect(globalNewsQueries("en").join(" ")).toMatch(/federal reserve/i);
    expect(globalNewsQueries("en").join(" ")).toMatch(/inflation/i);
    expect(globalNewsQueries("id").join(" ")).toMatch(/inflasi/i);
    expect(globalNewsQueries("id").join(" ")).toMatch(/indonesia/i);
  });

  it("resolves one key in one language and falls back to Indonesian", () => {
    expect(globalNewsQuery("rates", "en")).toBe(GLOBAL_NEWS_QUERIES[0].en);
    expect(globalNewsQuery("rates", "id")).toBe(GLOBAL_NEWS_QUERIES[0].id);
  });

  it("is frozen so one desk cannot rewrite the macro feed for another", () => {
    expect(Object.isFrozen(GLOBAL_NEWS_QUERIES)).toBe(true);
  });
});

/**
 * The five fixed macro queries behind `MarketWatchPacket.globalNews`.
 *
 * They are fixed on purpose: a desk that could phrase its own macro search
 * would be steering the feed, and a model-chosen query is a model-chosen
 * narrative. These five are the standing questions every desk asks of the
 * world — policy rates, inflation, geopolitics, energy, and the Indonesian
 * market the studio is written for — in the reader's own language, so an
 * Indonesian run surfaces Indonesian coverage rather than a translation of a
 * US wire.
 *
 * The host runs each phrasing through its keyless news search, dedupes by
 * title, and keeps at most `GLOBAL_NEWS_MAX` rows; each row carries the query
 * that surfaced it so the news analyst can say which lens it came from.
 */

export const GLOBAL_NEWS_QUERY_KEYS = ["rates", "inflation", "geopolitics", "energy", "indonesia"] as const;
export type GlobalNewsQueryKey = (typeof GLOBAL_NEWS_QUERY_KEYS)[number];

export type GlobalNewsLanguage = "id" | "en";

export type GlobalNewsQuery = {
  readonly key: GlobalNewsQueryKey;
  readonly id: string;
  readonly en: string;
};

/** Number of feeds one packet fetches. Named so the cost of a run is countable. */
export const GLOBAL_NEWS_QUERY_COUNT = GLOBAL_NEWS_QUERY_KEYS.length;

export const GLOBAL_NEWS_QUERIES: readonly GlobalNewsQuery[] = Object.freeze([
  {
    key: "rates",
    id: "suku bunga Federal Reserve dan Bank Indonesia",
    en: "Federal Reserve interest rate decision",
  },
  {
    key: "inflation",
    id: "data inflasi dan harga konsumen",
    en: "inflation data consumer prices",
  },
  {
    key: "geopolitics",
    id: "ketegangan geopolitik dan perdagangan global",
    en: "geopolitical tension global trade",
  },
  {
    key: "energy",
    id: "harga minyak dan energi global",
    en: "oil price energy markets",
  },
  {
    key: "indonesia",
    id: "pasar saham Indonesia IHSG dan rupiah",
    en: "Indonesia stock market rupiah outlook",
  },
] satisfies readonly GlobalNewsQuery[]);

const BY_KEY: ReadonlyMap<GlobalNewsQueryKey, GlobalNewsQuery> = new Map(
  GLOBAL_NEWS_QUERIES.map((query) => [query.key, query]),
);

/** One query's phrasing in the briefing's language; an unknown key falls back to the first. */
export function globalNewsQuery(key: GlobalNewsQueryKey, language: GlobalNewsLanguage): string {
  const query = BY_KEY.get(key) ?? GLOBAL_NEWS_QUERIES[0];
  return language === "en" ? query.en : query.id;
}

/** Every phrasing, in key order: what the host fetches for one packet. */
export function globalNewsQueries(language: GlobalNewsLanguage): readonly string[] {
  return GLOBAL_NEWS_QUERIES.map((query) => (language === "en" ? query.en : query.id));
}

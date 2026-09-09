/**
 * Read-through cache over the `market_cache` table (one row per key + kind,
 * latest only) and the `market_news_fts` FTS5 index over cached headlines.
 *
 * Keys are Yahoo symbols (`MU`, `BBCA.JK`), a history key (`MU@24m`), or the
 * macro sentinel. A kind is refreshed only when missing or older than its TTL
 * (core's TTL_SECONDS: quote 5 min, technical 15 min, history 6 h, news
 * 30 min, macro 5 min); when the refresh throws, the stale row is served and
 * the error is reported as a failure string, never a throw.
 */
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  TTL_SECONDS,
  computeStaleness,
  macroSnapshotSchema,
  priceHistorySchema,
  quoteSchema,
  technicalSchema,
  watchNewsItemSchema,
  watchRefSchema,
  type MacroSnapshot,
  type PriceHistory,
  type Quote,
  type Technical,
  type WatchNewsItem,
  type WatchRef,
} from "@agentforge/core/market";
import { knowledgeFtsQuery } from "../knowledge-text";
import { errorMessage } from "./abort";

export const MARKET_CACHE_KINDS = ["quote", "technical", "history", "news", "macro"] as const;
export type MarketCacheKind = (typeof MARKET_CACHE_KINDS)[number];

/**
 * Watch headlines are refetched after 30 minutes. Core's `TTL_SECONDS.news`
 * (90 days) is the v1 retention window, not a refresh interval, so it is not
 * used here; the FTS index keeps NEWS_RETENTION_SECONDS instead.
 */
export const NEWS_TTL_SECONDS = 30 * 60;

/** Max age per kind before a fetch is attempted. quote / technical / history / macro come from core's TTL_SECONDS. */
export const CACHE_TTL_SECONDS: Readonly<Record<MarketCacheKind, number>> = {
  quote: TTL_SECONDS.quote,
  technical: TTL_SECONDS.technical,
  history: TTL_SECONDS.history,
  news: NEWS_TTL_SECONDS,
  macro: TTL_SECONDS.macro,
};
/** Headlines older than this leave the FTS index on every news write; the cache row itself follows its TTL. */
export const NEWS_RETENTION_SECONDS = 7 * 86_400;
export const NEWS_SEARCH_MAX = 20;
/** The one macro snapshot shares a single row. */
export const MACRO_CACHE_KEY = "__macro__";

const PAYLOAD_SCHEMAS = {
  quote: quoteSchema,
  technical: technicalSchema,
  history: priceHistorySchema,
  news: z.array(watchNewsItemSchema),
  macro: macroSnapshotSchema,
} as const;

export type CachePayloadMap = {
  quote: Quote;
  technical: Technical;
  history: PriceHistory;
  news: WatchNewsItem[];
  macro: MacroSnapshot;
};
export type CachePayload = CachePayloadMap[MarketCacheKind];

export type CachedRow<K extends MarketCacheKind = MarketCacheKind> = {
  id: string;
  key: string;
  kind: K;
  payload: CachePayloadMap[K];
  ref: WatchRef | null;
  observedAt: string;
};

export type RefreshResult<K extends MarketCacheKind> = {
  payload: CachePayloadMap[K];
  ref: WatchRef;
  /** Defaults to ref.observedAt. */
  observedAt?: string;
};

export type ResolvedCache<K extends MarketCacheKind> = {
  row: CachedRow<K> | null;
  /** True when the row served is older than its TTL (the refresh failed). */
  stale: boolean;
  /** "kind: message" when the refresh failed; the stale row, if any, is still in `row`. */
  failure: string | null;
};

export type NewsSearchHit = {
  key: string;
  title: string;
  summary: string;
  link: string;
  publishedAt: string | null;
};

type Row = {
  id: string;
  ticker: string;
  kind: string;
  payload: string;
  source_ref: string;
  observed_at: string;
};

export function historyCacheKey(symbol: string, months: number): string {
  return `${symbol}@${months}m`;
}

function parsePayload<K extends MarketCacheKind>(kind: K, text: string): CachePayloadMap[K] | null {
  try {
    const parsed = PAYLOAD_SCHEMAS[kind].safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as CachePayloadMap[K]) : null;
  } catch {
    return null;
  }
}

function parseRef(text: string): WatchRef | null {
  try {
    const parsed = watchRefSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Latest row for the key + kind, whatever its age. A row whose payload no longer parses counts as missing. */
export function readCached<K extends MarketCacheKind>(
  db: Database.Database,
  key: string,
  kind: K,
): CachedRow<K> | null {
  const row = db
    .prepare(
      `SELECT id, ticker, kind, payload, source_ref, observed_at FROM market_cache
       WHERE ticker = ? AND kind = ? ORDER BY observed_at DESC LIMIT 1`,
    )
    .get(key, kind) as Row | undefined;
  if (!row) {
    return null;
  }
  const payload = parsePayload(kind, row.payload);
  if (!payload) {
    return null;
  }
  return { id: row.id, key: row.ticker, kind, payload, ref: parseRef(row.source_ref), observedAt: row.observed_at };
}

export function isFresh(row: Pick<CachedRow, "observedAt" | "kind">, nowIso: string): boolean {
  return !computeStaleness(row.observedAt, nowIso, CACHE_TTL_SECONDS[row.kind]).isStale;
}

/** The row only when it is within its TTL. */
export function readFresh<K extends MarketCacheKind>(
  db: Database.Database,
  key: string,
  kind: K,
  nowIso: string,
): CachedRow<K> | null {
  const row = readCached(db, key, kind);
  return row && isFresh(row, nowIso) ? row : null;
}

function replaceNewsIndex(db: Database.Database, key: string, items: readonly WatchNewsItem[]): void {
  db.prepare("DELETE FROM market_news_fts WHERE ticker = ?").run(key);
  const insert = db.prepare(
    "INSERT INTO market_news_fts (ticker, title, summary, link, published_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const item of items) {
    // Flagged text stays in the payload for audit but never surfaces through search.
    if (!item.injectionSuspect) {
      insert.run(key, item.title, item.summary, item.link, item.publishedAt);
    }
  }
}

function purgeOldNews(db: Database.Database, nowIso: string): void {
  const cutoff = new Date(Date.parse(nowIso) - NEWS_RETENTION_SECONDS * 1000).toISOString();
  db.prepare("DELETE FROM market_cache WHERE kind = 'news' AND observed_at < ?").run(cutoff);
  db.prepare("DELETE FROM market_news_fts WHERE published_at < ?").run(cutoff);
  db.prepare(
    "DELETE FROM market_news_fts WHERE ticker NOT IN (SELECT ticker FROM market_cache WHERE kind = 'news')",
  ).run();
}

/** Replace the row for key + kind. Validates the payload against the kind's schema (fail fast). */
export function writeCached<K extends MarketCacheKind>(
  db: Database.Database,
  key: string,
  kind: K,
  payload: CachePayloadMap[K],
  ref: WatchRef,
  observedAt: string,
): string {
  const validPayload = PAYLOAD_SCHEMAS[kind].parse(payload) as CachePayloadMap[K];
  const validRef = watchRefSchema.parse(ref);
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new RangeError(`market cache: observedAt is not an ISO 8601 date: ${JSON.stringify(observedAt)}`);
  }
  const id = crypto.randomUUID();
  const write = db.transaction(() => {
    db.prepare("DELETE FROM market_cache WHERE ticker = ? AND kind = ?").run(key, kind);
    db.prepare(
      "INSERT INTO market_cache (id, ticker, kind, payload, source_ref, observed_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, key, kind, JSON.stringify(validPayload), JSON.stringify(validRef), observedAt);
    if (kind === "news") {
      replaceNewsIndex(db, key, validPayload as WatchNewsItem[]);
      purgeOldNews(db, observedAt);
    }
  });
  write();
  return id;
}

/**
 * Fresh row, else refresh and store, else the stale row plus a failure.
 * `refresh` returning null counts as a failure ("no data").
 */
export async function resolveCached<K extends MarketCacheKind>(
  db: Database.Database,
  key: string,
  kind: K,
  nowIso: string,
  refresh: () => Promise<RefreshResult<K> | null>,
): Promise<ResolvedCache<K>> {
  const cached = readCached(db, key, kind);
  if (cached && isFresh(cached, nowIso)) {
    return { row: cached, stale: false, failure: null };
  }
  try {
    const fresh = await refresh();
    if (!fresh) {
      throw new Error("no data returned");
    }
    writeCached(db, key, kind, fresh.payload, fresh.ref, fresh.observedAt ?? fresh.ref.observedAt);
    return { row: readCached(db, key, kind), stale: false, failure: null };
  } catch (error) {
    return { row: cached, stale: cached !== null, failure: `${kind}: ${errorMessage(error)}` };
  }
}

/** FTS5 search over cached headlines, optionally limited to symbols. Limit is clamped to NEWS_SEARCH_MAX. */
export function searchNews(
  db: Database.Database,
  query: string,
  keys?: readonly string[],
  limit: number = NEWS_SEARCH_MAX,
): NewsSearchHit[] {
  const match = knowledgeFtsQuery(query);
  if (!match) {
    return [];
  }
  const cap = Math.max(1, Math.min(NEWS_SEARCH_MAX, Math.floor(limit) || 1));
  const scoped = keys?.filter((key) => key.trim().length > 0) ?? [];
  const filter = scoped.length > 0 ? ` AND ticker IN (${scoped.map(() => "?").join(", ")})` : "";
  let rows: Array<{ ticker: string; title: string; summary: string; link: string; published_at: string | null }>;
  try {
    rows = db
      .prepare(
        `SELECT ticker, title, summary, link, published_at FROM market_news_fts
         WHERE market_news_fts MATCH ?${filter} ORDER BY rank LIMIT ?`,
      )
      .all(match, ...scoped, cap) as typeof rows;
  } catch {
    // Same posture as Knowledge Base: an unparseable FTS expression is an empty result, not a 500.
    return [];
  }
  return rows.map((row) => ({
    key: row.ticker,
    title: row.title,
    summary: row.summary,
    link: row.link,
    publishedAt: row.published_at,
  }));
}

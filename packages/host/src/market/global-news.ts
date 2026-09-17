/**
 * Macro headlines for the analyst team's news seat: a handful of fixed queries
 * ("federal reserve rate decision", "rupiah", …) through the same Yahoo
 * `search` endpoint the per-ticker headlines use.
 *
 * The queries themselves are core's (`GLOBAL_NEWS_QUERIES`, id + en) and are
 * passed in, so this module never decides what the desk reads — only how it is
 * fetched, cleaned and capped. Titles are the only vendor text kept: each one is
 * HTML-stripped, dropped when it reads like an instruction, PII-masked and
 * capped, then deduped by title across queries.
 */
import { maskPii } from "@agentforge/core";
import { GLOBAL_NEWS_MAX, globalNewsItemSchema, type GlobalNewsItem } from "@agentforge/core/market";
import { z } from "zod";
import { errorMessage, withTimeout } from "./abort";
import { mapLimit } from "./map-limit";
import { sanitizeExternalText } from "./sanitize";
import { createYahooClient, type YahooFetchOptions } from "./yahoo";

/** Headlines kept across every query once deduped. Core owns the number. */
export const GLOBAL_NEWS_ITEMS_MAX = GLOBAL_NEWS_MAX;
/** Asked of Yahoo per query; the cap above trims the union. */
export const GLOBAL_NEWS_PER_QUERY = 4;
/** Queries in flight at once. Two is polite to one endpoint and still finishes in a second. */
export const GLOBAL_NEWS_CONCURRENCY = 2;
export const GLOBAL_NEWS_TITLE_MAX = 200;
export const GLOBAL_NEWS_PUBLISHER_MAX = 80;

/** The row shape is core's, so what the cache holds is exactly what the packet carries. */
export { globalNewsItemSchema };
export type { GlobalNewsItem };

export const globalNewsSchema = z.object({
  items: z.array(globalNewsItemSchema).max(GLOBAL_NEWS_ITEMS_MAX),
  observedAt: z.string().datetime({ offset: true }),
});
export type GlobalNews = z.infer<typeof globalNewsSchema>;

export type GlobalNewsResult = {
  news: GlobalNews;
  /** "globalNews: <query> <reason>" per query that failed; empty when all of them answered. */
  failures: string[];
};

export type GlobalNewsOptions = YahooFetchOptions & {
  /** Headlines asked of Yahoo per query. */
  perQuery?: number;
  /** Headlines kept once deduped. Defaults to `GLOBAL_NEWS_ITEMS_MAX`. */
  max?: number;
  concurrency?: number;
};

type Rec = Record<string, unknown>;

function rec(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null;
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const clean = sanitizeExternalText(value);
  if (!clean.text || clean.injectionSuspect) {
    return undefined;
  }
  const masked = maskPii(clean.text).slice(0, max).trim();
  return masked || undefined;
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  return undefined;
}

/**
 * Pure: one `search` document to headline rows for that query. A row without a
 * usable title (empty, or instruction-like) is dropped; a document without a
 * `news` list yields nothing rather than throwing, because one dead query must
 * not cost the desk the other four.
 */
export function parseGlobalNews(query: string, payload: unknown, limit: number): GlobalNewsItem[] {
  const news = rec(payload)?.news;
  if (!Array.isArray(news)) {
    return [];
  }
  return news
    .flatMap((raw) => {
      const row = rec(raw) ?? {};
      const title = cleanText(row.title, GLOBAL_NEWS_TITLE_MAX);
      if (!title) {
        return [];
      }
      const publisher = cleanText(row.publisher, GLOBAL_NEWS_PUBLISHER_MAX);
      const at = toIso(row.providerPublishTime);
      return [globalNewsItemSchema.parse({ title, ...(publisher ? { publisher } : {}), ...(at ? { at } : {}), query })];
    })
    .slice(0, Math.max(1, limit));
}

/** Case-insensitive on the title: the same wire story is syndicated under several publishers. */
function dedupe(items: readonly GlobalNewsItem[], max: number): GlobalNewsItem[] {
  const seen = new Set<string>();
  const out: GlobalNewsItem[] = [];
  for (const item of items) {
    const key = item.title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

/**
 * The macro headline set for one language's queries. Every query is best
 * effort: a failed one is a failure string and the others still land, and an
 * empty result is a valid answer (an empty `items` list), never a throw.
 */
export async function fetchGlobalNews(
  queries: readonly string[],
  opts: GlobalNewsOptions = {},
): Promise<GlobalNewsResult> {
  const wanted = [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
  const observedAt = (opts.now ?? (() => new Date()))().toISOString();
  if (wanted.length === 0) {
    return { news: globalNewsSchema.parse({ items: [], observedAt }), failures: [] };
  }
  const client = opts.client ?? createYahooClient();
  const perQuery = Math.max(1, Math.floor(opts.perQuery ?? GLOBAL_NEWS_PER_QUERY) || 1);
  const max = Math.max(1, Math.min(GLOBAL_NEWS_ITEMS_MAX, Math.floor(opts.max ?? GLOBAL_NEWS_ITEMS_MAX) || 1));
  const { signal, dispose } = withTimeout(opts.signal, opts.timeoutMs);
  let results: PromiseSettledResult<GlobalNewsItem[]>[];
  try {
    results = await mapLimit(wanted, opts.concurrency ?? GLOBAL_NEWS_CONCURRENCY, async (query) =>
      parseGlobalNews(query, await client.search(query, perQuery, signal), perQuery),
    );
  } finally {
    dispose();
  }
  const items: GlobalNewsItem[] = [];
  const failures: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      failures.push(`globalNews: ${wanted[index]} ${errorMessage(result.reason)}`);
    }
  });
  return { news: globalNewsSchema.parse({ items: dedupe(items, max), observedAt }), failures };
}

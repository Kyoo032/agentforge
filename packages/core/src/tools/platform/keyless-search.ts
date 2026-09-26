/**
 * Keyless search for desks with no Tavily or Brave key.
 *
 * Official APIs only, each on a pinned HTTPS origin. Redirects are followed
 * only when they stay on that origin. A saved Tavily or Brave key still wins;
 * this module is the fallback. Comparison: the keyless-search options note.
 */

import { parseAppLocale, type AppLocale } from "../../locale";
import { maskPii } from "../../security/pii";
import { assertAllowedEndpointUrl } from "../../security/tls";

export const KEYLESS_ORIGINS = {
  wikipediaEn: "https://en.wikipedia.org",
  wikipediaId: "https://id.wikipedia.org",
  openAlex: "https://api.openalex.org",
  arxiv: "https://export.arxiv.org",
  crossref: "https://api.crossref.org",
} as const;

/** Contactable User-Agent. Wikimedia asks for a name and a URL or mailbox. */
export const KEYLESS_USER_AGENT = "NultronResearch/1.0 (+https://github.com/Kyoo032/Nultron)";

export const KEYLESS_HIT_CAP = 5;
export const KEYLESS_TIMEOUT_MS = 8_000;
export const KEYLESS_CACHE_TTL_MS = 15 * 60 * 1000;
export const KEYLESS_CACHE_MAX = 128;
/** arXiv legacy API: one request every three seconds, one connection. */
export const KEYLESS_ARXIV_GAP_MS = 3_000;

const THIN_BEFORE_ARXIV = 3;
const THIN_BEFORE_CROSSREF = 2;
const SNIPPET_MAX = 400;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type KeylessHit = { title: string; url: string; description: string; position: number };

export type KeylessSearchOptions = {
  fetchImpl?: typeof fetch;
  locale?: AppLocale;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type KeylessSearchResult = {
  hits: KeylessHit[];
  /** Every source failed. An empty hit list with outage false means the APIs answered and had nothing. */
  outage: boolean;
  locale: AppLocale;
};

type SourceResult = { ok: true; hits: KeylessHit[] } | { ok: false };

const cache = new Map<string, { at: number; hits: KeylessHit[] }>();
let arxivChain: Promise<void> = Promise.resolve();
let arxivLast = 0;
let readLocale: () => AppLocale = () => "en";

export function bindKeylessSearchLocale(read: () => AppLocale): void {
  readLocale = () => {
    try {
      return parseAppLocale(read());
    } catch {
      return "en";
    }
  };
}

export function currentKeylessLocale(): AppLocale {
  return readLocale();
}

/** Test hook. Production never needs to drop the cache. */
export function resetKeylessSearchState(): void {
  cache.clear();
  arxivLast = 0;
  arxivChain = Promise.resolve();
}

const SCHOLARLY =
  /\b(doi\b|arxiv|preprint|journal|paper|study|studies|meta-analysis|citation|issn|peer-reviewed|jurnal|makalah|penelitian|pracetak|kajian)\b/i;

export async function searchKeyless(query: string, options: KeylessSearchOptions = {}): Promise<KeylessSearchResult> {
  const locale = options.locale ?? readLocale();
  const masked = maskPii(query).trim().slice(0, 300);
  if (!masked) {
    return { hits: [], outage: false, locale };
  }
  const now = options.now ?? Date.now;
  const key = `${locale}\n${masked.toLowerCase().replace(/\s+/g, " ")}`;
  const cached = recall(key, now());
  if (cached) {
    return { hits: cached, outage: false, locale };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? KEYLESS_TIMEOUT_MS;
  const ctx = { fetchImpl, timeoutMs, signal: options.signal, locale };

  const [wiki, openAlex] = await Promise.all([searchWikipedia(masked, ctx), searchOpenAlex(masked, ctx)]);
  let hits = mergeHits(wiki, openAlex, scholarlyQuery(masked));
  const tried = [wiki, openAlex];

  if (options.signal?.aborted) {
    return { hits: [], outage: true, locale };
  }

  if (scholarlyQuery(masked) || httpsCount(hits) < THIN_BEFORE_ARXIV) {
    const arxiv = await withArxivSlot(() => searchArxiv(masked, ctx), now, options.sleep ?? defaultSleep);
    tried.push(arxiv);
    hits = mergeHits(wiki, openAlex, scholarlyQuery(masked), arxiv);
    if (httpsCount(hits) < THIN_BEFORE_CROSSREF) {
      const crossref = await searchCrossref(masked, ctx);
      tried.push(crossref);
      hits = mergeHits(wiki, openAlex, scholarlyQuery(masked), arxiv, crossref);
    }
  }

  const outage = tried.every((source) => !source.ok);
  const capped = numberHits(hits).slice(0, KEYLESS_HIT_CAP);
  if (!outage && !options.signal?.aborted) {
    remember(key, capped, now());
  }
  return { hits: capped, outage, locale };
}

function scholarlyQuery(query: string): boolean {
  return SCHOLARLY.test(query);
}

function httpsCount(hits: KeylessHit[]): number {
  return hits.length;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function withArxivSlot<T>(
  run: () => Promise<T>,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = arxivChain;
  arxivChain = gate;
  await previous;
  try {
    const wait = arxivLast === 0 ? 0 : Math.max(0, KEYLESS_ARXIV_GAP_MS - (now() - arxivLast));
    if (wait > 0) {
      await sleep(wait);
    }
    arxivLast = now();
    return await run();
  } finally {
    release();
  }
}

function wikipediaOrigin(locale: AppLocale): string {
  return locale === "id" ? KEYLESS_ORIGINS.wikipediaId : KEYLESS_ORIGINS.wikipediaEn;
}

async function searchWikipedia(query: string, ctx: FetchCtx): Promise<SourceResult> {
  const origin = wikipediaOrigin(ctx.locale);
  const url = new URL("/w/rest.php/v1/search/page", origin);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(KEYLESS_HIT_CAP));
  const body = await fetchPinnedJson(url.toString(), origin, ctx);
  if (!body) {
    return { ok: false };
  }
  const pages = Array.isArray(body.pages) ? body.pages : [];
  const hits: KeylessHit[] = [];
  for (const page of pages) {
    if (!page || typeof page !== "object") {
      continue;
    }
    const record = page as { key?: unknown; title?: unknown; excerpt?: unknown; description?: unknown };
    const key = typeof record.key === "string" ? record.key : "";
    const title = squash(typeof record.title === "string" ? record.title : "");
    if (!key || !title) {
      continue;
    }
    const excerpt = squash(stripTags(typeof record.excerpt === "string" ? record.excerpt : ""));
    const description = squash(typeof record.description === "string" ? record.description : "");
    hits.push({
      title,
      url: `${origin}/wiki/${encodeURIComponent(key)}`,
      description: (excerpt || description).slice(0, SNIPPET_MAX),
      position: 0,
    });
  }
  return { ok: true, hits };
}

async function searchOpenAlex(query: string, ctx: FetchCtx): Promise<SourceResult> {
  const origin = KEYLESS_ORIGINS.openAlex;
  const url = new URL("/works", origin);
  url.searchParams.set("search", query);
  url.searchParams.set("per_page", String(KEYLESS_HIT_CAP));
  url.searchParams.set("select", "id,display_name,doi,publication_year,primary_location,abstract_inverted_index");
  const body = await fetchPinnedJson(url.toString(), origin, ctx);
  if (!body) {
    return { ok: false };
  }
  const results = Array.isArray(body.results) ? body.results : [];
  const hits: KeylessHit[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as {
      display_name?: unknown;
      doi?: unknown;
      id?: unknown;
      publication_year?: unknown;
      primary_location?: { landing_page_url?: unknown } | null;
      abstract_inverted_index?: unknown;
    };
    const title = squash(typeof record.display_name === "string" ? record.display_name : "");
    const landing =
      record.primary_location && typeof record.primary_location.landing_page_url === "string"
        ? record.primary_location.landing_page_url
        : "";
    const doi = typeof record.doi === "string" ? record.doi : "";
    const id = typeof record.id === "string" ? record.id : "";
    const page = firstHttps(landing, doi, id);
    if (!title || !page) {
      continue;
    }
    const year = typeof record.publication_year === "number" ? ` (${record.publication_year})` : "";
    const abstract = abstractFromInverted(record.abstract_inverted_index);
    hits.push({
      title,
      url: page,
      description: (abstract || `OpenAlex${year}`).slice(0, SNIPPET_MAX),
      position: 0,
    });
  }
  return { ok: true, hits };
}

async function searchArxiv(query: string, ctx: FetchCtx): Promise<SourceResult> {
  const origin = KEYLESS_ORIGINS.arxiv;
  const url = new URL("/api/query", origin);
  url.searchParams.set("search_query", `all:${query}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(KEYLESS_HIT_CAP));
  const xml = await fetchPinnedText(url.toString(), origin, ctx, "application/atom+xml");
  if (xml === null) {
    return { ok: false };
  }
  const hits: KeylessHit[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const title = squash(decodeXml(textTag(entry, "title")));
    const page = arxivAbsUrl(textTag(entry, "id"));
    if (!title || !page) {
      continue;
    }
    hits.push({
      title,
      url: page,
      description: squash(decodeXml(textTag(entry, "summary"))).slice(0, SNIPPET_MAX),
      position: 0,
    });
  }
  return { ok: true, hits };
}

async function searchCrossref(query: string, ctx: FetchCtx): Promise<SourceResult> {
  const origin = KEYLESS_ORIGINS.crossref;
  const url = new URL("/works", origin);
  url.searchParams.set("query", query);
  url.searchParams.set("rows", String(KEYLESS_HIT_CAP));
  url.searchParams.set("select", "DOI,title,URL,abstract");
  const body = await fetchPinnedJson(url.toString(), origin, ctx);
  if (!body) {
    return { ok: false };
  }
  const message = body.message;
  const items =
    message && typeof message === "object" && Array.isArray((message as { items?: unknown }).items)
      ? (message as { items: unknown[] }).items
      : [];
  const hits: KeylessHit[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as { title?: unknown; URL?: unknown; DOI?: unknown; abstract?: unknown };
    const title = squash(Array.isArray(record.title) && typeof record.title[0] === "string" ? record.title[0] : "");
    const urlValue = typeof record.URL === "string" ? record.URL : "";
    const doi = typeof record.DOI === "string" ? record.DOI : "";
    const page = firstHttps(urlValue, doi ? `https://doi.org/${doi}` : "");
    if (!title || !page) {
      continue;
    }
    hits.push({
      title,
      url: page,
      description: squash(stripTags(typeof record.abstract === "string" ? record.abstract : "")).slice(0, SNIPPET_MAX),
      position: 0,
    });
  }
  return { ok: true, hits };
}

type FetchCtx = {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  signal?: AbortSignal;
  locale: AppLocale;
};

async function fetchPinnedJson(url: string, origin: string, ctx: FetchCtx): Promise<Record<string, unknown> | null> {
  const text = await fetchPinnedText(url, origin, ctx, "application/json");
  if (text === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function fetchPinnedText(url: string, origin: string, ctx: FetchCtx, accept: string): Promise<string | null> {
  try {
    assertAllowedEndpointUrl(url);
    let current = new URL(url);
    if (current.origin !== origin || current.protocol !== "https:") {
      return null;
    }
    for (let hop = 0; hop < 3; hop += 1) {
      if (ctx.signal?.aborted) {
        return null;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
      const onAbort = () => controller.abort();
      ctx.signal?.addEventListener("abort", onAbort);
      try {
        const response = await ctx.fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          credentials: "omit",
          headers: { Accept: accept, "User-Agent": KEYLESS_USER_AGENT },
          signal: controller.signal,
        });
        if (REDIRECT_STATUSES.has(response.status)) {
          const location = response.headers.get("location");
          if (!location) {
            return null;
          }
          const next = new URL(location, current);
          assertAllowedEndpointUrl(next.toString());
          if (next.origin !== origin || next.protocol !== "https:") {
            return null;
          }
          current = next;
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          return null;
        }
        return await response.text();
      } finally {
        clearTimeout(timer);
        ctx.signal?.removeEventListener("abort", onAbort);
      }
    }
    return null;
  } catch {
    return null;
  }
}

function mergeHits(
  wiki: SourceResult,
  openAlex: SourceResult,
  scholarly: boolean,
  ...rest: SourceResult[]
): KeylessHit[] {
  const groups = scholarly ? [openAlex, ...rest, wiki] : [wiki, openAlex, ...rest];
  const seen = new Set<string>();
  const hits: KeylessHit[] = [];
  for (const group of groups) {
    if (!group.ok) {
      continue;
    }
    for (const hit of group.hits) {
      const key = urlKey(hit.url);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      hits.push({ ...hit, url: key });
    }
  }
  return hits;
}

function numberHits(hits: KeylessHit[]): KeylessHit[] {
  return hits.map((hit, index) => ({ ...hit, position: index + 1 }));
}

function urlKey(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) {
      return null;
    }
    url.hash = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

function firstHttps(...candidates: string[]): string | null {
  for (const candidate of candidates) {
    const key = urlKey(candidate);
    if (key) {
      return key;
    }
  }
  return null;
}

function abstractFromInverted(index: unknown): string {
  if (!index || typeof index !== "object") {
    return "";
  }
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index as Record<string, unknown>)) {
    if (!Array.isArray(positions)) {
      continue;
    }
    for (const position of positions) {
      if (typeof position === "number" && position >= 0 && position < 400) {
        words[position] = word;
      }
    }
  }
  return squash(words.filter((word) => typeof word === "string").join(" ")).slice(0, SNIPPET_MAX);
}

function textTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ?? "";
}

function arxivAbsUrl(id: string): string | null {
  const match = id.match(/arxiv\.org\/abs\/([\w.-]+\/[\w.-]+|\d{4}\.\d{4,5})(v\d+)?/i);
  if (!match?.[1]) {
    return null;
  }
  return `https://arxiv.org/abs/${match[1]}${match[2] ?? ""}`;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeXml(value: string): string {
  return stripTags(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function recall(key: string, now: number): KeylessHit[] | null {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }
  if (now - entry.at > KEYLESS_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.hits;
}

function remember(key: string, hits: KeylessHit[], now: number): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, { at: now, hits });
  while (cache.size > KEYLESS_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

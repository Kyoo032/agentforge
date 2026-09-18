/**
 * Reddit adapter: how much retail discussion a ticker is getting, read from the
 * public per-subreddit search feeds.
 *
 * Titles only — never a post body, an author, a score or a link. Each title
 * goes through `sentimentSample` (HTML-stripped, dropped when it reads like an
 * instruction, PII-masked, capped), so a planted comment cannot become a
 * sentence in a briefing.
 *
 * Feed parsing is a small tolerant scanner rather than a new dependency: Reddit
 * serves Atom today and has served RSS in the past, so `parseFeedEntries` reads
 * `<entry>`/`<updated>` and `<item>`/`<pubDate>` alike and ignores everything
 * else it finds. A malformed feed yields fewer entries, never a throw.
 *
 * Manners, because this is an unauthenticated public endpoint: a self-
 * identifying User-Agent, `REDDIT_DELAY_MS` between subreddits, and exactly one
 * retry on HTTP 429 honouring `Retry-After`. "Unavailable" (every subreddit
 * refused) and "no posts" (they answered with nothing) are different answers and
 * are reported differently, because a silent zero would read as "nobody is
 * talking about it".
 */
import { z } from "zod";
import { errorMessage, withTimeout } from "./abort";
import { sentimentSample, sentimentSampleSchema, type SentimentSample } from "./sentiment-sample";

export const REDDIT_ORIGIN = "https://www.reddit.com";
/** Self-identifying, per Reddit's API rules; no key, no login, no user data. */
export const REDDIT_USER_AGENT = "DPSBuddy/0.14 (+local desk)";
/** Every subreddit call gives up after this long, whatever the caller's signal says. */
export const REDDIT_TIMEOUT_MS = 10_000;
/** A response larger than this is refused unread rather than parsed. */
export const REDDIT_BODY_MAX_BYTES = 1_500_000;
/** Politeness gap between two subreddit reads. */
export const REDDIT_DELAY_MS = 1_000;
/** Longest we will honour a `Retry-After` before giving up on that subreddit. */
export const REDDIT_RETRY_MAX_MS = 5_000;
/** Entries read from one feed before the rest are ignored. */
export const REDDIT_ENTRIES_MAX = 25;
/** Titles kept as samples across all subreddits. */
export const REDDIT_SAMPLES_MAX = 3;

/** Equity and index chatter. */
export const REDDIT_EQUITY_SUBS = ["wallstreetbets", "stocks", "investing"] as const;
/** Coins live in one place; the equity subs would mostly return noise. */
export const REDDIT_CRYPTO_SUBS = ["CryptoCurrency"] as const;

export const redditSentimentSchema = z.object({
  /** What was searched for: the ticker, or the coin's base symbol. */
  query: z.string().min(1),
  /** Posts seen across every subreddit that answered. */
  posts: z.number().int().nonnegative(),
  /** The subreddits that actually answered, in the order they were read. */
  subreddits: z.array(z.string().min(1)).max(REDDIT_EQUITY_SUBS.length + REDDIT_CRYPTO_SUBS.length),
  /** True when every subreddit refused: "we could not look", not "nobody posted". */
  unavailable: z.boolean(),
  samples: z.array(sentimentSampleSchema).max(REDDIT_SAMPLES_MAX),
  observedAt: z.string().datetime({ offset: true }),
});
export type RedditSentiment = z.infer<typeof redditSentimentSchema>;

export type RedditFetchOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => Date;
  timeoutMs?: number;
  /** Injected in tests so the politeness gap costs nothing. */
  delay?: (ms: number) => Promise<void>;
};

export type RedditResult = {
  sentiment?: RedditSentiment;
  /** One string per subreddit that refused; empty when every one answered. */
  failures: string[];
};

/**
 * The subreddits worth searching for a ticker, and what to search for. IDX
 * names (`.JK`) are not discussed on these subs at all, so they are skipped
 * rather than searched for nothing.
 */
export function redditPlanFor(ticker: string): { query: string; subs: readonly string[] } | null {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol || symbol.endsWith(".JK")) {
    return null;
  }
  const crypto = /^([A-Z0-9]{2,10})-USD$/.exec(symbol);
  if (crypto) {
    return { query: crypto[1] as string, subs: REDDIT_CRYPTO_SUBS };
  }
  return /^[A-Z][A-Z0-9-]{0,9}$/.test(symbol) ? { query: symbol, subs: REDDIT_EQUITY_SUBS } : null;
}

export function redditSearchUrl(sub: string, query: string): string {
  return `${REDDIT_ORIGIN}/r/${encodeURIComponent(sub)}/search.rss?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new`;
}

/* Feed parsing */

export type FeedEntry = { title: string; at: string | null };

function unwrapCdata(text: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  return cdata ? (cdata[1] as string) : text;
}

function firstTag(block: string, names: readonly string[]): string | null {
  for (const name of names) {
    const match = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
    if (match) {
      return unwrapCdata(match[1] as string);
    }
  }
  return null;
}

/**
 * Titles and dates from an Atom or RSS document. Tolerant on purpose: this is a
 * scanner, not an XML parser, so an entry missing a date keeps its title and a
 * block that is not an entry is simply not matched. Capped at
 * `REDDIT_ENTRIES_MAX`.
 */
export function parseFeedEntries(xml: string): FeedEntry[] {
  const blocks = [...(xml ?? "").matchAll(/<(entry|item)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  return blocks.slice(0, REDDIT_ENTRIES_MAX).flatMap((match) => {
    const block = match[2] as string;
    const title = firstTag(block, ["title"]);
    return title === null ? [] : [{ title, at: firstTag(block, ["updated", "published", "pubDate", "dc:date"]) }];
  });
}

/* Fetching */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** `Retry-After` in seconds or as an HTTP date, clamped to `REDDIT_RETRY_MAX_MS`. Absent means no wait. */
export function retryAfterMs(header: string | null, nowMs: number): number {
  const raw = (header ?? "").trim();
  if (!raw) {
    return 0;
  }
  const seconds = Number(raw);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - nowMs;
  if (!Number.isFinite(ms) || ms <= 0) {
    return 0;
  }
  return Math.min(ms, REDDIT_RETRY_MAX_MS);
}

async function getFeed(url: string, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Response> {
  return fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/atom+xml, application/rss+xml, application/xml", "User-Agent": REDDIT_USER_AGENT },
    signal,
  });
}

async function readBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REDDIT_BODY_MAX_BYTES) {
    throw new Error(`response is ${declared} bytes, over the ${REDDIT_BODY_MAX_BYTES} byte cap`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > REDDIT_BODY_MAX_BYTES) {
    throw new Error(`response is over the ${REDDIT_BODY_MAX_BYTES} byte cap`);
  }
  return text;
}

/** One subreddit feed, with exactly one 429 retry honouring `Retry-After`. Throws on anything else. */
async function fetchFeed(
  sub: string,
  query: string,
  opts: Required<Pick<RedditFetchOptions, "delay">> & RedditFetchOptions,
  signal: AbortSignal,
): Promise<FeedEntry[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = redditSearchUrl(sub, query);
  let response = await getFeed(url, fetchImpl, signal);
  if (response.status === 429) {
    const wait = retryAfterMs(response.headers.get("retry-after"), (opts.now ?? (() => new Date()))().getTime());
    await opts.delay(wait);
    response = await getFeed(url, fetchImpl, signal);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return parseFeedEntries(await readBody(response));
}

/**
 * Post counts and up to `REDDIT_SAMPLES_MAX` titles for one ticker, read one
 * subreddit at a time with `REDDIT_DELAY_MS` between them.
 *
 * A ticker these subs do not discuss returns no row and no failure. When every
 * subreddit refused, the row comes back with `unavailable: true` and zero
 * posts, so the model is told the read is missing rather than empty.
 */
export async function fetchReddit(ticker: string, opts: RedditFetchOptions = {}): Promise<RedditResult> {
  const plan = redditPlanFor(ticker);
  if (!plan) {
    return { failures: [] };
  }
  const observedAt = (opts.now ?? (() => new Date()))().toISOString();
  const delay = opts.delay ?? sleep;
  const { signal, dispose } = withTimeout(opts.signal, opts.timeoutMs ?? REDDIT_TIMEOUT_MS);
  const answered: string[] = [];
  const failures: string[] = [];
  const samples: SentimentSample[] = [];
  let posts = 0;
  try {
    for (const [index, sub] of plan.subs.entries()) {
      if (index > 0) {
        await delay(REDDIT_DELAY_MS);
      }
      try {
        const entries = await fetchFeed(sub, plan.query, { ...opts, delay }, signal);
        answered.push(sub);
        posts += entries.length;
        for (const entry of entries) {
          if (samples.length >= REDDIT_SAMPLES_MAX) {
            break;
          }
          const sample = sentimentSample("reddit", entry.title, entry.at);
          if (sample) {
            samples.push(sample);
          }
        }
      } catch (error) {
        failures.push(`reddit: r/${sub} ${errorMessage(error)}`);
      }
    }
  } finally {
    dispose();
  }
  return {
    sentiment: redditSentimentSchema.parse({
      query: plan.query,
      posts,
      subreddits: answered,
      unavailable: answered.length === 0,
      samples,
      observedAt,
    }),
    failures,
  };
}

import { describe, expect, it } from "vitest";
import { REDDIT_SEARCH_MU as feedFixture } from "./__fixtures__/reddit-search-mu";
import {
  REDDIT_BODY_MAX_BYTES,
  REDDIT_CRYPTO_SUBS,
  REDDIT_DELAY_MS,
  REDDIT_EQUITY_SUBS,
  REDDIT_RETRY_MAX_MS,
  REDDIT_USER_AGENT,
  fetchReddit,
  parseFeedEntries,
  redditPlanFor,
  redditSearchUrl,
  retryAfterMs,
} from "./reddit";

const NOW = new Date("2026-09-17T08:00:00.000Z");
const OBSERVED = NOW.toISOString();
const now = () => NOW;

type Call = { url: string; userAgent: string | null };
type Reply = { status?: number; body?: string; headers?: Record<string, string> };

/** Every response is scripted; no test in this file opens a socket. */
function stub(replies: Reply[] | Reply, calls: Call[] = []): typeof fetch {
  const queue = Array.isArray(replies) ? [...replies] : null;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, userAgent: headers.get("user-agent") });
    const reply = (queue ? (queue.shift() ?? { status: 404 }) : (replies as Reply)) satisfies Reply;
    return new Response(reply.body ?? feedFixture, { status: reply.status ?? 200, headers: reply.headers });
  }) as typeof fetch;
}

function recorder(): { waits: number[]; delay: (ms: number) => Promise<void> } {
  const waits: number[] = [];
  return {
    waits,
    delay: async (ms: number) => {
      waits.push(ms);
    },
  };
}

describe("redditPlanFor", () => {
  it("routes equities to the three stock subs, coins to r/CryptoCurrency, and skips IDX", () => {
    expect(redditPlanFor("MU")).toEqual({ query: "MU", subs: REDDIT_EQUITY_SUBS });
    expect(redditPlanFor("btc-usd")).toEqual({ query: "BTC", subs: REDDIT_CRYPTO_SUBS });
    expect(redditPlanFor("BBCA.JK")).toBeNull();
    expect(redditPlanFor("EURUSD=X")).toBeNull();
    expect(redditPlanFor("")).toBeNull();
  });

  it("builds a subreddit-restricted, newest-first search URL", () => {
    expect(redditSearchUrl("stocks", "MU")).toBe(
      "https://www.reddit.com/r/stocks/search.rss?q=MU&restrict_sr=1&sort=new",
    );
  });
});

describe("parseFeedEntries", () => {
  it("reads Atom entries, unwraps CDATA, and keeps an entry that has no date", () => {
    const entries = parseFeedEntries(feedFixture);

    expect(entries).toHaveLength(5);
    expect(entries[0]?.title).toContain("HBM sold out through 2027");
    expect(entries[0]?.at).toBe("2026-09-17T07:41:00+00:00");
    expect(entries[1]?.title).toBe("Is <b>MU</b> still cheap after the run?");
    expect(entries[3]?.at).toBeNull();
  });

  it("reads the RSS shape too and tolerates a malformed document", () => {
    const rss = "<rss><channel><item><title>Old shape</title><pubDate>Tue, 15 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>";
    expect(parseFeedEntries(rss)).toEqual([{ title: "Old shape", at: "Tue, 15 Sep 2026 12:00:00 GMT" }]);

    expect(parseFeedEntries("<feed><entry><updated>2026-01-01</updated></entry></feed>")).toEqual([]);
    expect(parseFeedEntries("not xml at all")).toEqual([]);
    expect(parseFeedEntries("")).toEqual([]);
  });
});

describe("retryAfterMs", () => {
  it("accepts seconds and HTTP dates, clamps the wait, and ignores anything else", () => {
    expect(retryAfterMs("2", NOW.getTime())).toBe(2000);
    expect(retryAfterMs("600", NOW.getTime())).toBe(REDDIT_RETRY_MAX_MS);
    expect(retryAfterMs(new Date(NOW.getTime() + 3000).toUTCString(), NOW.getTime())).toBeGreaterThan(0);
    expect(retryAfterMs(null, NOW.getTime())).toBe(0);
    expect(retryAfterMs("soon", NOW.getTime())).toBe(0);
    expect(retryAfterMs("-5", NOW.getTime())).toBe(0);
  });
});

describe("fetchReddit", () => {
  it("reads each subreddit in turn with a delay between them and a self-identifying agent", async () => {
    const calls: Call[] = [];
    const { waits, delay } = recorder();
    const result = await fetchReddit("MU", { fetchImpl: stub({}, calls), now, delay });

    expect(calls.map((call) => call.url)).toEqual(REDDIT_EQUITY_SUBS.map((sub) => redditSearchUrl(sub, "MU")));
    expect(calls.every((call) => call.userAgent === REDDIT_USER_AGENT)).toBe(true);
    // One gap between reads, never before the first one.
    expect(waits).toEqual([REDDIT_DELAY_MS, REDDIT_DELAY_MS]);
    expect(result.failures).toEqual([]);
    expect(result.sentiment).toMatchObject({
      query: "MU",
      posts: 15,
      subreddits: [...REDDIT_EQUITY_SUBS],
      unavailable: false,
      observedAt: OBSERVED,
    });
  });

  it("keeps at most three titles, drops an instruction-like one and masks PII in the rest", async () => {
    const result = await fetchReddit("MU", { fetchImpl: stub({}), now, delay: recorder().delay });
    const samples = result.sentiment?.samples ?? [];

    expect(samples).toHaveLength(3);
    expect(samples.every((sample) => sample.source === "reddit")).toBe(true);
    expect(samples[0]?.title).toBe("MU earnings recap: HBM sold out through 2027 & capex guide raised");
    expect(samples[0]?.at).toBe("2026-09-17T07:41:00.000Z");
    // Markup inside the CDATA title is stripped like any other external text.
    expect(samples[1]?.title).toBe("Is MU still cheap after the run?");
    expect(samples.map((sample) => sample.title).join(" ")).not.toContain("ignore all previous");
    expect(samples[2]?.title).toContain("[phone]");
    expect(samples[2]?.at).toBeUndefined();
  });

  it("retries once on 429 honouring Retry-After and then keeps the subreddit's posts", async () => {
    const calls: Call[] = [];
    const { waits, delay } = recorder();
    const result = await fetchReddit("BTC-USD", {
      fetchImpl: stub([{ status: 429, headers: { "retry-after": "2" }, body: "" }, {}], calls),
      now,
      delay,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(redditSearchUrl("CryptoCurrency", "BTC"));
    expect(calls[1]?.url).toBe(calls[0]?.url);
    // The only wait is the retry: a single subreddit has no gap to sit through.
    expect(waits).toEqual([2000]);
    expect(result.failures).toEqual([]);
    expect(result.sentiment?.posts).toBe(5);
    expect(result.sentiment?.subreddits).toEqual([...REDDIT_CRYPTO_SUBS]);
  });

  it("gives up on a subreddit that is still rate limited after the one retry", async () => {
    const calls: Call[] = [];
    const result = await fetchReddit("BTC-USD", {
      fetchImpl: stub([{ status: 429, body: "" }, { status: 429, body: "" }], calls),
      now,
      delay: recorder().delay,
    });

    expect(calls).toHaveLength(2);
    expect(result.failures).toEqual(["reddit: r/CryptoCurrency HTTP 429"]);
    expect(result.sentiment).toMatchObject({ posts: 0, subreddits: [], unavailable: true });
  });

  it("tells an unavailable read apart from a quiet one", async () => {
    const down = await fetchReddit("MU", {
      fetchImpl: stub([{ status: 503, body: "" }, { status: 503, body: "" }, { status: 503, body: "" }]),
      now,
      delay: recorder().delay,
    });
    expect(down.sentiment?.unavailable).toBe(true);
    expect(down.sentiment?.posts).toBe(0);
    expect(down.failures).toHaveLength(3);

    const quiet = await fetchReddit("MU", {
      fetchImpl: stub({ body: '<feed xmlns="http://www.w3.org/2005/Atom"></feed>' }),
      now,
      delay: recorder().delay,
    });
    expect(quiet.sentiment?.unavailable).toBe(false);
    expect(quiet.sentiment?.posts).toBe(0);
    expect(quiet.sentiment?.subreddits).toEqual([...REDDIT_EQUITY_SUBS]);
    expect(quiet.failures).toEqual([]);
  });

  it("keeps the subreddits that answered when one of them refuses", async () => {
    const result = await fetchReddit("MU", {
      fetchImpl: stub([{}, { status: 500, body: "" }, {}]),
      now,
      delay: recorder().delay,
    });

    expect(result.sentiment?.subreddits).toEqual(["wallstreetbets", "investing"]);
    expect(result.sentiment?.unavailable).toBe(false);
    expect(result.sentiment?.posts).toBe(10);
    expect(result.failures).toEqual(["reddit: r/stocks HTTP 500"]);
  });

  it("refuses an oversize body and never calls out for a ticker these subs do not discuss", async () => {
    const oversize = await fetchReddit("MU", {
      fetchImpl: stub({ headers: { "content-length": String(REDDIT_BODY_MAX_BYTES + 1) } }),
      now,
      delay: recorder().delay,
    });
    expect(oversize.failures[0]).toContain("byte cap");

    const calls: Call[] = [];
    const skipped = await fetchReddit("BBCA.JK", { fetchImpl: stub({}, calls), now, delay: recorder().delay });
    expect(calls).toEqual([]);
    expect(skipped.sentiment).toBeUndefined();
    expect(skipped.failures).toEqual([]);
  });
});

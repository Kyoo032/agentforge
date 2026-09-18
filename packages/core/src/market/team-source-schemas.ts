/**
 * The packet sections the analyst team reads: reported company figures,
 * insider filing counts, the crowd read from the public social venues, and the
 * fixed macro-query headlines.
 *
 * They are separate from the quote-and-chart sections because they are fetched
 * from different places, under different terms, and are read by different
 * analysts (see `team-prompts.ts`). `watch-schemas.ts` re-exports all of it,
 * so nothing outside this file has to know where a section lives.
 */
import { z } from "zod";
import { attribution } from "./watch-refs";

/** Crowd posts quoted back per ticker. A read of the mood, not a feed. */
export const SENTIMENT_SAMPLES_MAX = 6;
/** One sampled post is a headline, not a thread. */
export const SENTIMENT_SAMPLE_CHARS_MAX = 160;
/** Subreddits named in one sentiment row. */
export const SENTIMENT_SUBREDDITS_MAX = 4;
/** Macro headlines kept for the whole packet across the fixed global-news queries. */
export const GLOBAL_NEWS_MAX = 10;
/** The only insider window the packet carries. */
export const INSIDER_WINDOW = "90d";
/** The same window in days, so the guard lets the model write "the last 90 days". */
export const INSIDER_WINDOW_DAYS = 90;

/**
 * Company figures for one listing, as the provider reported them. Every field
 * is optional: a missing ratio is a ratio the provider did not give, never a
 * zero and never a derivation of ours. Nothing here is a judgement — no
 * rating, no fair value, no target — only the reported figures the
 * fundamentals analyst reads.
 */
export const tickerFundamentalsSchema = z.object({
  sector: z.string().optional(),
  industry: z.string().optional(),
  marketCap: z.number().optional(),
  trailingPe: z.number().optional(),
  forwardPe: z.number().optional(),
  peg: z.number().optional(),
  priceToBook: z.number().optional(),
  epsTrailing: z.number().optional(),
  epsForward: z.number().optional(),
  dividendYieldPct: z.number().optional(),
  beta: z.number().optional(),
  revenueTtm: z.number().optional(),
  grossMarginPct: z.number().optional(),
  operatingMarginPct: z.number().optional(),
  profitMarginPct: z.number().optional(),
  roePct: z.number().optional(),
  roaPct: z.number().optional(),
  debtToEquity: z.number().optional(),
  currentRatio: z.number().optional(),
  freeCashflow: z.number().optional(),
  ...attribution,
});
export type TickerFundamentals = z.infer<typeof tickerFundamentalsSchema>;

/**
 * Insider transactions counted over a fixed window by the host, from dated
 * filings. Counts only: who filed is not the desk's business, and a count is
 * not a reason to do anything.
 */
export const tickerInsidersSchema = z.object({
  window: z.literal(INSIDER_WINDOW).default(INSIDER_WINDOW),
  buys: z.number().int().nonnegative(),
  sells: z.number().int().nonnegative(),
  /** Net shares across the window; negative means insiders were net sellers. */
  netShares: z.number().optional(),
  ...attribution,
});
export type TickerInsiders = z.infer<typeof tickerInsidersSchema>;

export const SENTIMENT_SAMPLE_SOURCES = ["stocktwits", "reddit"] as const;
export type SentimentSampleSource = (typeof SENTIMENT_SAMPLE_SOURCES)[number];

/**
 * One crowd post, title only, already injection-scanned and PII-masked by the
 * host. It is quoted as mood, never as data: its figures are deliberately kept
 * out of the allowed-number set (see `packet-numbers.ts`).
 */
export const sentimentSampleSchema = z.object({
  source: z.enum(SENTIMENT_SAMPLE_SOURCES),
  title: z.string().min(1).max(SENTIMENT_SAMPLE_CHARS_MAX),
  at: z.string().datetime({ offset: true }).optional(),
});
export type SentimentSample = z.infer<typeof sentimentSampleSchema>;

/**
 * The crowd read for one ticker. A missing sub-section means the venue did not
 * answer; a zero count means it answered and there was nothing. The renderer
 * keeps those two apart on purpose.
 */
export const tickerSentimentSchema = z.object({
  stocktwits: z
    .object({
      total: z.number().int().nonnegative(),
      bullish: z.number().int().nonnegative(),
      bearish: z.number().int().nonnegative(),
      sampled: z.number().int().nonnegative(),
    })
    .optional(),
  reddit: z
    .object({
      posts: z.number().int().nonnegative(),
      subreddits: z.array(z.string().min(1)).max(SENTIMENT_SUBREDDITS_MAX).default([]),
    })
    .optional(),
  samples: z.array(sentimentSampleSchema).max(SENTIMENT_SAMPLES_MAX).default([]),
  observedAt: z.string().datetime({ offset: true }),
});
export type TickerSentiment = z.infer<typeof tickerSentimentSchema>;

/**
 * One macro headline fetched for a fixed query (see `global-news-queries.ts`).
 * It carries its own query so the desk can say which lens surfaced it.
 */
export const globalNewsItemSchema = z.object({
  title: z.string().min(1),
  publisher: z.string().optional(),
  at: z.string().datetime({ offset: true }).optional(),
  query: z.string().min(1),
});
export type GlobalNewsItem = z.infer<typeof globalNewsItemSchema>;

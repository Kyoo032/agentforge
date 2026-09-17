/**
 * Attribution primitives every Market Watch packet row carries: which provider
 * a figure came from and when it was observed.
 *
 * They live apart from `watch-schemas.ts` so a section file can be written
 * against them without importing the whole packet — and so the packet file
 * stays readable. `watch-schemas.ts` re-exports everything here, which is
 * still the import path for the rest of the codebase.
 */
import { z } from "zod";
import { httpUrlSchema } from "./schemas";

export const WATCH_SOURCES = ["yahoo", "tradingview", "computed", "rss", "web"] as const;
export type WatchSource = (typeof WATCH_SOURCES)[number];

export const watchRefSchema = z.object({
  source: z.enum(WATCH_SOURCES),
  sourceUrl: httpUrlSchema,
  observedAt: z.string().datetime({ offset: true }),
});
export type WatchRef = z.infer<typeof watchRefSchema>;

/**
 * Attribution carried by the harness sections that are not a row per venue
 * quote: which provider the figures came from and when they were observed.
 * Same promise as `watchRefSchema`, without a per-field landing URL.
 */
export const attribution = {
  source: z.enum(WATCH_SOURCES),
  observedAt: z.string().datetime({ offset: true }),
};

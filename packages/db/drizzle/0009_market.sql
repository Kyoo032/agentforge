CREATE TABLE IF NOT EXISTS `market_cache` (
  `id` text PRIMARY KEY NOT NULL,
  `ticker` text NOT NULL,
  `kind` text NOT NULL,
  `payload` text NOT NULL,
  `source_ref` text NOT NULL,
  `observed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `market_cache_ticker_kind_idx` ON `market_cache` (`ticker`,`kind`,`observed_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `market_news_fts` USING fts5(
  ticker,
  title,
  summary,
  link UNINDEXED,
  published_at UNINDEXED
);

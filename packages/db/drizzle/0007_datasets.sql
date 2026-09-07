CREATE TABLE IF NOT EXISTS `datasets` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `name` text NOT NULL,
  `filename` text NOT NULL,
  `rows` integer NOT NULL,
  `cols` integer NOT NULL,
  `columns` text NOT NULL,
  `storage_path` text NOT NULL,
  `size_bytes` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `datasets_ws_idx` ON `datasets` (`workspace_id`,`created_at`);

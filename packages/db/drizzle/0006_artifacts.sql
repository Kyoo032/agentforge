CREATE TABLE IF NOT EXISTS `artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `mode` text NOT NULL,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `mime` text NOT NULL,
  `body` text NOT NULL,
  `meta` text NOT NULL,
  `size_bytes` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `artifacts_ws_mode_idx` ON `artifacts` (`workspace_id`,`mode`,`created_at`);

-- One row per chunk a run was actually given: the measured "Retrieved" edge of the knowledge loop
-- and the first retrieval graph edge (source -> thread). `backend` records which engine served it.
CREATE TABLE IF NOT EXISTS `knowledge_retrievals` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `thread_id` text,
  `run_id` text,
  `source_id` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `score` real NOT NULL,
  `backend` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_retrievals_ws_created_idx` ON `knowledge_retrievals` (`workspace_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_retrievals_ws_source_idx` ON `knowledge_retrievals` (`workspace_id`,`source_id`);

-- Work-origin columns on knowledge_sources (origin_kind / origin_id, unique per workspace).
-- SQLite has no ALTER TABLE IF EXISTS and a DB whose journal was stamped past 0003 may not have
-- the table yet, so this file only guarantees the table shape for fresh installs; ensure-schema
-- (`ensureKnowledgeSourceOrigin`) adds the columns and the unique index to existing tables.
CREATE TABLE IF NOT EXISTS `knowledge_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `status` text NOT NULL,
  `chunks` integer NOT NULL DEFAULT 0,
  `error` text,
  `created_at` integer NOT NULL,
  `origin_kind` text,
  `origin_id` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_sources_ws_idx` ON `knowledge_sources` (`workspace_id`);

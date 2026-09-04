CREATE TABLE `knowledge_soul` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `role` text NOT NULL,
  `voice` text NOT NULL,
  `rules` text NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `knowledge_memories` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `text` text NOT NULL,
  `pinned` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL
);

CREATE INDEX `knowledge_memories_ws_idx` ON `knowledge_memories` (`workspace_id`);

CREATE TABLE `knowledge_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `name` text NOT NULL,
  `type` text NOT NULL,
  `status` text NOT NULL,
  `chunks` integer NOT NULL DEFAULT 0,
  `error` text,
  `created_at` integer NOT NULL
);

CREATE INDEX `knowledge_sources_ws_idx` ON `knowledge_sources` (`workspace_id`);

CREATE VIRTUAL TABLE `knowledge_chunks` USING fts5(
  source_id,
  workspace_id,
  body
);

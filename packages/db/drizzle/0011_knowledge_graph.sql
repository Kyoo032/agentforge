-- The Graph and Verified stages of the knowledge loop.
-- Nodes are topics, sources and threads; edges are `covers` (topic -> source, from the knowledge
-- map), `retrieved` (source -> thread, aggregated from knowledge_retrievals) and `cites` (Phase 4).
-- Edges are aggregated by weight, not appended per event, so the composite key is the whole point.
CREATE TABLE IF NOT EXISTS `knowledge_graph_nodes` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `kind` text NOT NULL,
  `label` text NOT NULL,
  `payload` text,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_graph_nodes_ws_kind_idx` ON `knowledge_graph_nodes` (`workspace_id`,`kind`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `knowledge_graph_edges` (
  `workspace_id` text NOT NULL,
  `from_id` text NOT NULL,
  `to_id` text NOT NULL,
  `kind` text NOT NULL,
  `weight` real DEFAULT 1 NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY(`workspace_id`, `from_id`, `to_id`, `kind`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_graph_edges_ws_kind_idx` ON `knowledge_graph_edges` (`workspace_id`,`kind`);
--> statement-breakpoint
-- Last planted-fact self-check per workspace: the Verified stage of the loop chart.
CREATE TABLE IF NOT EXISTS `knowledge_verify` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `ok` integer NOT NULL,
  `detail` text NOT NULL,
  `created_at` integer NOT NULL
);

-- Hybrid retrieval resolves which embedding model's vectors answer a query (COUNT(*) per model)
-- and then reads that model's rows. Both are (workspace_id, model) lookups, and until now the only
-- index on knowledge_vectors was (workspace_id, source_id), so both fell back to a table scan of
-- every vector the workspace holds — on the hot path of every chat message.
--
-- The table is (re)declared defensively, exactly as 0010 and 0011 declare theirs: a database that
-- was baseline-stamped past 0004 has the journal row but not necessarily the table, and a migration
-- that assumes an earlier one really ran turns that into a hard failure at startup.
CREATE TABLE IF NOT EXISTS `knowledge_vectors` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `source_id` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `body` text NOT NULL,
  `embedding` text NOT NULL,
  `model` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_vectors_ws_model_idx` ON `knowledge_vectors` (`workspace_id`,`model`);

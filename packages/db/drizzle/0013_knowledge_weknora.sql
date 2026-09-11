-- Phase 3: the bookkeeping a remote retrieval backend (WeKnora) needs, and nothing more.
--
-- The architectural line is unchanged: `knowledge_sources` / `knowledge_chunks` stay the system of
-- record, so every table here is *derived* state that can be rebuilt from them.
-- `knowledge_workspace_backend` is the per-desk binding (which KB, which embedding model row, and
-- which gateway credentials that row was created for), and `knowledge_backend_outbox` is the queue
-- of writes the backend could not accept while it was down.
--
-- The tables are (re)declared defensively, exactly as 0010-0012 declare theirs: a database that was
-- baseline-stamped past 0004 has the journal row but not necessarily the table, and a migration
-- that assumes an earlier one really ran turns that into a hard failure at startup.
--
-- `knowledge_sources.external_id` is deliberately *not* added here. SQLite has no
-- `ADD COLUMN IF NOT EXISTS`, so a bare `ALTER TABLE` makes this file fail on its second
-- application (a re-stamped journal, a repaired install, a test that migrates twice). The column is
-- owned by `ensure-schema.ts`, which adds it only when `PRAGMA table_info` says it is missing —
-- the same arrangement 0008 uses for `knowledge_sources.origin_kind`. Its index lives there too,
-- because an index on a column this file does not create cannot be created here either.
-- One row per workspace: which backend owns its vectors, the KB id inside that backend, and the
-- backend-side model row the KB is bound to. `embedding_model` is our model id, kept so a model
-- change is detectable (it forces an explicit re-index rather than silently mixing geometries).
-- `gateway_base_url` / `gateway_key_fp` are what the model row's stored credentials were minted
-- from, so a desk that bootstrapped offline (empty key) is detectably bound to a dead model row.
CREATE TABLE IF NOT EXISTS `knowledge_workspace_backend` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `backend_id` text NOT NULL,
  `kb_id` text,
  `model_id` text,
  `embedding_model` text,
  `gateway_base_url` text,
  `gateway_key_fp` text,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
-- Writes the backend could not accept. Drained on the next health-OK transition and on
-- GET /api/v1/knowledge, so a sidecar that was down never silently loses an ingest or a delete.
CREATE TABLE IF NOT EXISTS `knowledge_backend_outbox` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `op` text NOT NULL,
  `source_id` text NOT NULL,
  `external_id` text,
  `payload` text,
  `attempts` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_backend_outbox_ws_idx` ON `knowledge_backend_outbox` (`workspace_id`,`created_at`);

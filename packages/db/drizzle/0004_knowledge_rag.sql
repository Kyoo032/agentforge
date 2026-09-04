CREATE TABLE `knowledge_settings` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `embedding_model` text NOT NULL,
  `brain_model` text NOT NULL,
  `verifier_model` text NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE TABLE `knowledge_vectors` (
  `id` text PRIMARY KEY NOT NULL,
  `workspace_id` text NOT NULL,
  `source_id` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `body` text NOT NULL,
  `embedding` text NOT NULL,
  `model` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE INDEX `knowledge_vectors_ws_source_idx` ON `knowledge_vectors` (`workspace_id`, `source_id`);

CREATE TABLE `knowledge_maps` (
  `workspace_id` text PRIMARY KEY NOT NULL,
  `payload` text NOT NULL,
  `status` text NOT NULL,
  `error` text,
  `created_at` integer NOT NULL
);

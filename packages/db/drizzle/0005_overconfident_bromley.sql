CREATE TABLE `edit_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`fps` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`review_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edit_projects_org_ws_idx` ON `edit_projects` (`organization_id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `edit_ops` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`seq` integer NOT NULL,
	`parent` text,
	`clock` integer NOT NULL,
	`actor` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`inverse_json` text,
	`card_id` text,
	`undo_of` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `edit_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `edit_ops_project_seq` ON `edit_ops` (`project_id`,`seq`);--> statement-breakpoint
CREATE TABLE `edit_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`up_to_seq` integer NOT NULL,
	`doc_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `edit_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edit_snapshots_project_seq_idx` ON `edit_snapshots` (`project_id`,`up_to_seq`);--> statement-breakpoint
CREATE TABLE `edit_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`target_clip_ids_json` text NOT NULL,
	`card_id` text,
	`request_json` text NOT NULL,
	`model` text,
	`tier` text,
	`estimate_usd` real,
	`actual_usd` real,
	`progress` real DEFAULT 0 NOT NULL,
	`output_asset_ids_json` text,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`cancel_requested_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `edit_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edit_jobs_project_status_idx` ON `edit_jobs` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `edit_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`tool_key` text NOT NULL,
	`verb` text NOT NULL,
	`object` text NOT NULL,
	`op_ids_json` text NOT NULL,
	`job_id` text,
	`status` text NOT NULL,
	`thumbs_json` text NOT NULL,
	`estimate_usd` real,
	`tier` text,
	`created_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `edit_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edit_cards_project_status_idx` ON `edit_cards` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `edit_unplaced` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`job_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`prompt` text,
	`created_at` integer NOT NULL,
	`placed_clip_id` text,
	`discarded_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `edit_projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `edit_unplaced_project_idx` ON `edit_unplaced` (`project_id`);

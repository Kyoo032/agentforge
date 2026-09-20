-- Phase 3: tenancy in the schema (docs/internal/web-phase3-tenancy-spec.md §4, lane B).
--
-- One `tenants` table and one `tenant_id` column on `organizations`. Nothing else gains a column:
-- every table holding user data already reaches an organization directly or through
-- `workspaces.organization_id` / `edit_projects.organization_id`, so `organizations.tenant_id` is
-- the single hop that puts every row inside a tenant.
--
-- Additive only. It touches neither `user`, `organizations.id`, `workspaces` nor any content table,
-- so an existing desktop database opens with no re-seed: `ensureLocalOwner` still finds its org by
-- slug and its owner by id.
--
-- ONE-WAY. The runner in `ensure-schema.ts` is forward-only and has no `down`; SQLite before 3.35
-- cannot drop a column at all. Recovering from a bad 0015 means restoring the data volume.
--
-- Declared defensively (`IF NOT EXISTS`), like 0010-0014: a database baseline-stamped past this
-- point has the journal row without the table, and `ensureTenantTables` in `ensure-schema.ts`
-- re-creates it there. Times are epoch milliseconds, as everywhere else in this schema.
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'active',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tenants_slug_unique` ON `tenants` (`slug`);
--> statement-breakpoint
-- The one tenant every pre-Phase-3 database resolves to. Deterministic id: a desktop that has
-- already migrated and a fresh install must agree, and nothing downstream may see a UUID here.
INSERT OR IGNORE INTO `tenants` (`id`, `slug`, `name`, `status`, `created_at`)
VALUES ('local-tenant', 'local', 'Local', 'active', CAST(strftime('%s','now') AS INTEGER) * 1000);
--> statement-breakpoint
-- SQLite cannot ADD COLUMN ... NOT NULL REFERENCES without a default, so the column lands
-- nullable, is backfilled below, and the NOT NULL is enforced by the drizzle type plus
-- migrate-0015.test.ts.
ALTER TABLE `organizations` ADD `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE cascade;
--> statement-breakpoint
UPDATE `organizations` SET `tenant_id` = 'local-tenant' WHERE `tenant_id` IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `organizations_tenant_idx` ON `organizations` (`tenant_id`);
--> statement-breakpoint
-- `organizations.slug` was globally unique (0000_smiling_skin.sql:91). With many tenants, two
-- tenants both having a "personal" org is normal, so uniqueness moves onto (tenant_id, slug).
DROP INDEX IF EXISTS `organizations_slug_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `organizations_tenant_slug` ON `organizations` (`tenant_id`,`slug`);

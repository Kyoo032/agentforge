-- Phase 5 lane A: the tenant usage ledger
-- (docs/internal/web-phase5-plans-billing-decisions.md §4, lane A; docs/internal/web-phase5-lane-a.md).
--
-- Before this migration, spend landed in two stores and one whole class of spend landed in neither:
-- chat runs in `runs.usage` (org-scoped), edit-agent and job regen in a single untenanted
-- `desk-usage.json` on disk, and images and videos nowhere at all. No allowance can be enforced
-- against that, so this table becomes the one ledger every gateway call writes to.
--
-- ONE ROW PER GATEWAY CALL. `runs.usage` is untouched and still carries the per-run detail on the
-- run row; this table is the tenant-scoped ledger the allowance reads. Chat therefore appears in
-- both, by design — `runs.usage` is a property of a run, `tenant_usage` is a billable event.
--
-- UNPRICED IS A ROW, NOT AN ABSENCE. `cost_usd_micros` is nullable and `unpriced_reason` says why:
-- an allowance that cannot see a call undercounts silently, one that sees `null` undercounts
-- visibly and can refuse. A later repricing pass closes the `catalog_unavailable` rows in place.
--
-- ONE-WAY. The runner in `ensure-schema.ts` is forward-only and has no `down`. Additive only: it
-- creates one table and touches nothing existing, so a desktop database opens with no re-seed and
-- an un-metered desktop simply has an empty ledger.
--
-- Declared defensively (`IF NOT EXISTS`), like 0010-0015: a database baseline-stamped past this
-- point has the journal row without the table, and `ensureTenantUsageTable` in `ensure-schema.ts`
-- re-creates it there. Times are epoch milliseconds, as everywhere else in this schema.
CREATE TABLE IF NOT EXISTS `tenant_usage` (
  `id` text PRIMARY KEY NOT NULL,
  -- Cascades: a tenant that is deleted takes its own ledger with it.
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  -- Deliberately NOT a foreign key to `organizations`. Everything else in this schema cascades off
  -- an organization, but a ledger must not: deleting one org inside a live tenant would erase spend
  -- that still has to be billed for the period. The column is the org's id, kept as plain text.
  `organization_id` text NOT NULL,
  `workspace_id` text,
  -- Null where the call has no user behind it (a scheduled regen, a desktop with no session).
  `user_id` text,
  -- chat | documents | presentations | research | data | finance | market | legal | knowledge
  -- | images | videos | music | meetings | edit | other.
  -- See USAGE_MODES in packages/core/src/usage/metering.ts.
  `mode` text NOT NULL,
  -- The gateway model id that actually answered, never the one that was asked for.
  `model` text NOT NULL,
  -- tokens | images | seconds | jobs. One row carries exactly one unit; only `cost_usd_micros` is
  -- comparable across units, which is the other reason it is recorded even when it is null.
  `unit` text NOT NULL,
  `quantity` integer NOT NULL,
  -- Meaningful only on a `tokens` row; 0 on media rows.
  `input_tokens` integer DEFAULT 0 NOT NULL,
  `output_tokens` integer DEFAULT 0 NOT NULL,
  -- Integer millionths of a USD. Never a float: an allowance decremented in floats bills the
  -- wrong number. Null means unpriced, and then `unpriced_reason` is set.
  `cost_usd_micros` integer,
  -- catalog_unavailable | model_not_in_catalog | tiered_billing | no_list_price | usage_unknown.
  -- See UNPRICED_REASONS in packages/core/src/usage/metering.ts.
  `unpriced_reason` text,
  `run_id` text,
  `at` integer NOT NULL
);
--> statement-breakpoint
-- The allowance query is "this tenant, this period", so this is the index it rides on. The plan
-- lane (B) maintains a period counter on top of it rather than re-summing per gateway call.
CREATE INDEX IF NOT EXISTS `tenant_usage_tenant_at_idx` ON `tenant_usage` (`tenant_id`,`at`);
--> statement-breakpoint
-- The account screen splits spend by mode, and the reprice pass scans by mode and unit.
CREATE INDEX IF NOT EXISTS `tenant_usage_tenant_mode_idx` ON `tenant_usage` (`tenant_id`,`mode`,`at`);
--> statement-breakpoint
-- Finding the rows a later repricing pass has to close, without scanning the whole ledger.
CREATE INDEX IF NOT EXISTS `tenant_usage_unpriced_idx` ON `tenant_usage` (`unpriced_reason`,`at`);

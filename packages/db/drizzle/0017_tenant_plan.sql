-- Phase 5 lane B: what a tenant is entitled to
-- (docs/internal/web-migration-plan.md Phase 5; docs/internal/web-phase5-plans-billing-decisions.md
--  §4 lane B; docs/internal/web-phase5-lane-b.md).
--
-- Lane A gave every gateway call a tenant-scoped, priced row in `tenant_usage`. It records; it
-- refuses nothing. This migration adds the three things an allowance and a seat cap need to exist
-- at all, and one column on the ledger so the two can be reconciled.
--
-- NUMBERING, AND WHY THE JOURNAL LOOKS ODD. Phase 4 took `0018` while `0017` was reserved for this
-- lane, leaving a gap at idx 17 (see the header of 0018_tenant_state.sql). The runner in
-- `ensure-schema.ts` is forward-only on `when`, NOT on idx: it applies a migration only when
-- `lastAppliedCreatedAt < entry.when`. So this file carries `when` 1788820000011 — ABOVE 0018's
-- 1788820000010 — and its journal entry sits LAST in the entries array, after 0018, so the array
-- order and the `when` order agree. A `when` below 0018's would be silently skipped on every
-- database that has already run 0018, and the ALTER below would never happen.
-- `packages/db/src/migrate-0018.test.ts` asserts that ordering, and migrate-0017.test.ts asserts
-- the array position.
--
-- ONE-WAY. Forward-only, no `down`. Additive: three new tables and one nullable column.
--
-- Declared defensively (`IF NOT EXISTS`), like 0010-0018: a database baseline-stamped past this
-- point has the journal row without the tables, and `ensureTenantPlanTables` in `ensure-schema.ts`
-- re-creates them there. Times are epoch milliseconds, as everywhere else in this schema.

-- The entitlement itself: ONE ROW PER TENANT, so the tenant id is the primary key and there is no
-- surrogate. A tenant with no row is not blocked — it behaves exactly as the product behaved
-- before Phase 5 existed (`defaultPlanRecord` in packages/core/src/entitlement/types.ts). That is
-- this lane's own done-when: the desktop must open an existing database and notice nothing.
CREATE TABLE IF NOT EXISTS `tenant_plan` (
  -- Cascades: an entitlement is a property of the tenant and must not outlive it. The ledger makes
  -- the opposite choice on purpose, because spend has to outlive what it billed for.
  `tenant_id` text PRIMARY KEY NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  -- personal | enterprise. See PLAN_KINDS in packages/core/src/entitlement/types.ts.
  `kind` text NOT NULL DEFAULT 'personal',
  -- active | past_due | cancelled. The billing webhook is the ONLY writer of this column.
  `status` text NOT NULL DEFAULT 'active',
  -- Integer millionths of a USD of GATEWAY COST — the same unit the ledger records, because the
  -- allowance is compared against the ledger (decision doc D2). NULL means no allowance is
  -- enforced: spend is still recorded, and nothing is ever refused for it.
  `allowance_usd_micros` integer,
  -- Gateway cost accrued THIS PERIOD, maintained on every ledger write rather than re-summed per
  -- gateway call (decision doc §3(a): a SUM on the request path is a scan per call). The audit is
  -- `SELECT SUM(cost_usd_micros) FROM tenant_usage WHERE tenant_id = ? AND billing_period_start = ?`,
  -- which is what the column added at the bottom of this file exists for.
  `spent_usd_micros` integer DEFAULT 0 NOT NULL,
  -- Ledger rows this period that nobody could price. They count as ZERO against the allowance and
  -- are surfaced as a warning instead, so a tenant is never blocked by a row the host cannot price
  -- and never silently under-counted either. This is the answer lane A left open.
  `unpriced_count` integer DEFAULT 0 NOT NULL,
  -- The billing period, epoch ms: `period_start <= at < period_end`. The default is the calendar
  -- month in UTC; an anniversary period is the same two columns written by a different function,
  -- which is why kyo can still change D2's answer without a migration.
  `period_start` integer NOT NULL,
  `period_end` integer NOT NULL,
  -- NULL on Personal, where a seat cap is meaningless (decision doc D2), and NULL for any tenant
  -- the webhook has not spoken about. NULL admits everybody: a refusal is never invented by the
  -- absence of a number.
  `seat_cap` integer,
  -- What the subscription CHARGES per unit of gateway cost, in micros; 1000000 is 1.0, which is
  -- pass-through and the default until kyo names a margin. It takes no part in the block decision
  -- — multiplying the counter by a margin would put a rounding error between the ledger and the
  -- counter for nothing. See `quotedPriceUsdMicros`.
  `margin_multiple_micros` integer DEFAULT 1000000 NOT NULL,
  -- ISO 4217, for display and invoicing. The two micro columns above are always USD.
  `currency` text DEFAULT 'USD' NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
-- A seat, held until an admin revokes it (decision doc D5(b)). NOT derived from session activity:
-- the portal's 30-day rule and a host-side re-implementation of it would drift, and a member back
-- from 31 days' leave would be refused through no fault of theirs. A revoked seat keeps its row so
-- an admin screen can show who was revoked and when, rather than a deletion nobody can explain.
CREATE TABLE IF NOT EXISTS `tenant_seat` (
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  `user_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `claimed_at` integer NOT NULL,
  -- NULL means the seat is held. A held seat is what the cap counts.
  `revoked_at` integer,
  `revoked_by` text,
  PRIMARY KEY (`tenant_id`, `user_id`)
);
--> statement-breakpoint
-- The one query sign-in runs: how many of this tenant's seats are still held.
CREATE INDEX IF NOT EXISTS `tenant_seat_live_idx` ON `tenant_seat` (`tenant_id`,`revoked_at`);
--> statement-breakpoint
-- Webhook idempotency. Every provider retries — Xendit up to six times — and the webhook is the
-- only writer of `tenant_plan.status`, so a replayed delivery must be a no-op rather than a second
-- write. The provider's own event id is the key; nothing here is ever generated host-side.
--
-- `tenant_id` deliberately carries NO foreign key. An event can arrive for a tenant this host has
-- not provisioned yet (the portal signs somebody up before they first sign in), and dropping that
-- delivery on a foreign-key error would make the route un-replayable: the provider would retire
-- the event and the plan would never land. It is stored with `applied` = 0 instead, so the row is
-- still the idempotency record and an operator can see what could not be applied and why.
CREATE TABLE IF NOT EXISTS `billing_events` (
  `event_id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  -- entitlement.set | allowance.topup | period.reset.
  -- See BILLING_EVENT_KINDS in packages/core/src/entitlement/webhook.ts.
  `kind` text NOT NULL,
  `occurred_at` integer NOT NULL,
  `received_at` integer NOT NULL,
  -- 1 when it changed the plan row, 0 when it was stored but not applied (`detail` says why).
  `applied` integer DEFAULT 0 NOT NULL,
  `detail` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `billing_events_tenant_idx` ON `billing_events` (`tenant_id`,`received_at`);
--> statement-breakpoint
-- The net under the ALTER below. On every database that ran 0016 this is a no-op; on one that was
-- baseline-stamped past 0016 without the table, it is the difference between this migration
-- applying and the whole transaction aborting on `ALTER TABLE` against a table that is not there.
-- Byte-identical to 0016_tenant_usage.sql's own CREATE, minus that file's commentary.
CREATE TABLE IF NOT EXISTS `tenant_usage` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  `organization_id` text NOT NULL,
  `workspace_id` text,
  `user_id` text,
  `mode` text NOT NULL,
  `model` text NOT NULL,
  `unit` text NOT NULL,
  `quantity` integer NOT NULL,
  `input_tokens` integer DEFAULT 0 NOT NULL,
  `output_tokens` integer DEFAULT 0 NOT NULL,
  `cost_usd_micros` integer,
  `unpriced_reason` text,
  `run_id` text,
  `at` integer NOT NULL
);
--> statement-breakpoint
-- THE LEDGER GAINS THE PERIOD IT WAS COUNTED AGAINST.
--
-- Without it the only way to reconcile `tenant_plan.spent_usd_micros` against the ledger is to
-- re-derive the period from `at`, which stops being true the moment a period boundary moves — a
-- webhook that sets `period_start` mid-month, or a plan that changes from calendar to anniversary.
-- Stamping the period on the row makes the audit an equality rather than a guess, and it is also
-- what a later repricing pass needs in order to know which period's counter to correct.
--
-- Nullable, and NULL on every row written before this migration: those rows were counted against
-- nothing, because nothing was counting. SQLite cannot ADD COLUMN ... NOT NULL without a default,
-- and a default here would claim a period for rows that never had one.
ALTER TABLE `tenant_usage` ADD `billing_period_start` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tenant_usage_period_idx` ON `tenant_usage` (`tenant_id`,`billing_period_start`);

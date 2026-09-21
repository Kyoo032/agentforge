-- Phase 8: who erased a tenant, and when
-- (docs/internal/web-migration-plan.md Phase 8; docs/internal/web-phase8-hosted-surfaces.md).
--
-- Phase 8 gives a hosted tenant the hosted answer to "Start over": a per-tenant reset that wipes
-- the caller's own rows, their storage prefix, their secrets and their gate verdict, and touches
-- nobody else's. "Start over" itself stays refused on a server, because it wipes the data
-- directory the whole box shares (docs/internal/web-security-spec.md, row T8).
--
-- WHY AN AUDIT ROW AT ALL. The reset is the most destructive thing a signed-in tenant can do, it
-- is self-serve, and by construction it destroys the evidence of itself: after it runs there are
-- no threads, no runs and no media to reconstruct what was there. Without a row the operator's
-- only record of a tenant erasing their account is an application log line, which rotates. Support
-- tickets that start "everything is gone" need an answer better than "we think you did that".
--
-- WHAT IT IS NOT. It is not a backup and not an undo — nothing here can restore a byte. It records
-- that the act happened, who asked, and how much went; the rows and the objects are gone.
--
-- IT SURVIVES THE THING IT RECORDS. The reset deletes the tenant's `organizations` row, which
-- cascades through workspaces, threads, runs and media. This table hangs off `tenants`, which the
-- reset deliberately KEEPS (along with `tenant_plan`, `tenant_seat`, `billing_events` and
-- `tenant_usage` — a tenant must not be able to erase what they owe by pressing a button), so its
-- rows outlive every reset but one: deleting the tenant itself. That is an operator action and it
-- is right that the audit trail goes with the tenant.
--
-- `user_id` CARRIES NO FOREIGN KEY, for the same reason `tenant_usage.organization_id` does not
-- (drizzle/0016_tenant_usage.sql): the reset removes `organization_members` rows, and on a
-- deployment where the portal later removes the `user` row too, a foreign key would either cascade
-- the audit row away or refuse the delete. The id is recorded as a fact, not as a live reference.
--
-- `outcome` IS A STRING, NOT A BOOLEAN. A reset that got half way through — the database wiped and
-- the bucket prefix refused — is neither a success nor a no-op, and the operator reading this
-- needs to know which. `started` is written before anything is deleted and updated in place, so a
-- process killed mid-reset leaves a `started` row rather than no row at all, which is exactly the
-- case a support ticket is about. The reset is idempotent and safe to retry, so a `started` row is
-- a prompt to run it again, never a lock.
--
-- ONE-WAY. The runner in `ensure-schema.ts` is forward-only and has no `down`. Additive: one new
-- table, nothing existing is altered.
--
-- NUMBERING. The runner applies a migration only when `lastAppliedCreatedAt < entry.when`, so the
-- `when` is what decides what runs and `idx` is cosmetic. Phase 4 took 0018 with `when`
-- 1788820000010, Phase 5 lane B took 0017 with 1788820000011 and Phase 6 took 0019 with
-- 1788820000012 (which is why the journal's idx column reads 18, 17, 19). This file therefore
-- carries 1788820000013 — above all three — and its journal entry sits last.
-- `packages/db/src/migrate-0018.test.ts` asserts that ordering rule and `migrate-0020.test.ts`
-- asserts this file's place in it.
--
-- Declared defensively (`IF NOT EXISTS`), like 0010-0019: a database baseline-stamped past this
-- point has the journal row without the table, and `ensureTenantResetAuditTable` in
-- `ensure-schema.ts` mirrors this statement for exactly that case.

CREATE TABLE IF NOT EXISTS `tenant_reset_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`outcome` text NOT NULL,
	`detail` text,
	`rows_deleted` integer DEFAULT 0 NOT NULL,
	`objects_deleted` integer DEFAULT 0 NOT NULL,
	`bytes_freed` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tenant_reset_audit_tenant_idx` ON `tenant_reset_audit` (`tenant_id`,`started_at`);

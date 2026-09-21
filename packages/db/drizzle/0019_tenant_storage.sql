-- Phase 6: how many bytes a tenant is holding
-- (docs/internal/web-migration-plan.md Phase 6; docs/internal/web-phase6-tenant-storage.md).
--
-- Phase 3 lane D gave every tenant a disjoint subtree; Phase 6 puts those bytes behind one storage
-- interface with a COS backend, and a quota can only be enforced against a number somebody keeps.
-- This table is that number.
--
-- WHY A COUNTER AND NOT A SUM. The two obvious alternatives both cost a scan on the write path.
-- `SELECT SUM(size_bytes) FROM media WHERE …` misses every byte that is not a media row (the edit
-- scratch tree, dataset files) and still scans; walking the tenant's directory is O(files) per
-- upload on a desk and a paginated LIST call per upload against COS, where listing is billed per
-- request. So the counter is maintained on every write and delete, exactly as
-- `tenant_plan.spent_usd_micros` is maintained on every ledger write (0017_tenant_plan.sql), and
-- `measured_at` records when it was last reconciled against the real backend.
--
-- THE COUNTER IS NOT THE TRUTH, THE BACKEND IS. `recomputeTenantStorage` in
-- packages/host/src/tenant-storage.ts re-measures a tenant from the backend and overwrites
-- both columns; a fresh tenant is seeded by a measure on its first write rather than starting at
-- zero, so an upgrade does not pretend an existing tree is empty. A drift between the two is an
-- operator's problem to reconcile, not a reason to refuse a write.
--
-- ONE ROW PER TENANT, so the tenant id is the primary key and there is no surrogate. A tenant with
-- no row is holding nothing this host has counted — which is also exactly what a fresh tenant is.
--
-- DESKTOP IS NOT AFFECTED. `tenantStorageLimitBytes` returns null off server mode
-- (packages/core/src/storage/quota.ts), so a desk enforces nothing, and the storage route measures
-- the tree directly rather than reading this table. On a desktop database it stays empty.
--
-- ONE-WAY. The runner in `ensure-schema.ts` is forward-only and has no `down`. Additive: one new
-- table, nothing existing is altered.
--
-- NUMBERING. The runner applies a migration only when `lastAppliedCreatedAt < entry.when`, so the
-- `when` is what decides what runs and `idx` is cosmetic. Phase 4 took 0018 with `when`
-- 1788820000010 and Phase 5 lane B took 0017 with 1788820000011 (which is why the journal's idx
-- column reads 18 then 17). This file therefore carries 1788820000012 — above both — and its
-- journal entry sits last. `packages/db/src/migrate-0018.test.ts` asserts that ordering rule and
-- `migrate-0019.test.ts` asserts this file's place in it.
--
-- Declared defensively (`IF NOT EXISTS`), like 0010-0018: a database baseline-stamped past this
-- point has the journal row without the table, and `ensureTenantStorageTable` in `ensure-schema.ts`
-- re-creates it there. Times are epoch milliseconds, as everywhere else in this schema.
CREATE TABLE IF NOT EXISTS `tenant_storage` (
  -- Cascades, like `tenant_state` and unlike `tenant_usage`: a byte count is a property of the
  -- tenant and has no meaning once the tenant is gone. The ledger makes the opposite choice on
  -- purpose, because spend has to outlive what it billed for.
  `tenant_id` text PRIMARY KEY NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  -- Bytes held across every backend this tenant writes to. Never negative: the accounting clamps
  -- at zero rather than letting a double delete drive the counter below the floor and hand the
  -- tenant free space.
  `bytes_used` integer DEFAULT 0 NOT NULL,
  -- Objects held, for the storage screen. Not load-bearing for any refusal.
  `object_count` integer DEFAULT 0 NOT NULL,
  -- When the counter was last reconciled against a real measure of the backend (a seed on first
  -- write, or an operator's recompute). NULL means it has only ever been incremented.
  `measured_at` integer,
  `updated_at` integer NOT NULL
);

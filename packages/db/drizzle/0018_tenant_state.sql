-- Phase 4: per-tenant secrets and gate state as rows
-- (docs/internal/web-migration-plan.md, Phase 4; docs/internal/web-phase4-tenant-secrets.md).
--
-- Phase 3 lane D gave every tenant its own `settings.enc` and `gateway-gate.json` under
-- `tenants/<id>/`. That is a per-tenant FILE layout on a box whose disk is the deployment's most
-- fragile part: a container rebuild without the data volume mounted loses every tenant's key, and
-- two app processes behind the proxy write the same file with no lock. Phase 4 moves the same two
-- payloads into rows so the database that already holds the tenant holds the tenant's state.
--
-- WHAT IS IN `value`. Byte for byte what the file held. For `settings` that is the JSON envelope
-- from packages/core/src/crypto/envelope.ts, sealed with `getLocalVaultKey()` exactly as before —
-- the wrap key, the algorithm and the payload shape are all unchanged, so the rotation drill in
-- packages/host/src/wrap-key-rotation.ts works the same against a row and against a file. For
-- `gateway_gate` it is the plain JSON verdict, which carries a key FINGERPRINT and never a key.
--
-- ONE ROW PER (tenant, key). The composite primary key is the whole uniqueness rule; there is no
-- surrogate id, because there is nothing to reference this table by.
--
-- DESKTOP IS NOT AFFECTED. The file backend stays the desktop's backend and keeps the exact paths
-- lane D established, so an existing data directory opens with nothing moved and this table simply
-- stays empty. Only server mode (`AGENTFORGE_SERVER=1`) reads and writes rows.
--
-- ONE-WAY. The runner in `ensure-schema.ts` is forward-only and has no `down`. Additive only: it
-- creates one table and touches nothing existing, `tenant_usage` least of all — that table belongs
-- to Phase 5 lane A and lane B alters it.
--
-- NUMBERING, AND A HAZARD FOR PHASE 5 LANE B. `0017` is reserved for Phase 5 lane B, which had not
-- merged when this landed, so this migration takes `0018` and the journal has a gap at idx 17.
-- The runner applies a migration only when `lastAppliedCreatedAt < entry.when`, so a `0017` added
-- LATER with a `when` below this file's would be SKIPPED on any database that already ran this
-- one. Lane B must therefore give its migration a `when` ABOVE 1788820000010, whatever tag it
-- carries; `ensureTenantUsageTable`-style healers in `ensure-schema.ts` are the net if it does not.
--
-- Declared defensively (`IF NOT EXISTS`), like 0010-0016: a database baseline-stamped past this
-- point has the journal row without the table, and `ensureTenantStateTable` in `ensure-schema.ts`
-- re-creates it there. Times are epoch milliseconds, as everywhere else in this schema.
CREATE TABLE IF NOT EXISTS `tenant_state` (
  -- Cascades: a tenant that is deleted takes its secrets and its gate verdict with it. That is the
  -- opposite choice from `tenant_usage`, and deliberately so — a ledger has to outlive the rows it
  -- bills for, a sealed key must not.
  `tenant_id` text NOT NULL REFERENCES `tenants`(`id`) ON DELETE cascade,
  -- settings | gateway_gate. See TENANT_STATE_KEYS in packages/core/src/tenancy/state-keys.ts.
  `key` text NOT NULL,
  `value` text NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`tenant_id`, `key`)
);
--> statement-breakpoint
-- The rotation drill walks every tenant holding one kind of payload ("re-seal every `settings`
-- row"), which is the only query in the codebase that does not start from a tenant id.
CREATE INDEX IF NOT EXISTS `tenant_state_key_idx` ON `tenant_state` (`key`);

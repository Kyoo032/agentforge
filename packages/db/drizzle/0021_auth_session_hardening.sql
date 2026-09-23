-- Three changes to the hosted browser session (docs/internal/maps/portal-session-auth.md). One
-- migration, because all three land together and all three are about what an `auth_sessions` row
-- holds.
--
-- 1. THE ID AT REST IS A DIGEST. `id` used to be the cookie value itself, so anyone who could read
--    this table (a backup, a copied data directory) held a live session for every unexpired row.
--    From this migration on the host writes and looks up `sha256(cookie id)` as lowercase hex
--    (`hashSessionId`, packages/host/src/auth/session.ts). The cookie keeps the raw 32 random
--    bytes and nothing on disk can be replayed as one. The column keeps its name and its type;
--    only what is written into it changes.
--
-- 2. `portal_checked_at`: WHEN THE PORTAL LAST VOUCHED FOR THIS SESSION. The session gate asks the
--    portal again, by rotating the refresh token, once this is more than ten minutes old, so a
--    session the portal has revoked, a disabled user or an organisation past due ends on the host
--    too (packages/host/src/auth/portal-check.ts). Epoch milliseconds like every other time here.
--    NULL means never checked, which is due at once.
--
-- 3. `refresh_sealed`: THE PORTAL REFRESH TOKEN, SEALED, so a restart or a deploy signs nobody out
--    (owner decision 2026-09-23). AES-256-GCM through `encryptJson` under a key derived from the
--    wrap key with HKDF-SHA256, info `auth-session-refresh-v1`
--    (packages/host/src/auth/session-secrets.ts). The sealed payload names this row's id digest,
--    so a blob moved to another row does not open. The access token is never stored. NULL means
--    none: the row is revoked, idled out, or its browser signed in before this column existed.
--    `packages/host/src/wrap-key-rotation.ts` re-seals it.
--
-- EVERY EXISTING ROW GOES. Each one is keyed by a raw cookie id, and after this migration no lookup
-- can match it again because the host looks up the digest. The rows are already dead as sessions;
-- dropping them takes the last replayable ids off disk instead of leaving them for the 30-day
-- purge. The cost: every signed-in browser signs in once more. The desktop app and webdev never
-- write this table, so there nothing is lost.
--
-- REBUILT, NOT ALTERED. Since every row goes anyway, the table is dropped and created again in
-- its new shape, with both of 0014's indexes. An `ALTER TABLE ... ADD` cannot be replayed: on a
-- database whose journal was rewound past this file it meets a column that is already there and
-- aborts the boot (the 0017 and 0018 suites build exactly that database). Nothing references this
-- table by foreign key, so the drop cascades nowhere. `ensureAuthSessionTables` in
-- `ensure-schema.ts` mirrors the new shape for a database stamped past this file without it, and
-- only ever adds.
--
-- ONE-WAY. The runner in `ensure-schema.ts` is forward-only and has no `down`.
--
-- NUMBERING. The runner applies a migration only when `lastAppliedCreatedAt < entry.when`, so the
-- `when` decides what runs and `idx` is cosmetic. 0020 carries 1788820000013; this file carries
-- 1788820000014 and its journal entry sits last. `packages/db/src/migrate-0021.test.ts` asserts
-- that place.
DROP TABLE IF EXISTS `auth_sessions`;
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `user_id` text NOT NULL,
  `org_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `absolute_expires_at` integer NOT NULL,
  `revoked_at` integer,
  `portal_checked_at` integer,
  `refresh_sealed` text
);
--> statement-breakpoint
-- The Phase 5 seat counter's index, as 0014 made it.
CREATE INDEX IF NOT EXISTS `auth_sessions_user_seen_idx` ON `auth_sessions` (`user_id`,`last_seen_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);

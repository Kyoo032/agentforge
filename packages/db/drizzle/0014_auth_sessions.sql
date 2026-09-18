-- Phase 2: the server-side half of the hosted browser session
-- (docs/internal/web-migration-plan.md "Phase 2", docs/internal/web-security-spec.md row T1).
--
-- The cookie carries an opaque 32-byte id; everything about the session is this row. `expires_at`
-- is the 12 h idle window (slid at most once per 5 minutes) and `absolute_expires_at` the 30 day
-- cap. Sign-out sets `revoked_at` instead of deleting, so the next request can answer
-- `session_revoked` rather than `session_required`.
--
-- Declared defensively (`IF NOT EXISTS`), like 0010-0013: a database that was baseline-stamped past
-- this point has the journal row without the table, and `ensure-schema.ts` re-creates it there.
-- Times are epoch milliseconds, as everywhere else in this schema.
CREATE TABLE IF NOT EXISTS `auth_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `user_id` text NOT NULL,
  `org_id` text NOT NULL,
  `created_at` integer NOT NULL,
  `last_seen_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  `absolute_expires_at` integer NOT NULL,
  `revoked_at` integer
);
--> statement-breakpoint
-- The Phase 5 seat counter: members with a live session in the last 30 days.
CREATE INDEX IF NOT EXISTS `auth_sessions_user_seen_idx` ON `auth_sessions` (`user_id`,`last_seen_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_sessions_expires_idx` ON `auth_sessions` (`expires_at`);

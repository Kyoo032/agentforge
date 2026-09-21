/**
 * Phase 8 — the one place that hands the readiness route a database connection.
 *
 * Same seam and same reason as `tenant-state-db.ts`, `entitlement-db.ts` and
 * `tenant-storage-db.ts`: importing `@agentforge/db` OPENS the SQLite file as a side effect
 * (`packages/db/src/client.ts`), and `handlers/health.ts` is reachable from unit tests that have
 * no database and want none.
 *
 * `router.ts` imports this, so a request that reaches `GET /api/v1/health` has the connection
 * installed. Without it the database check reports "did not answer", which is the truthful answer
 * for a process that cannot reach one — never a silent `ok`.
 */
import { sql } from "@agentforge/db";
import { registerHealthSql } from "./handlers/health";

registerHealthSql(sql);

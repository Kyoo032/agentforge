/**
 * Phase 4 — the one place that hands `tenant-state-store.ts` a database connection.
 *
 * It is a module of its own, and three lines long, for a reason worth keeping: importing
 * `@agentforge/db` OPENS the SQLite file as a side effect (`packages/db/src/client.ts`), and
 * `tenant-state-store.ts` sits under `settings-store.ts`, which sits under half the host — including
 * `edit/asr.ts` and from there the ffmpeg doctor. Every unit test about any of those would open a
 * database it has no use for, and `edit/ffmpeg-binary.test.ts`, which mocks `node:fs` wholesale,
 * would fail on the client's `mkdirSync` before reaching its first assertion.
 *
 * `router.ts` imports this, so every request that could reach a tenant's settings has installed the
 * backend before it gets there. Nothing else needs to: with no connection installed, server mode
 * refuses (`tenant_state_backend_missing`) rather than falling back to the desktop's files.
 */
import { sql } from "@agentforge/db";
import { registerTenantStateSql } from "./tenant-state-store";

registerTenantStateSql(sql);

/**
 * Phase 6 — the one place that hands `tenant-storage-store.ts` a database connection.
 *
 * A module of its own for the same reason `tenant-state-db.ts` and `entitlement-db.ts` are:
 * importing `@agentforge/db` OPENS the SQLite file as a side effect (`packages/db/src/client.ts`),
 * and `tenant-storage-store.ts` sits under `tenant-storage.ts`, which sits under `media.ts` and
 * from there under a large part of the host's unit tests. Every one of them would open a database
 * it has no use for.
 *
 * `router.ts` imports this, so every request that could store a byte has installed the backend
 * before it gets there. With no connection installed, the accounting refuses
 * (`tenant_storage_backend_missing`) rather than quietly not counting — a quota that silently stops
 * counting is a quota that does not exist.
 */
import { sql } from "@agentforge/db";
import { registerTenantStorageSql } from "./tenant-storage-store";

registerTenantStorageSql(sql);

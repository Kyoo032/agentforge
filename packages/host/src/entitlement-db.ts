/**
 * Phase 5 lane B — the one place that hands `entitlement-store.ts` a database connection.
 *
 * A module of its own for the same reason `tenant-state-db.ts` is: importing `@agentforge/db`
 * OPENS the SQLite file as a side effect (`packages/db/src/client.ts`), and `entitlement-store.ts`
 * is reached from `gateway-gate.ts`, which is reached from `settings-store.ts` and from there by
 * unit tests that have no database and mock `node:fs` wholesale.
 *
 * `router.ts` imports this, so every request that could reach a gateway call has installed the
 * backend before it gets there. Nothing else needs to: with no connection installed, server mode
 * refuses (`entitlement_backend_missing`) rather than letting the call through unmetered.
 */
import { sql } from "@agentforge/db";
import { registerEntitlementSql } from "./entitlement-store";

registerEntitlementSql(sql);

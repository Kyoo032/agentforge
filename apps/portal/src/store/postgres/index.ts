/**
 * The one driver: PostgreSQL 16, running `docs/internal/portal/migrations/0001-0005` unchanged.
 *
 * The shape of every call is the shape `0001_extensions_and_roles.sql` prescribes:
 *
 *     BEGIN;
 *     SET LOCAL app.tenant_id = '…';
 *     ... queries ...
 *     COMMIT;
 *
 * `SET LOCAL` is not optional and not a detail. It is rolled back with the transaction, so a
 * pooled connection cannot carry one tenant's scope into the next checkout — "the single most
 * likely way to breach isolation here". Because it only exists inside a transaction, `tx()` is the
 * only way in, and there is deliberately no "just run this one query" escape hatch.
 */
import pg from "pg";
import type { Clock, MigrationResult, PortalOps, PortalStore, PollDeviceCodeResult, RotateRefreshTokenInput, RotateRefreshTokenResult } from "../types";
import { runMigrations } from "./migrate";
import { createOps } from "./ops";
import { createResolvers } from "./resolvers";

const { Pool, types } = pg;

/**
 * `bigint` (OID 20) arrives as a string so 64-bit values survive the trip. The only bigints this
 * app reads are `audit_log.seq` and `wallet_ledger.seq`, both well inside Number.MAX_SAFE_INTEGER,
 * and the row mappers coerce them — so this stays default and nothing global is patched.
 */
void types;

export interface OpenPostgresStoreOptions {
  readonly databaseUrl: string;
  readonly clock?: Clock;
  /** Small on purpose: the portal is not the hot path, the gateway is. */
  readonly maxConnections?: number;
  readonly connectionTimeoutMs?: number;
}

const systemClock: Clock = { now: () => new Date() };

export function openPostgresStore(options: OpenPostgresStoreOptions): PortalStore {
  const clock = options.clock ?? systemClock;
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: options.maxConnections ?? 8,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
  });

  const resolve = createResolvers(pool);

  const tx = async <T>(tenantId: string | null, fn: (ops: PortalOps) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // set_config(..., true) is SET LOCAL with a bind parameter; a format() into SET LOCAL would
      // be an injection point on a value that comes from a JWT claim.
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId ?? ""]);
      const result = await fn(createOps(client, clock));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The connection is already unusable; the original error is the one worth reporting.
      }
      throw error;
    } finally {
      client.release();
    }
  };

  const store: PortalStore = {
    clock,
    tx,
    resolve,

    async migrate(): Promise<MigrationResult> {
      const client = await pool.connect();
      try {
        return await runMigrations(client);
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },

    async rotateRefreshToken(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenResult> {
      // Refresh carries no `tid`: resolve first, then do the real work inside that scope.
      const tenantId = await resolve.byRefreshToken(input.presentedToken);
      return tx(tenantId, (ops) => ops.refreshTokens.rotate(input));
    },

    async pollDeviceCode(rawDeviceCode: string, installId: string): Promise<PollDeviceCodeResult> {
      // A device code may legitimately have no tenant yet, in which case the null scope is right:
      // the device_codes policy exposes exactly that window and nothing else.
      const tenantId = await resolve.byDeviceCode(rawDeviceCode);
      return tx(tenantId, (ops) => ops.deviceCodes.poll(rawDeviceCode, installId));
    },
  };

  return Object.freeze(store);
}

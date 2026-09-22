/**
 * Per-test-file database helpers.
 *
 * `test/global-setup.ts` starts one server and builds `portal_template`; this creates a private
 * database from it for each file, so two suites can never see each other's rows and none of them
 * has to clean up after itself.
 *
 * **The store connects as `portal_app_test`, not as the cluster superuser.** That is the whole
 * point of this file's second half. A superuser bypasses row-level security outright, so a suite
 * that connects as one exercises every query in `src/store/postgres/**` while proving nothing at
 * all about the policies in `docs/internal/portal/migrations/0004_rls.sql` -- the tenant isolation
 * would look identical whether the policies existed or not. `portal_app_test` is a plain LOGIN
 * role whose only privilege is membership of `portal_app`, which is exactly what the portal's own
 * DSN will be in production (`0001_extensions_and_roles.sql`: "CREATE ROLE portal_app_login LOGIN
 * PASSWORD '<from secret manager>' IN ROLE portal_app").
 *
 * Migrations still run as the admin: `0004` re-owns every table to `portal_admin` and `0007`
 * creates `SECURITY DEFINER` functions, neither of which an application role may do.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { openPostgresStore } from "../store/postgres";
import type { Clock, PortalStore } from "../store/types";

declare module "vitest" {
  export interface ProvidedContext {
    portalTestDb: { adminUrl: string; template: string };
  }
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export interface TestDatabase {
  readonly url: string;
  readonly name: string;
  drop(): Promise<void>;
}

/**
 * A fresh database. `fromTemplate: false` gives an empty one, which is what the migration test
 * needs — everything else wants the migrations already applied.
 */
export async function createTestDatabase(options: { fromTemplate?: boolean } = {}): Promise<TestDatabase> {
  const { adminUrl, template } = inject("portalTestDb");
  const name = `portal_test_${randomBytes(6).toString("hex")}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const fromTemplate = options.fromTemplate ?? true;
    await admin.query(fromTemplate ? `CREATE DATABASE ${name} TEMPLATE ${template}` : `CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  return {
    url: urlFor(adminUrl, name),
    name,
    async drop() {
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
            WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name],
        );
        await cleanup.query(`DROP DATABASE IF EXISTS ${name}`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The application role
// ---------------------------------------------------------------------------

/** One cluster-wide role for the whole run; creating it is idempotent. */
export const APP_ROLE = "portal_app_test";
const APP_PASSWORD = "portal_app_test";

let appRoleReady: Promise<void> | null = null;

/**
 * `CREATE ROLE portal_app_test LOGIN IN ROLE portal_app`, once per cluster.
 *
 * `NOSUPERUSER NOBYPASSRLS` is stated rather than left to the default, because the property being
 * relied on is "this role cannot see past a policy" and a default is a weaker guarantee than a
 * declaration. `portal_app` itself exists by now: `0001_extensions_and_roles.sql` created it while
 * the template was built, and roles are cluster-wide.
 *
 * **The `EXCEPTION` block is load-bearing, not defensive noise.** The memo below is per *worker
 * process* and vitest runs test files in several of them, so `IF NOT EXISTS` followed by
 * `CREATE ROLE` is a check-then-act race on a cluster-wide catalog: two workers both see no role,
 * both create it, and the loser gets `duplicate key value violates unique constraint
 * "pg_authid_rolname_index"` and takes its whole file down. Catching it is the fix, because the
 * loser's desired end state is exactly what the winner just produced.
 */
async function ensureAppRole(adminUrl: string): Promise<void> {
  appRoleReady ??= (async () => {
    const admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query(`
        DO $$
        BEGIN
          CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE IN ROLE portal_app;
        EXCEPTION
          -- Already there: either from an earlier run, or from a worker that won the race.
          WHEN duplicate_object OR unique_violation THEN NULL;
        END
        $$;
      `);
    } finally {
      await admin.end();
    }
  })().catch((error: unknown) => {
    // A rejected memo would fail every later call in this worker for a reason that may have been
    // transient; drop it so the next caller retries.
    appRoleReady = null;
    throw error;
  });
  await appRoleReady;
}

/** The same DSN with the application role's credentials in place of the admin's. */
export function asAppRole(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.username = APP_ROLE;
  url.password = APP_PASSWORD;
  return url.toString();
}

export interface TestStore {
  readonly store: PortalStore;
  readonly database: TestDatabase;
  close(): Promise<void>;
}

export interface TestStoreOptions {
  /**
   * `true` connects as the cluster superuser instead, which **bypasses RLS**. Only for a test
   * whose subject is the migration runner or the schema itself.
   */
  readonly superuser?: boolean;
}

/** A store over a private, already-migrated database, connected as `portal_app_test`. */
export async function createTestStore(
  clock?: Clock,
  options: TestStoreOptions = {},
): Promise<TestStore> {
  const database = await createTestDatabase();
  if (!options.superuser) {
    await ensureAppRole(inject("portalTestDb").adminUrl);
  }
  const store = openPostgresStore({
    databaseUrl: options.superuser ? database.url : asAppRole(database.url),
    clock,
    maxConnections: 4,
  });
  return {
    store,
    database,
    async close() {
      await store.close();
      await database.drop();
    },
  };
}

/**
 * A raw client as the application role, for the handful of assertions that have to see what a
 * plain `SELECT` returns rather than what a store method returns.
 */
export async function appClientFor(database: TestDatabase): Promise<pg.Client> {
  await ensureAppRole(inject("portalTestDb").adminUrl);
  const client = new pg.Client({ connectionString: asAppRole(database.url) });
  await client.connect();
  return client;
}

/** A clock the caller moves by hand, for the few places a TTL is computed in TypeScript. */
export function fixedClock(start: Date = new Date()): Clock & { advance(ms: number): void; set(at: Date): void } {
  let current = new Date(start.getTime());
  return {
    now: () => new Date(current.getTime()),
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
    set: (at: Date) => {
      current = new Date(at.getTime());
    },
  };
}

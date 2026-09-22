/**
 * One real PostgreSQL 16 for the whole test run.
 *
 * The portal's store *is* Postgres — RLS policies, plpgsql functions, partitioned tables — so a
 * fake would test nothing that matters. Two ways to get one, in order:
 *
 *   1. `PORTAL_TEST_DATABASE_URL` — an instance that is already there (the compose service in
 *      `apps/portal/compose.yml`, or CI's).
 *   2. `embedded-postgres` — real PostgreSQL binaries, no Docker, started on an ephemeral port in
 *      a throwaway directory and thrown away at the end.
 *
 * Then it builds `portal_template`, applies every migration to it once, and hands the workers its
 * name. Each test file creates its own database `CREATE DATABASE … TEMPLATE portal_template`,
 * which is a file copy rather than a migration run — and, more importantly, means the cluster-wide
 * `CREATE ROLE` in `0001_extensions_and_roles.sql` happens exactly once instead of racing across
 * parallel workers.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import type { GlobalSetupContext } from "vitest/node";
import { runMigrations } from "../src/store/postgres/migrate";

const TEMPLATE_DB = "portal_template";
const EMBEDDED_USER = "portal";
const EMBEDDED_PASSWORD = "portal";

interface Started {
  /** A DSN pointing at the server's maintenance database. */
  readonly adminUrl: string;
  stop(): Promise<void>;
}

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function startEmbedded(): Promise<Started> {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const databaseDir = await mkdtemp(join(tmpdir(), "agentforge-portal-pg-"));
  // Port 0 is not an option for postgres, so pick a high one and let a collision fail loudly.
  const port = 55_000 + (process.pid % 5_000);

  const server = new EmbeddedPostgres({
    databaseDir,
    user: EMBEDDED_USER,
    password: EMBEDDED_PASSWORD,
    port,
    persistent: false,
  });
  await server.initialise();
  await server.start();

  return {
    adminUrl: `postgres://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@127.0.0.1:${port}/postgres`,
    async stop() {
      await server.stop();
      await rm(databaseDir, { recursive: true, force: true });
    },
  };
}

async function start(): Promise<Started> {
  const provided = process.env.PORTAL_TEST_DATABASE_URL?.trim();
  if (provided) {
    return { adminUrl: provided, stop: async () => {} };
  }
  return startEmbedded();
}

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const server = await start();

  const admin = new pg.Client({ connectionString: server.adminUrl });
  await admin.connect();
  // A template left over from a killed run would be re-used with a stale schema.
  await admin.query(`DROP DATABASE IF EXISTS ${TEMPLATE_DB}`);
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  const template = new pg.Pool({ connectionString: urlFor(server.adminUrl, TEMPLATE_DB) });
  const client = await template.connect();
  try {
    await runMigrations(client);
  } finally {
    client.release();
    await template.end();
  }

  provide("portalTestDb", { adminUrl: server.adminUrl, template: TEMPLATE_DB });

  return async () => {
    const cleanup = new pg.Client({ connectionString: server.adminUrl });
    await cleanup.connect();
    const { rows } = await cleanup.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'portal_test_%' OR datname = $1`,
      [TEMPLATE_DB],
    );
    for (const row of rows) {
      await cleanup.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [row.datname],
      );
      await cleanup.query(`DROP DATABASE IF EXISTS ${row.datname}`);
    }
    await cleanup.end();
    await server.stop();
  };
}

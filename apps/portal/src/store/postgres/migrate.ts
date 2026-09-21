/**
 * The migration runner.
 *
 * It applies, in order:
 *   1. `docs/internal/portal/migrations/0001-0005` — the backend team's files, **read, never
 *      copied and never edited**. If this repo's copy and theirs ever diverge, that is a merge
 *      conflict in one place rather than a silent fork of the schema.
 *   2. `apps/portal/migrations/0006+` — ours, for what the browser login needs and those five
 *      files do not have yet.
 *
 * Each file is already wrapped in its own `BEGIN; ... COMMIT;`, so it is sent as one simple query
 * and is not wrapped again. The tracking row is written after it, in its own statement: a file
 * that fails leaves no row and is retried on the next boot, which is what "safe to re-run" buys.
 *
 * The tracking table lives in its own schema on purpose. `0004_rls.sql` ends with
 * `ALTER TABLE <every table in public> OWNER TO portal_admin` — a bookkeeping table in `public`
 * would be swept up by that loop and change owner behind the runner's back.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import type { MigrationResult } from "../types";

/** `apps/portal` — this file is at `apps/portal/src/store/postgres/migrate.ts`. */
const PORTAL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPO_ROOT = resolve(PORTAL_ROOT, "..", "..");

export const SHARED_MIGRATIONS_DIR = join(REPO_ROOT, "docs", "internal", "portal", "migrations");
export const PORTAL_MIGRATIONS_DIR = join(PORTAL_ROOT, "migrations");

const TRACKING_SCHEMA = "portal_meta";
const TRACKING_TABLE = `${TRACKING_SCHEMA}.migrations`;

export interface MigrationFile {
  /** `0002_core_tables.sql` — unique across both directories, which the numbering guarantees. */
  readonly id: string;
  readonly path: string;
  readonly source: "docs" | "portal";
}

async function sqlFilesIn(dir: string, source: MigrationFile["source"]): Promise<MigrationFile[]> {
  const names = await readdir(dir);
  return names
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ id: name, path: join(dir, name), source }));
}

/** Both directories, theirs first, each in numeric order. */
export async function listMigrations(): Promise<readonly MigrationFile[]> {
  const shared = await sqlFilesIn(SHARED_MIGRATIONS_DIR, "docs");
  const own = await sqlFilesIn(PORTAL_MIGRATIONS_DIR, "portal");
  return Object.freeze([...shared, ...own]);
}

async function ensureTrackingTable(client: PoolClient): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${TRACKING_SCHEMA}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (
       id          text PRIMARY KEY,
       checksum    text NOT NULL,
       source      text NOT NULL,
       applied_at  timestamptz NOT NULL DEFAULT now()
     )`,
  );
}

function checksumOf(sql: string): string {
  // Normalised so a checkout with CRLF endings does not read as a different file.
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export class MigrationDriftError extends Error {
  constructor(id: string) {
    super(
      `Migration ${id} has changed since it was applied. Applied migrations are immutable: ` +
        `add a new numbered file under apps/portal/migrations/ instead of editing this one.`,
    );
    this.name = "MigrationDriftError";
  }
}

/**
 * Applies everything not yet recorded. Idempotent twice over: the tracking table skips applied
 * files, and every file is itself re-runnable, so a database restored from a dump without the
 * tracking rows still comes back to the same schema.
 */
export async function runMigrations(client: PoolClient): Promise<MigrationResult> {
  await ensureTrackingTable(client);

  const files = await listMigrations();
  const { rows } = await client.query<{ id: string; checksum: string }>(
    `SELECT id, checksum FROM ${TRACKING_TABLE}`,
  );
  const alreadyApplied = new Map(rows.map((row) => [row.id, row.checksum]));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sql = await readFile(file.path, "utf8");
    const checksum = checksumOf(sql);
    const previous = alreadyApplied.get(file.id);

    if (previous !== undefined) {
      if (previous !== checksum) {
        throw new MigrationDriftError(file.id);
      }
      skipped.push(file.id);
      continue;
    }

    await client.query(sql);
    await client.query(
      `INSERT INTO ${TRACKING_TABLE} (id, checksum, source) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET checksum = EXCLUDED.checksum`,
      [file.id, checksum, file.source],
    );
    applied.push(file.id);
  }

  return Object.freeze({ applied: Object.freeze(applied), skipped: Object.freeze(skipped) });
}

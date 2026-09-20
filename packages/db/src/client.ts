import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import SqliteDatabase, { type Database as SqliteConnection } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureSchema } from "./ensure-schema";
import { applyPendingDataReset } from "./reset";
import * as schema from "./schema";
import { localDataDir, sqliteFilePath } from "./vault-key";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), "../../.env.local") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local") });

const file = sqliteFilePath();
mkdirSync(dirname(file), { recursive: true });

const globalForDb = globalThis as unknown as {
  sqlite?: SqliteConnection;
};

/**
 * A queued "Start over" wipe runs here, on the boot after the owner asked for it: the database is
 * opened below, so this is the last moment nothing holds a handle on the files.
 *
 * Deliberately gated on `AGENTFORGE_APPLY_PENDING_RESET=1` rather than running on import. Importing
 * this module must never delete anybody's data as a side effect — a test, a migration script or a
 * tool that only wanted `db` would otherwise apply a wipe the owner queued for the *app*. The two
 * processes that are allowed to do it set the variable before `@agentforge/host` is loaded:
 * `apps/web/server-env.ts` (webdev) and `bootstrapPackaged()` in the Electron shell.
 *
 * Skipped when a connection is already cached, because that process already booted past this point.
 */
if (process.env.AGENTFORGE_APPLY_PENDING_RESET === "1" && !globalForDb.sqlite) {
  applyPendingDataReset(localDataDir());
}

export const sql: SqliteConnection = globalForDb.sqlite ?? new SqliteDatabase(file);
if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlite = sql;
}

sql.pragma("journal_mode = WAL");
sql.pragma("foreign_keys = ON");
// WAL gives concurrent readers with one writer, but without this a second writer gets
// SQLITE_BUSY immediately instead of waiting. 5 s is the Phase 3 database-engine change
// (docs/internal/web-phase3-tenancy-spec.md §3b); a SQLITE_BUSY still reaching a client
// after it is the trigger for revisiting the engine choice.
sql.pragma("busy_timeout = 5000");
ensureSchema(sql);

export const db = drizzle(sql, { schema });
export type Database = typeof db;

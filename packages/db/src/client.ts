import { config } from "dotenv";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import SqliteDatabase from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureSchema } from "./ensure-schema";
import * as schema from "./schema";
import { sqliteFilePath } from "./vault-key";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), "../../.env.local") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local") });

const file = sqliteFilePath();
mkdirSync(dirname(file), { recursive: true });

const globalForDb = globalThis as unknown as {
  sqlite?: SqliteDatabase.Database;
};

export const sql = globalForDb.sqlite ?? new SqliteDatabase(file);
if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlite = sql;
}

sql.pragma("journal_mode = WAL");
sql.pragma("foreign_keys = ON");
ensureSchema(sql);

export const db = drizzle(sql, { schema });
export type Database = typeof db;

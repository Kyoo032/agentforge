import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import * as schema from "./schema";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), "../../.env.local") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), ".env.local") });

const connectionString = process.env.DATABASE_URL ?? "postgres://agentforge:agentforge@localhost:5432/agentforge";

const globalForDb = globalThis as unknown as {
  postgres?: ReturnType<typeof postgres>;
};

export const sql = globalForDb.postgres ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") {
  globalForDb.postgres = sql;
}

export const db = drizzle(sql, { schema });
export type Database = typeof db;

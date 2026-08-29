import { defineConfig } from "drizzle-kit";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function sqliteUrl(): string {
  const dataDir = process.env.AGENTFORGE_DATA_DIR?.trim() || resolve(process.cwd(), "../../data");
  const fallback = `file:${resolve(dataDir, "agentforge.sqlite")}`;
  const url = process.env.DATABASE_URL?.trim();
  if (!url || url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    return fallback;
  }
  if (url.startsWith("file:")) {
    return url;
  }
  return `file:${url}`;
}

const url = sqliteUrl();
const file = url.startsWith("file:") ? url.slice("file:".length) : url;
mkdirSync(dirname(file), { recursive: true });

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url,
  },
});

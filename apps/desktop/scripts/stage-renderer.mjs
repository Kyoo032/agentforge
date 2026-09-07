#!/usr/bin/env node
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopRoot, "..", "..");
const webDist = join(repoRoot, "apps", "web", "dist");
const rendererDest = join(desktopRoot, "resources", "renderer");
const drizzleSrc = join(repoRoot, "packages", "db", "drizzle");
const drizzleDest = join(desktopRoot, "resources", "drizzle");

if (!existsSync(join(webDist, "index.html"))) {
  console.error("Vite renderer missing at apps/web/dist. Run pnpm --filter @agentforge/web build first.");
  process.exit(1);
}

await build({
  entryPoints: [join(desktopRoot, "src", "host-entry.ts")],
  bundle: true,
  minify: true,
  platform: "node",
  format: "cjs",
  outfile: join(desktopRoot, "host.cjs"),
  external: ["better-sqlite3", "electron", "keytar"],
});

rmSync(rendererDest, { recursive: true, force: true });
mkdirSync(rendererDest, { recursive: true });
cpSync(webDist, rendererDest, {
  recursive: true,
  filter: (src) => !src.endsWith(".map"),
});

rmSync(drizzleDest, { recursive: true, force: true });
mkdirSync(dirname(drizzleDest), { recursive: true });
cpSync(drizzleSrc, drizzleDest, { recursive: true });

// Bundled starter media must exist before packaging; the generator script owns the check.
execFileSync(process.execPath, [join(repoRoot, "scripts", "edit-starters.mjs"), "--check"], { stdio: "inherit" });

if (!existsSync(join(drizzleDest, "meta", "_journal.json"))) {
  console.error("stage-renderer: packages/db/drizzle/meta/_journal.json missing");
  process.exit(1);
}

console.log("staged renderer + host.cjs + drizzle + starters");

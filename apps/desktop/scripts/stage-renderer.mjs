#!/usr/bin/env node
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { injectCspMeta } = require("../renderer-csp.cjs");

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

// The renderer ships as a file:// document, where a response header never reaches it (Electron's
// webRequest does not observe Chromium's file loader), so the policy has to be in the page itself.
// It is injected here rather than in apps/web/index.html because that file is also what `pnpm dev`
// serves through Vite, whose Fast Refresh preamble, eval'd HMR client and dev-server websocket all
// fall foul of script-src 'self' / connect-src 'self'. See apps/desktop/renderer-csp.cjs.
const rendererIndex = join(rendererDest, "index.html");
writeFileSync(rendererIndex, injectCspMeta(readFileSync(rendererIndex, "utf8")), "utf8");

rmSync(drizzleDest, { recursive: true, force: true });
mkdirSync(dirname(drizzleDest), { recursive: true });
cpSync(drizzleSrc, drizzleDest, { recursive: true });

// Bundled starter media must exist before packaging; the generator script owns the check.
execFileSync(process.execPath, [join(repoRoot, "scripts", "edit-starters.mjs"), "--check"], { stdio: "inherit" });

if (!existsSync(join(drizzleDest, "meta", "_journal.json"))) {
  console.error("stage-renderer: packages/db/drizzle/meta/_journal.json missing");
  process.exit(1);
}

console.log("staged renderer (CSP injected) + host.cjs + drizzle + starters");

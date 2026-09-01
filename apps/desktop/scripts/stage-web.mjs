#!/usr/bin/env node
/**
 * Copy Next standalone output + the build-machine node.exe into
 * apps/desktop/resources/web for electron-builder extraResources.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopRoot, "..", "..");
const standaloneSrc = join(repoRoot, "apps", "web", ".next", "standalone");
const staticSrc = join(repoRoot, "apps", "web", ".next", "static");
const dest = join(desktopRoot, "resources", "web");
const nestedServer = join(standaloneSrc, "apps", "web", "server.js");
const flatServer = join(standaloneSrc, "server.js");

if (!existsSync(nestedServer) && !existsSync(flatServer)) {
  console.error(
    "Next standalone output missing (apps/web/.next/standalone/.../server.js). Set output: 'standalone' and run pnpm --filter @agentforge/web build first.",
  );
  process.exit(1);
}

const srcDrizzle = join(standaloneSrc, "packages", "db", "drizzle");
if (!existsSync(srcDrizzle)) {
  console.error(
    "Next standalone did not trace packages/db/drizzle; set outputFileTracingIncludes so migrations ship with the installer.",
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(standaloneSrc, dest, { recursive: true });

if (existsSync(staticSrc)) {
  const staticDest = existsSync(join(dest, "apps", "web"))
    ? join(dest, "apps", "web", ".next", "static")
    : join(dest, ".next", "static");
  mkdirSync(dirname(staticDest), { recursive: true });
  cpSync(staticSrc, staticDest, { recursive: true });
}

const nodeName = process.platform === "win32" ? "node.exe" : "node";
copyFileSync(process.execPath, join(dest, nodeName));

function failMissing(label, candidatePath) {
  console.error(`stage-web assertion failed: missing ${label} at ${candidatePath}`);
  process.exit(1);
}

const destNestedServer = join(dest, "apps", "web", "server.js");
const destFlatServer = join(dest, "server.js");
if (!existsSync(destNestedServer) && !existsSync(destFlatServer)) {
  failMissing("server.js", destNestedServer);
}

const destNode = join(dest, nodeName);
if (!existsSync(destNode)) {
  failMissing(nodeName, destNode);
}

const destNestedStatic = join(dest, "apps", "web", ".next", "static");
const destFlatStatic = join(dest, ".next", "static");
if (!existsSync(destNestedStatic) && !existsSync(destFlatStatic)) {
  failMissing(".next/static", destNestedStatic);
}

function findBetterSqlite3Node(dir) {
  /** @type {string[]} */
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (name.endsWith(".node") && full.replace(/\\/g, "/").includes("better-sqlite3")) {
        return full;
      }
    }
  }
  return null;
}

const sqliteNode = findBetterSqlite3Node(dest);
if (!sqliteNode) {
  failMissing("better-sqlite3 *.node", join(dest, ".../better-sqlite3/*.node"));
}

const destDrizzle = join(dest, "packages", "db", "drizzle");
const destJournal = join(destDrizzle, "meta", "_journal.json");
if (!existsSync(destDrizzle)) {
  failMissing("packages/db/drizzle", destDrizzle);
}
if (!existsSync(destJournal)) {
  failMissing("packages/db/drizzle/meta/_journal.json", destJournal);
}

/**
 * Next's require-hook does require.resolve('styled-jsx/package.json') from
 * apps/web/node_modules/next. pnpm standalone leaves the package only under
 * node_modules/.pnpm, so the packaged server crashes before /chat.
 */
function findPnpmPackage(root, packageName) {
  const pnpm = join(root, "node_modules", ".pnpm");
  if (existsSync(pnpm)) {
    let entries = [];
    try {
      entries = readdirSync(pnpm);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.startsWith(`${packageName}@`)) continue;
      const candidate = join(pnpm, entry, "node_modules", packageName);
      if (existsSync(join(candidate, "package.json"))) {
        return candidate;
      }
    }
  }
  const siblings = [
    join(root, "apps", "web", "node_modules", packageName),
    join(root, "node_modules", packageName),
    join(repoRoot, "node_modules", packageName),
  ];
  for (const candidate of siblings) {
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return null;
}

function hoistRuntimePackage(packageName) {
  const targets = [
    join(dest, "apps", "web", "node_modules", packageName),
    join(dest, "node_modules", packageName),
  ];
  if (targets.every((t) => existsSync(join(t, "package.json")))) {
    return;
  }
  const src = findPnpmPackage(dest, packageName);
  if (!src) {
    failMissing(packageName, join(dest, "node_modules", ".pnpm", `${packageName}@*`));
  }
  for (const target of targets) {
    if (existsSync(join(target, "package.json"))) continue;
    mkdirSync(dirname(target), { recursive: true });
    cpSync(src, target, { recursive: true, dereference: true });
  }
}

hoistRuntimePackage("styled-jsx");

const destStyledJsx = join(dest, "apps", "web", "node_modules", "styled-jsx", "package.json");
if (!existsSync(destStyledJsx)) {
  failMissing("styled-jsx/package.json", destStyledJsx);
}

console.log("staged packaged web runtime at", dest);

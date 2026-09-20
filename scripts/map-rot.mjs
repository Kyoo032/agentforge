#!/usr/bin/env node
/**
 * Map-rot check: every `file:line` a doc cites must still resolve, and the range it cites should
 * still contain the symbol the sentence names.
 *
 * The maps convention (docs/internal/maps/README.md) is that a map which disagrees with the code is
 * fixed the same day or deleted, and that every claim carries a `file:line` citation. Nothing
 * enforced that, so the citations drifted silently every time a file grew a line. This script is the
 * mechanical half of the check; the semantic half is still a person reading the page.
 *
 * Usage (repo root): node scripts/map-rot.mjs [--all]
 *   (default)  docs/internal/maps/ and .cursor/skills/verify-agentforge/
 *   --all      every tracked .md outside node_modules, which also covers docs/internal/*.md
 *
 * Exit code 1 when there is a HARD failure: a cited path that does not exist, or a cited line past
 * the end of the file. Those are always wrong. SOFT findings — the cited range names none of the
 * distinctive symbols the sentence claims — are printed but do not fail the run, because a map may
 * legitimately cite a call site rather than a definition. Read every soft finding before dismissing
 * it: this is the shape most drift takes.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanAll = process.argv.includes("--all");
const DEFAULT_ROOTS = ["docs/internal/maps", ".cursor/skills/verify-agentforge"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".turbo", "coverage"]);

/** Top-level directories a citation may point into. Keeps prose like `1.5 MB/s` out of the matcher. */
const CITED_ROOTS = "apps|packages|scripts|docs|webapp-deploy|\\.cursor";
const CITED_EXT = "tsx|ts|mjs|cjs|json|js|sql|md|sh|yaml|yml";
const CITE = new RegExp(`((?:${CITED_ROOTS})/[A-Za-z0-9_@./+-]+?\\.(?:${CITED_EXT})):(\\d+)(?:[-–](\\d+))?`, "g");

/** Backticked identifiers long and distinctive enough to be worth looking for in the cited range. */
const IDENT = /`([A-Za-z_$][A-Za-z0-9_$]{5,})`/g;
const isDistinctive = (name) => /[A-Z]/.test(name) || name.includes("_");

const fileLines = new Map();
function linesOf(absolute) {
  if (!fileLines.has(absolute)) {
    fileLines.set(absolute, readFileSync(absolute, "utf8").split(/\r?\n/));
  }
  return fileLines.get(absolute);
}

function collectDocs(dir, out) {
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectDocs(full, out);
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

const docs = scanAll
  ? collectDocs(repoRoot, [])
  : DEFAULT_ROOTS.flatMap((dir) => collectDocs(path.join(repoRoot, dir), []));

const hard = [];
const soft = [];
let citations = 0;

for (const doc of docs.sort()) {
  const where = path.relative(repoRoot, doc).split(path.sep).join("/");
  const rows = readFileSync(doc, "utf8").split(/\r?\n/);

  rows.forEach((row, index) => {
    const cites = [...row.matchAll(CITE)];
    if (cites.length === 0) {
      return;
    }
    const idents = [...new Set([...row.matchAll(IDENT)].map((m) => m[1]))].filter(isDistinctive);

    for (const [, cited, startRaw, endRaw] of cites) {
      citations += 1;
      const absolute = path.join(repoRoot, cited);
      if (!existsSync(absolute) || !statSync(absolute).isFile()) {
        hard.push(`${where}:${index + 1}  cites ${cited} — no such file`);
        continue;
      }
      const lines = linesOf(absolute);
      const start = Number(startRaw);
      const end = endRaw ? Number(endRaw) : start;
      if (end > lines.length) {
        hard.push(`${where}:${index + 1}  cites ${cited}:${startRaw}${endRaw ? `-${endRaw}` : ""} — the file has ${lines.length} lines`);
        continue;
      }
      // Only meaningful when exactly one citation shares the row with the symbols, and only for
      // source files: a `.md` or `.json` citation names a heading or a key, not a declaration.
      if (cites.length !== 1 || idents.length === 0 || !/\.(tsx|ts|mjs|cjs|js)$/.test(cited)) {
        continue;
      }
      const inRange = lines.slice(start - 1, end).join("\n");
      const whole = lines.join("\n");
      const present = idents.filter((name) => whole.includes(name));
      if (present.length === 0 || present.some((name) => inRange.includes(name))) {
        continue;
      }
      const seenAt = present
        .map((name) => `${name} at :${lines.findIndex((line) => line.includes(name)) + 1}`)
        .join(", ");
      soft.push(
        `${where}:${index + 1}  cites ${cited}:${startRaw}${endRaw ? `-${endRaw}` : ""} for [${present.join(", ")}] — that range names none of them; first seen ${seenAt}`,
      );
    }
  });
}

if (hard.length > 0) {
  console.log("HARD — a cited path or line does not exist:\n");
  for (const line of hard) {
    console.log(`  ${line}`);
  }
  console.log("");
}
if (soft.length > 0) {
  console.log("SOFT — the cited range names none of the symbols the sentence claims (read each one):\n");
  for (const line of soft) {
    console.log(`  ${line}`);
  }
  console.log("");
}

console.log(`${docs.length} docs, ${citations} citations, ${hard.length} hard, ${soft.length} soft`);
process.exit(hard.length > 0 ? 1 : 0);

#!/usr/bin/env node
/**
 * Fail CI on an advisory that reaches the HOSTED IMAGE, and only report the rest.
 *
 * Usage (repo root): node scripts/audit-deployed.mjs [--level high|critical|moderate|low]
 *                    node scripts/audit-deployed.mjs --audit <file> --closure <file>   (tests)
 *
 * WHY A SCRIPT RATHER THAN `pnpm audit --audit-level high`. A workspace-wide audit is one number
 * over three very different artefacts. Run today it reports 1 critical and 19 high — and every one
 * of them (tar, electron, extract-zip, app-builder-lib, builder-util-runtime) is reachable only
 * from `apps/desktop`, a frozen Electron shell at 0.14.27 that the hosted pipeline never builds.
 * Gating on that number means a red board nobody can turn green, which within a week means a board
 * nobody reads. Reporting it and gating on nothing is the same outcome by a slower road.
 *
 * So the gate is the closure that is actually deployed. `webapp-deploy/Dockerfile` runs
 * `pnpm install --frozen-lockfile --filter "@agentforge/web..."`, and this asks pnpm for exactly
 * that set. Everything outside it is still printed, so the desktop advisories stay visible without
 * being able to block a web deploy.
 *
 * DEV DEPENDENCIES ARE PART OF THAT CLOSURE, deliberately. The Dockerfile does NOT run
 * `pnpm prune --prod`, because `tsx` is a devDependency of `@agentforge/web` and is the production
 * entrypoint; pruning would delete the thing that boots the app. So the image ships the full
 * install, and the honest closure to audit is the full one, not `--prod`. (Trimming that is a
 * migration-plan item — see docs/internal/security-owasp-2026-09.md, finding A06-2.)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LEVELS = ["low", "moderate", "high", "critical"];
const DEFAULT_LEVEL = "high";

/** The workspace package whose install closure the Dockerfile builds. `...` means "and its deps". */
const DEPLOYED_FILTER = "@agentforge/web...";

function parseArgs(argv) {
  const args = { level: DEFAULT_LEVEL, audit: null, closure: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--level" && value) {
      args.level = value;
      i += 1;
    } else if (flag === "--audit" && value) {
      args.audit = value;
      i += 1;
    } else if (flag === "--closure" && value) {
      args.closure = value;
      i += 1;
    }
  }
  if (!LEVELS.includes(args.level)) {
    throw new Error(`--level must be one of ${LEVELS.join(", ")}`);
  }
  return args;
}

/**
 * Every `name` in the tree `pnpm list` prints, at any depth.
 *
 * Names rather than name@version: an advisory's `module_name` is a name, and its
 * `vulnerable_versions` range has already been applied by the registry against what is installed —
 * anything pnpm audit reports is a version that is actually here.
 */
export function closureNames(listJson) {
  const names = new Set();
  const walk = (deps) => {
    for (const [name, node] of Object.entries(deps ?? {})) {
      const key = `${name}@${node?.version ?? ""}`;
      if (names.has(key)) {
        continue;
      }
      names.add(key);
      walk(node?.dependencies);
    }
  };
  for (const root of listJson) {
    for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
      walk(root?.[group]);
    }
  }
  return new Set([...names].map((key) => key.slice(0, key.lastIndexOf("@"))));
}

/** Splits the advisories into the ones the image carries and the ones it does not. */
export function partition(auditJson, deployed) {
  const advisories = Object.values(auditJson?.advisories ?? {});
  const inImage = [];
  const elsewhere = [];
  for (const advisory of advisories) {
    (deployed.has(advisory.module_name) ? inImage : elsewhere).push(advisory);
  }
  const bySeverity = (a, b) => LEVELS.indexOf(b.severity) - LEVELS.indexOf(a.severity);
  return { inImage: inImage.sort(bySeverity), elsewhere: elsewhere.sort(bySeverity) };
}

/** The advisories at or above `level`. */
export function atOrAbove(advisories, level) {
  const floor = LEVELS.indexOf(level);
  return advisories.filter((advisory) => LEVELS.indexOf(advisory.severity) >= floor);
}

function run(command, args) {
  // `pnpm audit` exits non-zero when it finds anything, which is the whole point of calling it;
  // the output is what matters, so the exit code is read off the error instead of thrown on.
  try {
    return execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    if (typeof error?.stdout === "string" && error.stdout.length > 0) {
      return error.stdout;
    }
    throw error;
  }
}

function describe(advisory) {
  const patched = advisory.patched_versions && advisory.patched_versions !== "<0.0.0";
  const fix = patched ? `fixed in ${advisory.patched_versions}` : "no fix published";
  return `  ${advisory.severity.toUpperCase().padEnd(8)} ${advisory.module_name} — ${advisory.title} (${fix})`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const listJson = JSON.parse(
    args.closure
      ? readFileSync(args.closure, "utf8")
      : run("pnpm", ["list", "--filter", DEPLOYED_FILTER, "--depth", "Infinity", "--json"]),
  );
  const auditJson = JSON.parse(
    args.audit ? readFileSync(args.audit, "utf8") : run("pnpm", ["audit", "--json"]),
  );

  const deployed = closureNames(listJson);
  const { inImage, elsewhere } = partition(auditJson, deployed);
  const blocking = atOrAbove(inImage, args.level);

  console.log(`Deployed closure (${DEPLOYED_FILTER}): ${deployed.size} packages`);
  console.log(`\nIn the hosted image: ${inImage.length} advisories`);
  for (const advisory of inImage) {
    console.log(describe(advisory));
  }
  console.log(`\nNot in the hosted image (desktop or tooling only): ${elsewhere.length} advisories`);
  const counts = new Map();
  for (const advisory of elsewhere) {
    counts.set(advisory.module_name, (counts.get(advisory.module_name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    console.log(`  ${name}: ${count}`);
  }

  if (blocking.length > 0) {
    console.error(`\nFAIL: ${blocking.length} advisory/advisories at ${args.level} or above reach the hosted image.`);
    process.exit(1);
  }
  console.log(`\nOK: nothing at ${args.level} or above reaches the hosted image.`);
}

// Importable for the test next to this file; only the CLI path runs the two pnpm commands.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main();
}

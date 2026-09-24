#!/usr/bin/env node
/**
 * Local CI. Since 2026-09-24 this is the only CI the repo has: Rizky dropped GitHub Actions, so
 * nothing checks a change unless someone runs this. Run it before any PR, merge or pack, and paste
 * the summary table it prints into the PR.
 *
 * Usage (repo root):
 *   node scripts/ci-local.mjs                 lint, tsc, unit tests, tooling tests, audit, doc checks
 *   node scripts/ci-local.mjs --install       also check `pnpm install --frozen-lockfile` first
 *   node scripts/ci-local.mjs --e2e           also run the Playwright stub suite (slow; off by default)
 *   node scripts/ci-local.mjs --only tsc --only lint     run only these steps (group or full name)
 *   node scripts/ci-local.mjs --skip audit              run everything but these
 *
 * Every step runs even when an earlier one failed, so one run shows the whole picture. Exit code is
 * 1 when any REQUIRED step failed; ADVISORY steps are reported and never fail the run. Full output
 * of each step lands in `.ci-local/<timestamp>/<step>.log`, plus `summary.md` for the PR.
 *
 * Children are spawned with shell:false through `process.execPath` and each tool's JS entry, because
 * the extensionless `node_modules/.bin` shims cannot be exec'd on Windows. pnpm is resolved to its
 * `pnpm.cjs` (npm_execpath, CI_LOCAL_PNPM, or the npx cache); only when none is found does the
 * script fall back to `npx --yes pnpm@<version>` through a shell, with fixed arguments.
 *
 * What moved here from the deleted workflows: ci.yml (install, lint, unit tests, `node --test
 * scripts/*.test.mjs`, the deployed-closure audit gate, the advisory workspace audit) and e2e.yml
 * (Playwright with AGENTFORGE_RUNTIME=stub). desktop-mac.yml was a release build, not a check; the
 * mac build is `pnpm desktop:build:mac:docker` (apps/desktop/platform/macos/AGENTS.md).
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STEP_TIMEOUT_MS = 30 * 60 * 1000;
/** Steps that only run when asked for, by flag or by `--only`. */
const OPT_IN = { install: "--install", e2e: "--e2e" };

// ---------------------------------------------------------------------------------------------
// Pure helpers (tested in ci-local.test.mjs)
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { only: [], skip: [], e2e: false, install: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--e2e") args.e2e = true;
    else if (flag === "--install") args.install = true;
    else if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--only" || flag === "--skip") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} needs a step name`);
      args[flag.slice(2)].push(value);
      i += 1;
    } else if (flag.startsWith("--only=") || flag.startsWith("--skip=")) {
      const [key, value] = flag.slice(2).split("=");
      if (!value) throw new Error(`--${key} needs a step name`);
      args[key].push(value);
    } else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

const matches = (step, names) => names.some((n) => n === step.group || n === step.name);

/** Which of `steps` run for `args`. Opt-in groups run when their flag is set or `--only` names them. */
export function selectSteps(steps, args) {
  return steps.filter((step) => {
    if (matches(step, args.skip)) return false;
    if (args.only.length > 0 && !matches(step, args.only)) return false;
    if (step.group === "install") return args.install || matches(step, args.only);
    if (step.group === "e2e") return args.e2e || matches(step, args.only);
    return true;
  });
}

export function exitCodeFor(results) {
  return results.some((r) => r.required && r.status !== "pass") ? 1 : 0;
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** A markdown table, so the same text reads in a terminal and pastes into a PR. */
export function formatSummary(results) {
  const rows = results.map((r) => {
    const status = r.status === "pass" ? "pass" : r.required ? `FAIL` : `warn (advisory)`;
    return `| ${r.name} | ${status} | ${formatDuration(r.durationMs)} |`;
  });
  const failed = results.filter((r) => r.required && r.status !== "pass").length;
  const warned = results.filter((r) => !r.required && r.status !== "pass").length;
  const verdict = failed > 0 ? `FAIL: ${failed} required step(s) failed` : "OK: every required step passed";
  return [
    "| step | status | duration |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `${verdict}${warned > 0 ? `, ${warned} advisory warning(s)` : ""}.`,
  ].join("\n");
}

/** `packages: ["apps/*", "packages/*"]` → the directories under them that hold a package.json. */
export function workspaceGlobs(yamlText) {
  return [...yamlText.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?/gm)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function workspaces() {
  const globs = workspaceGlobs(readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"));
  const dirs = [];
  for (const glob of globs) {
    if (!glob.endsWith("/*")) {
      if (existsSync(path.join(repoRoot, glob, "package.json"))) dirs.push(glob);
      continue;
    }
    const base = glob.slice(0, -2);
    for (const entry of readdirSync(path.join(repoRoot, base), { withFileTypes: true })) {
      const rel = `${base}/${entry.name}`;
      if (entry.isDirectory() && existsSync(path.join(repoRoot, rel, "package.json"))) dirs.push(rel);
    }
  }
  return dirs.sort().map((dir) => ({ dir, pkg: readJson(path.join(repoRoot, dir, "package.json")) }));
}

/** A package's own copy of a tool's JS entry, else the root's. */
function toolEntry(dir, relative) {
  for (const base of [path.join(repoRoot, dir), repoRoot]) {
    const file = path.join(base, "node_modules", relative);
    if (existsSync(file)) return file;
  }
  return null;
}

function npxCacheDirs(env) {
  const roots = [env.npm_config_cache, path.join(env.LOCALAPPDATA ?? "", "npm-cache"), path.join(os.homedir(), ".npm")];
  return roots.filter(Boolean).map((r) => path.join(r, "_npx")).filter((d) => existsSync(d));
}

/** The pnpm.cjs to run with process.execPath, or null. */
function findPnpmEntry(version, env = process.env) {
  if (env.CI_LOCAL_PNPM && existsSync(env.CI_LOCAL_PNPM)) return env.CI_LOCAL_PNPM;
  if (env.npm_execpath && /pnpm\.c?js$/.test(env.npm_execpath) && existsSync(env.npm_execpath)) return env.npm_execpath;
  for (const cache of npxCacheDirs(env)) {
    for (const hash of readdirSync(cache)) {
      const pkgDir = path.join(cache, hash, "node_modules", "pnpm");
      try {
        if (readJson(path.join(pkgDir, "package.json")).version === version) {
          const entry = path.join(pkgDir, "bin", "pnpm.cjs");
          if (existsSync(entry)) return entry;
        }
      } catch {
        // not a pnpm install; keep looking
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

function buildSteps(ctx) {
  const node = (args, opts = {}) => ({ cmd: process.execPath, args, cwd: opts.cwd ?? repoRoot, ...opts });
  const pnpm = (args, opts = {}) =>
    ctx.pnpmEntry
      ? node([ctx.pnpmEntry, ...args], opts)
      : { cmd: "npx", args: ["--yes", `pnpm@${ctx.pnpmVersion}`, ...args], shell: process.platform === "win32", cwd: repoRoot, ...opts };
  const steps = [];
  const add = (group, name, required, commands, note) => steps.push({ group, name, required, commands, note });

  add("install", "install", true, [pnpm(["install", "--frozen-lockfile"])]);

  const lint = (ctx.rootPkg.scripts?.lint ?? "biome check .").split(/\s+/);
  const biome = toolEntry(".", "@biomejs/biome/bin/biome");
  add("lint", "lint", true, biome ? [node([biome, ...lint.slice(1)])] : [], biome ? undefined : "biome not installed");

  for (const { dir } of ctx.workspaces) {
    if (!existsSync(path.join(repoRoot, dir, "tsconfig.json"))) continue;
    const tsc = toolEntry(dir, "typescript/bin/tsc");
    add("tsc", `tsc:${dir}`, true, tsc ? [node([tsc, "--noEmit", "-p", "tsconfig.json"], { cwd: path.join(repoRoot, dir) })] : [], tsc ? undefined : "typescript not installed");
  }

  // One package at a time, each with its own data dir: packages in parallel race one SQLite file.
  for (const { dir, pkg } of ctx.workspaces) {
    if (!/^vitest\b/.test(pkg.scripts?.test ?? "")) continue;
    const vitest = toolEntry(dir, "vitest/vitest.mjs");
    add("test", `test:${dir}`, true, vitest ? [node([vitest, "run"], { cwd: path.join(repoRoot, dir), freshDataDir: true })] : [], vitest ? undefined : "vitest not installed");
  }

  const scriptTests = readdirSync(path.join(repoRoot, "scripts")).filter((f) => f.endsWith(".test.mjs")).sort();
  add("node-test", "node-test:scripts", true, [node(["--test", ...scriptTests.map((f) => path.join("scripts", f))], { freshDataDir: true })]);

  const desktop = ctx.workspaces.find((w) => w.pkg.name === "@agentforge/desktop");
  const desktopTest = desktop?.pkg.scripts?.test;
  if (desktopTest) {
    const parts = desktopTest.split("&&").map((p) => p.trim().split(/\s+/));
    const cwd = path.join(repoRoot, desktop.dir);
    const commands = parts.every((p) => p[0] === "node" && p.length >= 2)
      ? parts.map((p) => node(p.slice(1), { cwd }))
      : [pnpm(["--filter", "@agentforge/desktop", "test"])];
    add("node-test", "node-test:apps/desktop", true, commands);
  }

  // ci.yml's audit job: the hosted-image closure gates, the whole workspace is advisory.
  const closure = path.join(ctx.logDir, "audit-closure.json");
  const audit = path.join(ctx.logDir, "audit.json");
  add("audit", "audit:deployed", true, [
    pnpm(["list", "--filter", "@agentforge/web...", "--depth", "Infinity", "--json"], { stdoutFile: closure }),
    pnpm(["audit", "--json"], { stdoutFile: audit, ignoreExit: true }),
    node(["scripts/audit-deployed.mjs", "--level", "high", "--audit", audit, "--closure", closure]),
  ]);
  add("audit", "audit:workspace", false, [pnpm(["audit", "--audit-level", "moderate"])]);

  // Doc and media checks. Never in the old CI; advisory because the media they check is gitignored.
  add("maps", "maps:check", false, [node(["scripts/map-rot.mjs"])]);
  add("media", "edit:starters:check", false, [node(["scripts/edit-starters.mjs", "--check"])]);
  add("media", "videos:examples:check", false, [node(["scripts/video-examples.mjs", "--check"])]);

  // e2e.yml. CI=1 turns off reuseExistingServer, so the suite never drives whatever answers on :3000
  // (on this desk that is Rizky's live webdev). A pnpm shim on PATH lets its `pnpm dev` resolve.
  const playwright = toolEntry("apps/web", "@playwright/test/cli.js");
  add(
    "e2e",
    "e2e:playwright",
    true,
    playwright ? [node([playwright, "test"], { cwd: path.join(repoRoot, "apps/web"), env: { AGENTFORGE_RUNTIME: "stub", CI: "1" }, pnpmShim: true })] : [],
    playwright ? undefined : "@playwright/test not installed",
  );
  return steps;
}

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

function writePnpmShim(ctx) {
  const bin = path.join(ctx.logDir, "bin");
  mkdirSync(bin, { recursive: true });
  const target = ctx.pnpmEntry ? `"${process.execPath}" "${ctx.pnpmEntry}"` : `npx --yes pnpm@${ctx.pnpmVersion}`;
  writeFileSync(path.join(bin, "pnpm.cmd"), `@echo off\r\n${target} %*\r\n`);
  writeFileSync(path.join(bin, "pnpm"), `#!/bin/sh\nexec ${target} "$@"\n`, { mode: 0o755 });
  return bin;
}

function runCommand(command, log, ctx) {
  return new Promise((resolve) => {
    const env = { ...process.env, ...(command.env ?? {}) };
    let dataDir = null;
    if (command.freshDataDir) {
      dataDir = mkdtempSync(path.join(os.tmpdir(), "agentforge-ci-"));
      env.AGENTFORGE_DATA_DIR = dataDir;
    }
    if (command.pnpmShim) {
      const key = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
      env[key] = `${writePnpmShim(ctx)}${path.delimiter}${env[key] ?? ""}`;
    }
    log.write(`\n$ ${[command.cmd, ...command.args].join(" ")}\n  cwd: ${command.cwd}${dataDir ? `\n  AGENTFORGE_DATA_DIR: ${dataDir}` : ""}\n\n`);
    const out = command.stdoutFile ? createWriteStream(command.stdoutFile) : null;
    const child = spawn(command.cmd, command.args, { cwd: command.cwd, env, shell: command.shell ?? false, windowsHide: true });
    const timer = setTimeout(() => {
      log.write(`\n[ci-local] timed out after ${formatDuration(STEP_TIMEOUT_MS)}, killing\n`);
      child.kill();
    }, STEP_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => (out ? out.write(chunk) : log.write(chunk)));
    child.stderr.on("data", (chunk) => log.write(chunk));
    const finish = (code) => {
      clearTimeout(timer);
      out?.end();
      if (dataDir) {
        try {
          rmSync(dataDir, { recursive: true, force: true });
        } catch (error) {
          log.write(`\n[ci-local] could not remove ${dataDir}: ${error.message}\n`);
        }
      }
      log.write(`\n[ci-local] exit ${code}\n`);
      resolve(command.ignoreExit ? 0 : code);
    };
    child.on("error", (error) => {
      log.write(`\n[ci-local] spawn failed: ${error.message}\n`);
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

async function runStep(step, ctx) {
  const logFile = path.join(ctx.logDir, `${step.name.replace(/[/:\\]/g, "_")}.log`);
  const log = createWriteStream(logFile);
  const started = Date.now();
  let failed = step.commands.length === 0;
  if (step.note) log.write(`[ci-local] ${step.note}\n`);
  for (const command of step.commands) {
    if ((await runCommand(command, log, ctx)) !== 0) failed = true;
  }
  await new Promise((resolve) => log.end(resolve));
  return { name: step.name, required: step.required, status: failed ? "fail" : "pass", durationMs: Date.now() - started, logFile };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootPkg = readJson(path.join(repoRoot, "package.json"));
  const pnpmVersion = (rootPkg.packageManager ?? "pnpm@9.15.9").split("@")[1];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logDir = path.join(repoRoot, ".ci-local", stamp);
  const ctx = { rootPkg, pnpmVersion, pnpmEntry: findPnpmEntry(pnpmVersion), logDir, workspaces: workspaces() };
  const all = buildSteps(ctx);

  if (args.help) {
    console.log(`Steps (group → name):\n${all.map((s) => `  ${s.group.padEnd(10)} ${s.name}${s.required ? "" : "  (advisory)"}${OPT_IN[s.group] ? `  (only with ${OPT_IN[s.group]})` : ""}`).join("\n")}`);
    return 0;
  }
  const selected = selectSteps(all, args);
  if (selected.length === 0) {
    console.error(`No step matches. Groups: ${[...new Set(all.map((s) => s.group))].join(", ")}`);
    return 1;
  }
  mkdirSync(logDir, { recursive: true });
  console.log(`ci-local: ${selected.length} step(s), logs in ${path.relative(repoRoot, logDir)}`);
  console.log(`pnpm: ${ctx.pnpmEntry ?? `npx pnpm@${pnpmVersion} (fallback)`}\n`);

  const results = [];
  for (const step of selected) {
    const result = await runStep(step, ctx);
    results.push(result);
    const mark = result.status === "pass" ? "pass" : result.required ? "FAIL" : "warn";
    console.log(`${mark.padEnd(4)}  ${step.name.padEnd(34)} ${formatDuration(result.durationMs).padStart(9)}${result.status === "pass" ? "" : `  → ${path.relative(repoRoot, result.logFile)}`}`);
  }

  const summary = formatSummary(results);
  writeFileSync(path.join(logDir, "summary.md"), `${summary}\n`);
  console.log(`\n${summary}`);
  return exitCodeFor(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`ci-local: ${error.message}`);
      process.exit(1);
    },
  );
}

#!/usr/bin/env node
/**
 * The finance accuracy harness.
 *
 *   node packages/host/eval/finance/runner/run.mjs \
 *     [--case <id>] [--task <id>] [--base http://127.0.0.1:3000] [--model <id>] \
 *     [--out <dir>] [--retry-transient]
 *
 * Runs every case against the app that is already running, writes one JSON trace
 * per case, one `summary.md` per run and a `latest.md` beside `results/`, and
 * exits non-zero when a scored case fails. Nothing leaves this machine: the base
 * URL is validated to be loopback before any request, and no key, header or
 * credential is ever written to disk.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRuntime, requireLoopbackBase } from "./client.mjs";
import { readCase } from "./case-schema.mjs";
import { TASK_IDS } from "./adapters/index.mjs";
import { runCaseWithRetry } from "./run-case.mjs";
import { CASE_STATUS } from "./verdict.mjs";
import { runtimeLine, summaryMarkdown } from "./summary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FINANCE_ROOT = resolve(HERE, "..");
export const DEFAULT_BASE = "http://127.0.0.1:3000";
/**
 * Where cases live: the shared set, then the runner's own two. The second root is
 * marked `fixture`, and the verdict line leaves those out — they prove the harness
 * works, and counting them would flatter every run by two.
 */
const CASE_ROOTS = [
  { dir: join(FINANCE_ROOT, "cases"), fixture: false },
  { dir: join(HERE, "__fixtures__"), fixture: true },
];

/** Flags that take no value. */
const SWITCHES = new Set(["retryTransient"]);

function flagName(flag) {
  return flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE,
    out: join(FINANCE_ROOT, "results"),
    case: null,
    task: null,
    model: null,
    retryTransient: false,
  };
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    if (!flag.startsWith("--")) {
      throw new Error(`Unexpected argument ${JSON.stringify(flag)}`);
    }
    const name = flagName(flag);
    if (!(name in options)) {
      throw new Error(`Unknown flag ${flag}. Known flags: --base, --out, --case, --task, --model, --retry-transient`);
    }
    if (SWITCHES.has(name)) {
      options[name] = true;
      continue;
    }
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    options[name] = value;
    at += 1;
  }
  if (options.task !== null && !TASK_IDS.includes(options.task)) {
    throw new Error(`--task must be one of ${TASK_IDS.join(", ")}, got ${JSON.stringify(options.task)}`);
  }
  return options;
}

async function casesUnder(root) {
  let entries;
  try {
    entries = await readdir(root.dir, { withFileTypes: true });
  } catch {
    return { cases: [], invalid: [] };
  }
  const cases = [];
  const invalid = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const dir = join(root.dir, entry.name);
    const file = join(dir, "case.json");
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      // A directory without a case.json is someone's work in progress, not an error.
      continue;
    }
    try {
      cases.push({ ...readCase(JSON.parse(raw), dir, file), fixture: root.fixture });
    } catch (error) {
      // One author's malformed case must not stop the other ten from running.
      invalid.push({
        id: entry.name,
        fixture: root.fixture,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { cases, invalid };
}

export async function loadCases(filters = {}) {
  const loaded = await Promise.all(CASE_ROOTS.map(casesUnder));
  const all = loaded.flatMap((entry) => entry.cases);
  const broken = loaded.flatMap((entry) => entry.invalid);
  const wanted = (kase) => (!filters.case || kase.id === filters.case) && (!filters.task || kase.task === filters.task);
  const cases = all.filter(wanted).sort((left, right) => left.id.localeCompare(right.id));
  // A broken case.json has no task to filter on, so `--task` cannot hide it.
  const invalid = broken.filter((entry) => !filters.case || entry.id === filters.case);
  if (cases.length === 0 && invalid.length === 0) {
    const asked = [filters.case && `case ${filters.case}`, filters.task && `task ${filters.task}`]
      .filter(Boolean)
      .join(" and ");
    throw new Error(`No case matched ${asked || "anything"}. Found: ${all.map((k) => k.id).join(", ") || "none"}`);
  }
  return { cases, invalid };
}

function stamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

async function writeRun(outDir, run) {
  await mkdir(outDir, { recursive: true });
  for (const result of run.results) {
    await writeFile(join(outDir, `${result.id}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  const summary = summaryMarkdown(run);
  await writeFile(join(outDir, "summary.md"), `${summary}\n`, "utf8");
  // One stable path to read the newest run from, beside the timestamped folders.
  await writeFile(join(dirname(outDir), "latest.md"), `${summary}\n\n_Full traces: ${outDir}_\n`, "utf8");
  return summary;
}

function exitCodeFor(results) {
  const bad = results.filter(
    (result) =>
      result.status === CASE_STATUS.fail ||
      result.status === CASE_STATUS.error ||
      result.status === CASE_STATUS.transient,
  );
  return bad.length === 0 ? 0 : 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const base = requireLoopbackBase(options.base);
  const ctx = { base, model: options.model };
  const runtime = await readRuntime(ctx);
  console.log(runtimeLine(runtime));
  const { cases, invalid } = await loadCases({ case: options.case, task: options.task });
  const startedAt = new Date();
  const results = invalid.map((entry) => {
    console.log(`- ${entry.id} … ERROR (case.json is invalid)`);
    return {
      id: entry.id,
      fixture: entry.fixture,
      status: CASE_STATUS.error,
      error: { code: "invalid_case", status: 0, stage: "load", message: entry.message },
    };
  });
  for (const kase of cases) {
    process.stdout.write(`- ${kase.id} (${kase.task}/${kase.locale}) … `);
    const result = await runCaseWithRetry(ctx, kase, { retryTransient: options.retryTransient });
    results.push({ ...result, fixture: kase.fixture });
    console.log(`${result.status} in ${result.totalMs} ms${result.retried ? " (after one retry)" : ""}`);
  }
  const outDir = join(resolve(options.out), stamp(startedAt));
  const summary = await writeRun(outDir, {
    startedAt: startedAt.toISOString(),
    base,
    model: options.model,
    taskFilter: options.task,
    retryTransient: options.retryTransient,
    runtime,
    results,
  });
  console.log(`\n${summary}\n\nwritten to ${outDir}`);
  process.exitCode = exitCodeFor(results);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`finance eval failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}

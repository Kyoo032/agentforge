import assert from "node:assert/strict";
import { test } from "node:test";
import { exitCodeFor, formatDuration, formatSummary, parseArgs, selectSteps, workspaceGlobs } from "./ci-local.mjs";

const STEPS = [
  { group: "install", name: "install", required: true },
  { group: "lint", name: "lint", required: true },
  { group: "tsc", name: "tsc:packages/core", required: true },
  { group: "tsc", name: "tsc:apps/web", required: true },
  { group: "audit", name: "audit:workspace", required: false },
  { group: "e2e", name: "e2e:playwright", required: true },
];
const names = (steps) => steps.map((s) => s.name);

test("parseArgs reads repeatable --only/--skip in both spellings and the opt-in flags", () => {
  const args = parseArgs(["--only", "lint", "--only=tsc", "--skip", "tsc:apps/web", "--e2e", "--install"]);
  assert.deepEqual(args.only, ["lint", "tsc"]);
  assert.deepEqual(args.skip, ["tsc:apps/web"]);
  assert.equal(args.e2e, true);
  assert.equal(args.install, true);
});

test("parseArgs refuses unknown flags and a missing step name", () => {
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
  assert.throws(() => parseArgs(["--only"]), /needs a step name/);
  assert.throws(() => parseArgs(["--only", "--e2e"]), /needs a step name/);
  assert.throws(() => parseArgs(["--skip="]), /needs a step name/);
});

test("selectSteps leaves install and e2e out unless asked for", () => {
  assert.deepEqual(names(selectSteps(STEPS, parseArgs([]))), ["lint", "tsc:packages/core", "tsc:apps/web", "audit:workspace"]);
  assert.deepEqual(names(selectSteps(STEPS, parseArgs(["--e2e", "--install"]))), names(STEPS));
});

test("selectSteps matches --only by group or by full name, and --only enables an opt-in step", () => {
  assert.deepEqual(names(selectSteps(STEPS, parseArgs(["--only", "tsc"]))), ["tsc:packages/core", "tsc:apps/web"]);
  assert.deepEqual(names(selectSteps(STEPS, parseArgs(["--only", "tsc:apps/web", "--only", "e2e"]))), ["tsc:apps/web", "e2e:playwright"]);
});

test("selectSteps applies --skip after --only", () => {
  assert.deepEqual(names(selectSteps(STEPS, parseArgs(["--only", "tsc", "--skip", "tsc:packages/core"]))), ["tsc:apps/web"]);
  assert.deepEqual(names(selectSteps(STEPS, parseArgs(["--e2e", "--skip", "e2e"]))), ["lint", "tsc:packages/core", "tsc:apps/web", "audit:workspace"]);
});

test("exitCodeFor fails only on a required step", () => {
  assert.equal(exitCodeFor([]), 0);
  assert.equal(exitCodeFor([{ required: true, status: "pass" }, { required: false, status: "fail" }]), 0);
  assert.equal(exitCodeFor([{ required: true, status: "fail" }, { required: false, status: "pass" }]), 1);
});

test("formatSummary is a markdown table with a verdict line", () => {
  const summary = formatSummary([
    { name: "lint", required: true, status: "pass", durationMs: 1500 },
    { name: "tsc:apps/web", required: true, status: "fail", durationMs: 61_000 },
    { name: "audit:workspace", required: false, status: "fail", durationMs: 200 },
  ]);
  const lines = summary.split("\n");
  assert.equal(lines[0], "| step | status | duration |");
  assert.equal(lines[2], "| lint | pass | 1.5 s |");
  assert.equal(lines[3], "| tsc:apps/web | FAIL | 1m 1s |");
  assert.equal(lines[4], "| audit:workspace | warn (advisory) | 200 ms |");
  assert.equal(lines.at(-1), "FAIL: 1 required step(s) failed, 1 advisory warning(s).");
  assert.match(formatSummary([{ name: "lint", required: true, status: "pass", durationMs: 1 }]), /OK: every required step passed\.$/);
});

test("formatDuration picks a readable unit", () => {
  assert.equal(formatDuration(999), "999 ms");
  assert.equal(formatDuration(12_340), "12.3 s");
  assert.equal(formatDuration(125_000), "2m 5s");
});

test("workspaceGlobs reads pnpm-workspace.yaml entries, quoted or not", () => {
  assert.deepEqual(workspaceGlobs('packages:\n  - "apps/*"\n  - packages/*\n  - \'tools\' # comment\n'), ["apps/*", "packages/*", "tools"]);
});

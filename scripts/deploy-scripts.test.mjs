/**
 * Tests for the shell in webapp-deploy/scripts/.
 *
 * Node's own runner, like scripts/audit-deployed.test.mjs: these are shell scripts outside every
 * workspace package, so no vitest config collects them. `node --test "scripts/*.test.mjs"` runs
 * this, and .github/workflows/ci.yml does that.
 *
 * Covers docs/internal/security-owasp-2026-09.md A03-4 (the `eval` in `setting`) and A04-1
 * (restore.sh's broken line continuations). Both went unverified by anything automated before.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scriptsDir = fileURLToPath(new URL("../webapp-deploy/scripts/", import.meta.url));
const read = (name) => readFileSync(scriptsDir + name, "utf8");
const names = readdirSync(scriptsDir).filter((name) => name.endsWith(".sh"));

test("every deploy script parses", () => {
  assert.ok(names.length >= 6, `expected the six scripts, found ${names.join(", ")}`);
  for (const name of names) {
    execFileSync("sh", ["-n", scriptsDir + name]);
  }
});

/**
 * A04-1. `restore.sh` carried the two characters `\` and `n` where line continuations were meant,
 * on one physical line. Unquoted in sh, `\n` is the literal character `n`, so the command passed a
 * bare `n` as an argument to `docker compose run` and the restore failed. A recovery path is only
 * ever exercised during a disaster, so nothing would have caught this until it mattered.
 */
test("restore.sh has no literal backslash-n where a continuation belongs", () => {
  const source = read("restore.sh");
  const offenders = source
    .split("\n")
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => /\\n\s*(--|\w)/.test(line) && !line.trim().startsWith("#"));
  assert.deepEqual(offenders, [], `literal \\n in restore.sh at ${offenders.map(([n]) => n).join(", ")}`);
});

test("restore.sh still passes the three capabilities the unpack needs", () => {
  const source = read("restore.sh");
  for (const cap of ["CHOWN", "FOWNER", "DAC_OVERRIDE"]) {
    assert.match(source, new RegExp(`--cap-add ${cap}\\b`), `${cap} is no longer granted`);
  }
  // A continuation joins the lines, so the whole invocation must still be one command.
  assert.match(source, /dc run --rm --no-deps -T --user root \\\n/);
});

/**
 * A03-4. `setting()` reads a variable BY NAME, which POSIX sh has no syntax for, so `eval` is
 * unavoidable — and it runs whatever it is handed. Every caller passes a literal today, so this
 * guard changes no behaviour; it is what stops a future caller passing something off .env or argv.
 */
function callSetting(name, extra = "") {
  const script = `
    set -eu
    ENV_FILE=/dev/null
    REPO_ROOT=.
    ${read("_common.sh")
      .split("\n")
      .filter((line) => !/^(set -eu|DEPLOY_DIR=|REPO_ROOT=|COMPOSE_FILE=|ENV_FILE=)/.test(line))
      .join("\n")
      .replace(/^if docker compose version[\s\S]*?^fi$/m, "dc() { :; }")}
    ${extra}
    setting ${name}
  `;
  try {
    return {
      stdout: execFileSync("sh", ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      stderr: "",
      ok: true,
    };
  } catch (error) {
    return { stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? ""), ok: false };
  }
}

test("setting reads a normal variable and falls back to the default", () => {
  assert.equal(callSetting("GOOD_NAME", "GOOD_NAME=works").stdout, "works");
  assert.equal(callSetting("MISSING_ONE fallback").stdout, "fallback");
});

test("setting refuses a name that is not a shell identifier, without running it", () => {
  for (const attack of ["'X; echo PWNED'", "'$(echo PWNED)'", "'X`echo PWNED`'", "''", "'9LEADING'"]) {
    const { stdout, stderr, ok } = callSetting(attack);
    assert.equal(ok, false, `${attack} was not refused`);
    // stdout is where an executed `echo PWNED` would land. The refusal goes to stderr and quotes
    // the rejected name back, so PWNED appearing THERE is the guard reporting, not running.
    assert.doesNotMatch(stdout, /PWNED/, `${attack} executed`);
    assert.match(stderr, /not a shell identifier/);
  }
});

test("setting still accepts every name the deploy scripts actually pass", () => {
  const callers = names
    .filter((name) => name !== "_common.sh")
    .flatMap((name) => [...read(name).matchAll(/\$\(setting ([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
  assert.ok(callers.length > 0, "no setting() callers found; has the helper been renamed?");
  for (const name of new Set(callers)) {
    assert.equal(callSetting(`${name} ok`).stdout, "ok", `${name} is refused by the guard`);
  }
});

/**
 * Phase 7 — the image carries its components, and they do not live on the tenant volume.
 *
 * Both halves are one-line edits away from being undone by somebody tidying the Dockerfile, and
 * neither fails loudly if it is: without the build check a container ships without `anydoc` and
 * reads every document with the reduced fallback extractor while reporting healthy, and without
 * the separate root the component directory is back inside `/data`, where the host refuses to load
 * it (`packages/host/src/components/paths.ts`) and where security spec H3's `noexec` mount cannot
 * be turned on.
 */
const deployDir = fileURLToPath(new URL("../webapp-deploy/", import.meta.url));
const readDeploy = (name) => readFileSync(deployDir + name, "utf8");

const COMPONENTS_DIR_ENV = "AGENTFORGE_COMPONENTS_DIR";
const COMPONENTS_PATH = "/opt/agentforge/components";

test("the image build fails when a required component is missing", () => {
  const dockerfile = readDeploy("Dockerfile");
  assert.match(
    dockerfile,
    /^RUN .*tsx scripts\/components\.ts check$/m,
    "the Dockerfile no longer proves the image carries its components",
  );
  // In the build stage: the runtime stage has no pnpm store to install from and no need to.
  const buildStage = dockerfile.slice(
    dockerfile.indexOf("FROM base AS build"),
    dockerfile.indexOf("FROM base AS runtime"),
  );
  assert.match(buildStage, /tsx scripts\/components\.ts check/);
});

test("the components root is set, and is not inside the data dir", () => {
  const dockerfile = readDeploy("Dockerfile");
  assert.match(dockerfile, new RegExp(`${COMPONENTS_DIR_ENV}=${COMPONENTS_PATH}`));
  assert.match(dockerfile, new RegExp(`mkdir -p ${COMPONENTS_PATH}`));

  const compose = readDeploy("compose.yml");
  assert.match(compose, new RegExp(`${COMPONENTS_DIR_ENV}: ${COMPONENTS_PATH}`));
  // Its own volume, so an operator install survives a restart and /data stays separable.
  assert.match(compose, new RegExp(`- dpsbuddy-components:${COMPONENTS_PATH}`));
  assert.match(compose, /^ {2}dpsbuddy-components:$/m);

  for (const source of [dockerfile, compose]) {
    assert.doesNotMatch(source, new RegExp(`${COMPONENTS_DIR_ENV}[=:] ?/data`), "the components root is back on /data");
  }
});

test("components.sh drives the CLI inside the container, never the HTTP route", () => {
  const source = read("components.sh");
  assert.match(source, /dc exec -T app .*tsx .*scripts\/components\.ts/);
  assert.doesNotMatch(source, /api\/v1\/components/, "the install route is 403 on this server, for everyone");
  for (const action of ["status", "check", "install"]) {
    assert.match(source, new RegExp(`\\b${action}\\b`), `${action} is no longer offered`);
  }
});

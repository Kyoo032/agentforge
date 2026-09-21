/**
 * Tests for scripts/review-instance.ps1. HARNESS, NEVER SHIPS.
 *
 * Node's own runner, like scripts/review-proxy.test.mjs and scripts/deploy-scripts.test.mjs: a
 * PowerShell script sits outside every workspace package, so no vitest config would collect it,
 * and `node --test "scripts/*.test.mjs"` is what .github/workflows/ci.yml already runs.
 *
 * Two kinds of case, and the split is deliberate:
 *
 *   - Source assertions, which run everywhere including the Linux CI runner. They pin the shape of
 *     the script where getting the shape wrong produced a failure that looked like something else
 *     entirely — see the compose case below.
 *   - One parse case, which needs a PowerShell to parse with and is skipped where there is none.
 *     `powershell -File` reports a syntax error at run time, which on this script means after it
 *     has printed the plan and possibly started a process, so parsing it up front is worth having.
 *
 * Nothing here runs the script, binds a port, or talks to Docker.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const scriptPath = fileURLToPath(new URL("./review-instance.ps1", import.meta.url));
const source = readFileSync(scriptPath, "utf8");

/** The first PowerShell that answers, or null — CI is Linux and usually has none. */
function findPowerShell() {
  for (const candidate of ["pwsh", "powershell"]) {
    try {
      execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  return null;
}

const powershell = findPowerShell();

test("the script parses", { skip: powershell ? false : "no PowerShell on this machine" }, () => {
  const command = [
    "$errors = $null; $tokens = $null;",
    `[void][System.Management.Automation.Language.Parser]::ParseFile('${scriptPath.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors);`,
    'if ($errors -and $errors.Count -gt 0) { $errors | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }; exit 1 }',
  ].join(" ");
  execFileSync(powershell, ["-NoProfile", "-Command", command], { stdio: "pipe" });
});

/**
 * `apps/portal/compose.yml` interpolates `${PORTAL_POSTGRES_PASSWORD:?…}`, which makes EVERY
 * `docker compose` subcommand fail — `ps` and `config` as much as `up` — when the variable is not
 * in the environment. The script set it around `up -d` only, so the health poll that follows ran
 * `docker compose ps -q postgres`, got a non-zero exit for a reason that had nothing to do with
 * Postgres, never resolved a container id, and refused the launch 120 seconds later with
 * "Postgres did not become healthy" while Postgres was in fact healthy and serving.
 *
 * So: exactly one place builds a compose command line, and that place is the one that owns the
 * variable. A second `@('compose'…)` anywhere else is the bug coming back.
 */
test("every docker compose call goes through the one helper that supplies the password", () => {
  const composeCalls = source.match(/@\(\s*'compose'/g) ?? [];
  assert.equal(
    composeCalls.length,
    1,
    `expected exactly one compose command line (inside Invoke-Compose), found ${composeCalls.length}`,
  );
  assert.match(source, /function Invoke-Compose/, "the helper is named Invoke-Compose");
  const helper = source.slice(source.indexOf("function Invoke-Compose"));
  const body = helper.slice(0, helper.indexOf("\nfunction "));
  assert.match(
    body,
    /SetEnvironmentVariable\('PORTAL_POSTGRES_PASSWORD'/,
    "Invoke-Compose must put PORTAL_POSTGRES_PASSWORD in the environment around the call",
  );
});

/**
 * The refusal that matters most, checked as text because the alternative is running the script.
 * `:3000` is the operator's shared webdev instance and `.webdev-data` is its desk.
 */
test("the data-dir guard still refuses .webdev-data and the checkout", () => {
  assert.match(source, /\.webdev-data/, "the guard names .webdev-data");
  assert.match(source, /resolves inside this checkout/, "the guard refuses a data dir in the tree");
});

/** -Stop may only kill what -Start recorded, and only when the start time still matches. */
test("-Stop kills recorded pids, never a port", () => {
  assert.match(source, /function Stop-ReviewProcesses/);
  const stop = source.slice(source.indexOf("function Stop-ReviewProcesses"));
  const body = stop.slice(0, stop.indexOf("\n<#"));
  assert.match(body, /Get-Process -Id \$processId/, "it looks the recorded id up");
  assert.match(body, /\$recorded -ne \$actual/, "it compares the recorded start time");
  assert.doesNotMatch(body, /Get-NetTCPConnection|LocalPort/, "it must never find a victim by port");
});

/**
 * Both origins, always. The loopback proxy is how the instance is driven with curl and how it is
 * reviewed without a tunnel; dropping it the moment -AppPublicUrl is passed would 403 every
 * mutating call from the operator's own machine (isAllowedWebHostHeader, packages/host).
 */
test("the trusted origin list carries the proxy origin as well as the public one", () => {
  assert.match(source, /\$TrustedOrigins = \(@\(\$ProxyOrigin, \$PublicUrl\)/);
  assert.match(source, /\$RedirectUris = @\(\$ProxyOrigin, \$PublicUrl\)/);
});

/**
 * SR-01 / SR-34. The script used to seed the literal Postgres password `portal` into review.env,
 * which is a password in git whatever the container is published on — `apps/portal/compose.yml`
 * has had no default of its own since `${PORTAL_POSTGRES_PASSWORD:?…}` landed.
 */
test("no Postgres password literal is seeded into review.env", () => {
  const initialize = source.slice(source.indexOf("function Initialize-ReviewEnv"));
  const body = initialize.slice(0, initialize.indexOf("\nfunction "));
  assert.doesNotMatch(body, /'portal'\s*\}/, "the literal password must not be a generator");
  assert.match(
    body,
    /'PORTAL_POSTGRES_PASSWORD'\s*=\s*\{\s*Resolve-PostgresPassword\s*\}/,
    "the password comes from Resolve-PostgresPassword",
  );
});

/**
 * The half that is not "generate a random one". `POSTGRES_PASSWORD` is read by initdb on the first
 * start of an empty volume and never again, so a volume that already exists keeps the password it
 * was built with. Generating a new one there produces a DSN that database refuses, and the failure
 * reads as a portal bug — so it stops with an instruction instead.
 */
test("an existing compose volume with no recorded password stops the script", () => {
  assert.match(source, /function Resolve-PostgresPassword/);
  const resolver = source.slice(source.indexOf("function Resolve-PostgresPassword"));
  const body = resolver.slice(0, resolver.indexOf("\nfunction "));

  assert.match(body, /Test-PortalVolume/, "it asks whether the volume is there");
  assert.match(body, /if \(\$state -eq 'present'\) \{\s*\n\s*throw/, "present volume: throw, never generate");
  assert.match(body, /if \(\$state -eq 'unknown'\) \{\s*\n\s*throw/, "cannot tell: throw, never guess");
  assert.match(body, /New-SecretHex/, "absent volume: a generated password");

  // The instruction has to be actionable, not just a refusal.
  assert.match(source, /docker compose -f "\{2\}" down -v/, "it names how to start clean");
  assert.match(source, /\\password portal/, "it names how to change the volume's password");
});

/** Reading a volume is not a compose call, so it must not need the password it is deciding. */
test("the volume probe is a plain docker call, outside Invoke-Compose", () => {
  assert.match(source, /function Test-PortalVolume/);
  const probe = source.slice(source.indexOf("function Test-PortalVolume"));
  const body = probe.slice(0, probe.indexOf("\n$VOLUME_HAS_ITS_OWN_PASSWORD"));
  assert.match(body, /@\('volume', 'inspect', \$ComposeVolume\)/);
  assert.doesNotMatch(body, /Invoke-Compose/, "it must not need the variable it is resolving");
});

/** A value already in review.env is authoritative: re-running never rotates one. */
test("Initialize-ReviewEnv fills in only what is missing", () => {
  const initialize = source.slice(source.indexOf("function Initialize-ReviewEnv"));
  const body = initialize.slice(0, initialize.indexOf("\nfunction "));
  assert.match(body, /if \(-not \$existing\.ContainsKey\(\$name\)\)/);
});

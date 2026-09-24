/**
 * `scripts/components.ts` — the per-server component installer, driven for real.
 *
 * Node's own runner, like `scripts/deploy-scripts.test.mjs`: this script lives outside every
 * workspace package, so no vitest config collects it, and `pnpm ci:local` (scripts/ci-local.mjs) runs
 * `node --test "scripts/*.test.mjs"`.
 *
 * Nothing here reaches the network. The cases are the ones that decide whether an operator gets a
 * sentence they can act on: a wrong invocation, and the refusal that stops an install landing in a
 * directory a hosted server will then decline to read. `check` on a machine that has `anydoc` is
 * what the image build runs, and that is asserted from the Dockerfile side in
 * `deploy-scripts.test.mjs` rather than by downloading 8 MB here.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
/**
 * apps/web's tsx, by its JS entry, run with this Node. Not `apps/web/node_modules/.bin/tsx`: that is
 * an extensionless POSIX shell shim, which Windows cannot execute, so every case got a null status.
 */
const tsxCli = createRequire(join(repoRoot, "apps/web/package.json")).resolve("tsx/cli");
const script = join(repoRoot, "scripts/components.ts");
const dataDir = mkdtempSync(join(tmpdir(), "agentforge-components-cli-"));

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** The CLI in a clean environment: only what a case sets, plus a data dir it may not write to. */
function run(args, env = {}) {
  const result = spawnSync(process.execPath, [tsxCli, script, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "test",
      AGENTFORGE_DATA_DIR: dataDir,
      ...env,
    },
  });
  return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

test("a missing or unknown command exits 2 with the usage line", () => {
  const none = run([]);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /Usage: tsx scripts\/components\.ts <status \| check \| install>/);

  const wrong = run(["uninstall"]);
  assert.equal(wrong.code, 2);
  assert.match(wrong.stderr, /Unknown command "uninstall"/);
});

test("status reports the mode and the components root, and never fails", () => {
  const desk = run(["status"]);
  assert.equal(desk.code, 0, desk.stderr);
  assert.match(desk.stdout, /^mode: desk \/ webdev$/m);
  assert.match(desk.stdout, /components root: inside the data directory/);
  assert.match(desk.stdout, /\banydoc@\d+\.\d+\.\d+\b/);

  const server = run(["status"], { AGENTFORGE_SERVER: "1" });
  assert.equal(server.code, 0, server.stderr);
  assert.match(server.stdout, /^mode: server \(AGENTFORGE_SERVER=1\)$/m);
});

/**
 * The refusal that matters. Unpacking into `<data dir>/components` on a server "succeeds" and then
 * the app never loads a byte of it, because a hosted box does not `createRequire` native code out
 * of the tenant volume. An operator would be left with a green install and a component that keeps
 * reporting `missing`, so the CLI says no before it writes, and names the variable to set.
 */
test("install refuses on a server whose components root is inside the data dir", () => {
  const unset = run(["install"], { AGENTFORGE_SERVER: "1" });
  assert.equal(unset.code, 1);
  assert.match(unset.stderr, /AGENTFORGE_COMPONENTS_DIR must name a directory OUTSIDE AGENTFORGE_DATA_DIR/);

  const inside = run(["install"], {
    AGENTFORGE_SERVER: "1",
    AGENTFORGE_COMPONENTS_DIR: join(dataDir, "components"),
  });
  assert.equal(inside.code, 1);
  assert.match(inside.stderr, /AGENTFORGE_COMPONENTS_DIR must name a directory OUTSIDE/);

  // And nothing was written into the data dir on the way to refusing.
  const after = run(["status"], { AGENTFORGE_SERVER: "1" });
  assert.doesNotMatch(after.stdout, /components root: (?!inside the data directory)/);
});

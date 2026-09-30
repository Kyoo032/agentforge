import { isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { localDataDir } from "@agentforge/db/vault-key";

/**
 * Is `dataDir` somewhere under the OS temp directory, where a test may write whatever it likes?
 *
 * Pure, so it can be tested with paths and not with a real desk.
 */
export function isThrowawayDesk(dataDir: string, root: string = tmpdir()): boolean {
  const rel = relative(resolve(root), resolve(dataDir));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Refuse to run a test that creates desks anywhere but a throwaway data dir.
 *
 * `packages/host/test/setup.ts` points every host test at a `mkdtemp` desk, but only when vitest
 * picks up `packages/host/vitest.config.ts`. Run the same file from another directory (or through a
 * config that is not the host's) and `localDataDir()` falls back to `<repo>/data`, the operator's own
 * desk: `cross-desk.test.ts` did exactly that fourteen times and left 112 `edit-idor-<hex>` desks in
 * the dev desk's switcher (8 per run, 2026-09-15 and 2026-09-17). A test that writes a desk calls this
 * first, so the wrong directory is a red test and not a polluted desk.
 */
export function assertThrowawayDesk(dataDir: string = localDataDir()): void {
  if (!isThrowawayDesk(dataDir)) {
    throw new Error(
      `This test creates desks and must not run against ${dataDir}. Run it from packages/host ` +
        "(`npx vitest run <file>` there), where test/setup.ts points it at a throwaway desk.",
    );
  }
}

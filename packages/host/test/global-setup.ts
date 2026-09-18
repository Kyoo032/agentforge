/**
 * Creates the throwaway desk root the workers write into (see ./setup.ts) and removes it
 * when the run ends. Best effort: a leftover directory under the OS temp dir is harmless,
 * and on Windows a still-open sqlite handle can refuse the delete.
 */
import { mkdirSync, rmSync } from "node:fs";

const root = process.env.AGENTFORGE_HOST_TEST_ROOT;

export function setup(): void {
  if (root) {
    mkdirSync(root, { recursive: true });
  }
}

export function teardown(): void {
  if (!root) {
    return;
  }
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Leave it for the OS to reap.
  }
}

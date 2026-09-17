import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Evaluated once, in the vitest main process, before any worker starts. The pid keeps two
// concurrent runs off each other's desk; ./test/global-setup.ts reaps it at the end.
const hostTestRoot = join(tmpdir(), `agentforge-host-vitest-${process.pid}`);
// Read by global-setup.ts (same process) and handed to the workers through `test.env` below.
process.env.AGENTFORGE_HOST_TEST_ROOT = hostTestRoot;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // Runs before every test module: points the suite at a throwaway desk instead of the
    // operator's data/ directory, so a stored gateway key can't turn "stub" into a live call.
    setupFiles: ["./test/setup.ts"],
    env: {
      AGENTFORGE_HOST_TEST_ROOT: hostTestRoot,
    },
  },
});

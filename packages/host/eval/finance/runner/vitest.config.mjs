import { defineConfig } from "vitest/config";

/**
 * The harness lives outside `packages/host/src`, which the package's own vitest
 * config scopes itself to. Its pure parts still have to be tested, so they get
 * their own root:
 *
 *   cd packages/host && npx vitest run --root eval/finance/runner
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["*.test.mjs"],
  },
});

import { defineConfig } from "vitest/config";

/**
 * The harness lives outside `packages/host/src`, which the package's own vitest config scopes itself
 * to. Its pure parts still have to be tested, so they get their own root:
 *
 *   cd packages/host && npx vitest run --root eval/models
 *
 * (or `pnpm --filter @agentforge/host eval:models:test`). Nothing here reaches a network: every call
 * goes through a fake `fetch` the test passes in, and `test-setup.ts` makes a stray real one throw.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["*.test.ts"],
    setupFiles: ["./test-setup.ts"],
  },
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": dir },
  },
  test: {
    environment: "node",
    // `lib` is the renderer's; `server` holds the boot guards `server.ts` loads, which import
    // `@agentforge/host` and must not sit in a directory a component can reach through `@/lib`.
    include: ["lib/**/*.test.ts", "lib/**/*.test.tsx", "server/**/*.test.ts"],
    passWithNoTests: true,
  },
});

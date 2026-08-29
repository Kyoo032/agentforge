import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

delete process.env.DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      AGENTFORGE_RUNTIME: "stub",
      AGENTFORGE_DATA_DIR: resolve(process.cwd(), "../../data"),
    },
  },
});

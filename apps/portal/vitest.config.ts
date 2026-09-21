import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // One real PostgreSQL for the run; every file then takes a private database from the template
    // it builds. See the header of test/global-setup.ts for why a fake would prove nothing here.
    globalSetup: ["./test/global-setup.ts"],
    // initdb + the first template build is slow on Windows; the per-file CREATE DATABASE after
    // that is not.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 60_000,
  },
});

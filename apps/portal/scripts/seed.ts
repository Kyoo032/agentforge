#!/usr/bin/env tsx
/**
 * `pnpm portal:seed -- --email <address> [--tenant dpsbuddy] [--org Kyo] [--seat-cap N]
 *                      [--redirect <uri> ...] [--rotate-secret]`
 *
 * A thin shell around `runSeed`: parse, open, migrate, seed, print, close. Everything worth
 * testing is in `src/seed/`.
 */
import { mkdir } from "node:fs/promises";
import { loadConfig, PortalConfigError } from "../src/config";
import { formatSeedReport, runSeed } from "../src/seed/seed";
import { parseSeedArgs, SeedArgsError } from "../src/seed/args";
import { openStore } from "../src/store";

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const config = loadConfig();
  await mkdir(config.dataDir, { recursive: true });

  const store = openStore(config);
  try {
    await store.migrate();
    const result = await runSeed(store, args);
    process.stdout.write(`${formatSeedReport(result)}\n`);
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SeedArgsError || error instanceof PortalConfigError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

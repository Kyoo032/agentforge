#!/usr/bin/env tsx
/**
 * `pnpm portal:seed -- --email <address> [--tenant dpsbuddy] [--org Kyo] [--seat-cap N]
 *                      [--redirect <uri> ...] [--rotate-secret]`
 *
 * A thin shell around `runSeed`: parse, migrate as the owner, open the server's connection, seed,
 * print, close. Everything worth testing is in `src/seed/`. The seed writes through the same role
 * the server uses (`portal_app` holds every grant it needs), so what it writes is exactly what the
 * server's tenant policies let it write.
 */
import { mkdir } from "node:fs/promises";
import { migrateAsOwner } from "../src/boot";
import { loadConfig, PortalConfigError } from "../src/config";
import { formatSeedReport, runSeed } from "../src/seed/seed";
import { parseSeedArgs, SeedArgsError } from "../src/seed/args";
import { openStore } from "../src/store";

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const config = loadConfig();
  await mkdir(config.dataDir, { recursive: true });

  await migrateAsOwner(config);
  const store = openStore(config);
  try {
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

#!/usr/bin/env tsx
/** `pnpm --filter @agentforge/portal migrate` — apply 0001-0005 (theirs) then 0006+ (ours). */
import { loadConfig, PortalConfigError } from "../src/config";
import { openStore } from "../src/store";

async function main(): Promise<void> {
  const config = loadConfig();
  const store = openStore(config);
  try {
    const result = await store.migrate();
    for (const id of result.applied) {
      process.stdout.write(`applied  ${id}\n`);
    }
    for (const id of result.skipped) {
      process.stdout.write(`skipped  ${id}\n`);
    }
    process.stdout.write(`\n${result.applied.length} applied, ${result.skipped.length} already there.\n`);
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof PortalConfigError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

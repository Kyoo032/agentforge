#!/usr/bin/env tsx
/**
 * `pnpm --filter @agentforge/portal migrate` — apply 0001-0005 (theirs) then 0006+ (ours), as the
 * schema owner (`PORTAL_MIGRATE_DATABASE_URL`, or `PORTAL_DATABASE_URL` outside production when it
 * is unset). Outside production this also sets `portal_app_login`'s password from
 * `PORTAL_DATABASE_URL` when that DSN names it (`src/boot.ts`).
 */
import { migrateAsOwner } from "../src/boot";
import { loadConfig, PortalConfigError } from "../src/config";

async function main(): Promise<void> {
  const config = loadConfig();
  const result = await migrateAsOwner(config);
  for (const id of result.applied) {
    process.stdout.write(`applied  ${id}\n`);
  }
  for (const id of result.skipped) {
    process.stdout.write(`skipped  ${id}\n`);
  }
  process.stdout.write(`\n${result.applied.length} applied, ${result.skipped.length} already there.\n`);
}

main().catch((error: unknown) => {
  if (error instanceof PortalConfigError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

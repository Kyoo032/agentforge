/**
 * The wrap-key rotation drill (Phase 4).
 *
 * Re-seals every tenant's stored settings from one `AGENTFORGE_SECRETS_KEY` to another. Read
 * `docs/internal/web-phase4-tenant-secrets.md` §5 before running it against anything real — the
 * short version is: back the data directory up, rehearse with `--dry-run`, run it, then restart the
 * app with the new key in its environment.
 *
 * Usage, from the repository root:
 *
 *   AGENTFORGE_DATA_DIR=/srv/agentforge/data \
 *   AGENTFORGE_SERVER=1 \
 *   pnpm exec tsx scripts/rotate-wrap-key.ts --from <current-key> --to <new-key> [--dry-run]
 *
 * Either key may be given as `--from-env NAME` / `--to-env NAME` instead, which is what an operator
 * should do: a key passed as an argument is in the shell history and in `ps` output for as long as
 * the process runs. Nothing here ever prints a key, and the exit code is the result:
 *
 *   0  rotated (or, with --dry-run, would rotate) and every payload opened with the new key
 *   1  refused before writing anything — a bad key, or a payload that would not open
 *   2  called wrongly (missing arguments)
 *
 * AGENTFORGE_SERVER decides which store is rotated, exactly as it decides which one the app uses:
 * set it to 1 for a hosted deployment (rows in `tenant_state`), leave it unset for a desk (the
 * per-tenant files). Rotating the wrong store is a no-op that reports 0 tenants, not a loss.
 */
import { isServerMode } from "../packages/core/src/server-mode";

/**
 * Every import of the host below is dynamic, and they all have to stay that way.
 *
 * `tsx` compiles this file to CJS, so a static `import` here becomes a `require` while an
 * `await import()` goes through Node's ESM loader. Mix the two over the same host module and the
 * process ends up with two copies of `tenant-state-store.ts`: the connection installs into one and
 * the rotation reads the other, which fails with `tenant_state_backend_missing` as surely as
 * installing nothing at all. `wrap-key-rotation-script.test.ts` runs this file for real and would
 * go red again if a static host import crept back in.
 *
 * Keeping the whole graph behind the server-mode branch also keeps the desk case honest: importing
 * `@agentforge/db` OPENS the SQLite file and runs its migrations as a side effect, and a `--dry-run`
 * rehearsal on a desk has no business touching a database it is not rotating.
 */
type HostRotation = typeof import("../packages/host/src/wrap-key-rotation");

type Args = { from: string; to: string; dryRun: boolean };

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function readKey(argv: string[], flag: string, envFlag: string, label: string): string {
  const direct = argv.indexOf(flag);
  if (direct !== -1) {
    const value = argv[direct + 1];
    if (!value || value.startsWith("--")) {
      fail(`${flag} needs a value.`, 2);
    }
    return value;
  }
  const fromEnv = argv.indexOf(envFlag);
  if (fromEnv !== -1) {
    const name = argv[fromEnv + 1];
    if (!name || name.startsWith("--")) {
      fail(`${envFlag} needs the NAME of an environment variable.`, 2);
    }
    const value = process.env[name]?.trim();
    if (!value) {
      fail(`${name} is not set, so there is no ${label} key to use.`, 2);
    }
    return value;
  }
  fail(`Pass the ${label} key as ${flag} <key> or ${envFlag} <ENV_NAME>.`, 2);
}

function parseArgs(argv: string[]): Args {
  return {
    from: readKey(argv, "--from", "--from-env", "current"),
    to: readKey(argv, "--to", "--to-env", "new"),
    dryRun: argv.includes("--dry-run"),
  };
}

/**
 * Load the rotation, with the hosted store's database connection installed if that is the store.
 *
 * `router.ts` installs it for a request; this process is not a request, so nothing had, and pointed
 * at a hosted deployment — the one thing its own header tells an operator to do — the script died
 * with `tenant_state_backend_missing` before reading a byte. `tenant-state-store.ts` fails closed
 * rather than silently reading the desktop's files, which is the right call and is why this showed
 * up as a crash instead of a rotation that quietly did nothing. Every test until now injected a
 * backend, so none of them went near it.
 */
async function loadRotation(): Promise<HostRotation> {
  if (isServerMode()) {
    await import("../packages/host/src/tenant-state-db");
  }
  return await import("../packages/host/src/wrap-key-rotation");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { rotateWrapKey, WrapKeyRotationError } = await loadRotation();
  try {
    const result = rotateWrapKey({ from: args.from, to: args.to, dryRun: args.dryRun });
    const verb = result.dryRun ? "would re-seal" : "re-sealed";
    console.log(`${result.backend} store: ${verb} ${result.rotated.length} tenant(s).`);
    if (result.rotated.length > 0) {
      console.log(`  tenants: ${result.rotated.join(", ")}`);
    }
    if (result.skipped.length > 0) {
      console.log(`  no stored settings: ${result.skipped.join(", ")}`);
    }
    if (result.dryRun) {
      console.log("Dry run: nothing was written. Re-run without --dry-run to rotate.");
    } else {
      console.log("Every re-sealed payload was read back and opened with the new key.");
      console.log("Set AGENTFORGE_SECRETS_KEY to the new key and restart the app.");
    }
  } catch (error) {
    if (error instanceof WrapKeyRotationError) {
      fail(error.tenantId ? `Refused (tenant ${error.tenantId}): ${error.message}` : `Refused: ${error.message}`, 1);
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  // A throw past `main`'s own handler is a bug, not a refusal; it exits 1 like any other failure to
  // rotate, but with its stack, because nothing has been written at that point either.
  console.error(error);
  process.exit(1);
});

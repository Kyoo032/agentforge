/**
 * The component installer, per server (Phase 7).
 *
 * The desk installs its own components on first run, from the renderer, over
 * `POST /api/v1/components/install/stream`. A hosted server does not: that route answers
 * `install_disabled` (403) whenever `AGENTFORGE_SERVER=1`, because the component directory and the
 * native module in it are shared by every tenant, so an install is the operator's action and the
 * box's bandwidth. This script is that action.
 *
 * Usage, from the repository root:
 *
 *   pnpm exec tsx scripts/components.ts status     what this machine has, and where it loads from
 *   pnpm exec tsx scripts/components.ts check      exit 1 if a required component does not load
 *   pnpm exec tsx scripts/components.ts install    install whatever is missing, then check again
 *
 * `check` is what the image build runs (`webapp-deploy/Dockerfile`), so a container that would boot
 * without `anydoc` fails to build instead of serving reduced document reading to everybody, quietly,
 * for a month. `install` is what an operator runs on a CVM through
 * `webapp-deploy/scripts/components.sh` when a version is bumped between images.
 *
 * Exit codes are the result, so a Dockerfile `RUN` and a shell `if` both work:
 *
 *   0  every required component loads (after installing, for `install`)
 *   1  one does not, or an install failed
 *   2  called wrongly
 *
 * NOTHING here decides what to download. `packages/host/src/components/manifest.ts` owns every URL,
 * version and sha512, exactly as it does for the desk's first run; this script names an id and the
 * same stage runner does the rest, with the same integrity check before a byte is unpacked.
 *
 * WHERE IT INSTALLS TO. `AGENTFORGE_COMPONENTS_DIR`, or `<data dir>/components` when it is unset.
 * On a hosted server that variable must be set and must point outside `AGENTFORGE_DATA_DIR`:
 * `/data` is the tenant volume, and a server refuses to load a native module out of it
 * (`packages/host/src/components/paths.ts`, security spec H3). `install` refuses up front rather
 * than unpacking 8 MB into a directory the app will then decline to read.
 */
import { isServerMode } from "../packages/core/src/server-mode";

/**
 * Every host import below is dynamic, and they all have to stay that way — the same rule
 * `scripts/rotate-wrap-key.ts` documents. `tsx` compiles this file to CJS, so a static `import`
 * becomes a `require` while an `await import()` goes through Node's ESM loader; mixing the two over
 * `components/install.ts` would give the process two copies of its in-flight register, and the
 * `busy` guard would then be guarding nothing.
 */
type ComponentsModules = {
  readonly install: typeof import("../packages/host/src/components/install");
  readonly server: typeof import("../packages/host/src/components/server");
  readonly paths: typeof import("../packages/host/src/components/paths");
};

type Command = "status" | "check" | "install";
const COMMANDS: readonly Command[] = ["status", "check", "install"];

function fail(message: string, code: number): never {
  console.error(message);
  process.exit(code);
}

function parseCommand(argv: string[]): Command {
  const [first] = argv;
  if (!first) {
    fail(`Usage: tsx scripts/components.ts <${COMMANDS.join(" | ")}>`, 2);
  }
  if (!(COMMANDS as readonly string[]).includes(first)) {
    fail(`Unknown command "${first}". Expected one of: ${COMMANDS.join(", ")}.`, 2);
  }
  return first as Command;
}

async function load(): Promise<ComponentsModules> {
  return {
    install: await import("../packages/host/src/components/install"),
    server: await import("../packages/host/src/components/server"),
    paths: await import("../packages/host/src/components/paths"),
  };
}

function printReport(report: import("../packages/host/src/components/server").ServerComponentReport): void {
  console.log(`mode: ${report.serverMode ? "server (AGENTFORGE_SERVER=1)" : "desk / webdev"}`);
  console.log(`components root: ${report.managedRoot ?? "inside the data directory (not operator-managed)"}`);
  for (const row of report.rows) {
    console.log(`  ${row.ok ? "ok     " : "MISSING"} ${row.id}@${row.version} — ${row.detail}`);
  }
}

/**
 * Refuse an install that would land where the app will not read it.
 *
 * Better a refusal with the variable to set than an install that reports success while
 * `GET /api/v1/components` keeps answering `missing`, which is what would otherwise happen: the
 * unpack and the probe both work on the directory directly, and only the LOADER applies the rule.
 */
function refuseUnmanagedServerInstall(modules: ComponentsModules): void {
  if (!isServerMode() || modules.paths.managedComponentsRoot() !== null) {
    return;
  }
  fail(
    `Refused: in server mode ${modules.paths.COMPONENTS_DIR_ENV} must name a directory OUTSIDE ` +
      "AGENTFORGE_DATA_DIR before anything is installed into it. A hosted server does not load " +
      "native modules out of the tenant data volume, so an install there would never be used. " +
      "Set it (the image uses /opt/agentforge/components) and run this again.",
    1,
  );
}

async function installMissing(modules: ComponentsModules): Promise<void> {
  refuseUnmanagedServerInstall(modules);
  for (const row of modules.server.serverComponentReport().rows) {
    if (row.ok) {
      console.log(`  ${row.id}@${row.version} is already here (${row.detail}); nothing to do.`);
      continue;
    }
    console.log(`  installing ${row.id}@${row.version} …`);
    try {
      const status = await modules.install.installComponent(row.id);
      console.log(`  ${row.id}: ${status.state}${status.source ? ` (${status.source})` : ""}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`  ${row.id}: install failed — ${message}`, 1);
    }
  }
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const modules = await load();

  if (command === "install") {
    await installMissing(modules);
  }

  // Re-read after an install so what is printed is what the app would load, not what we hoped.
  const report = modules.server.serverComponentReport();
  printReport(report);

  if (command === "status") {
    return;
  }
  if (!report.ok) {
    const missing = report.rows
      .filter((row) => !row.ok)
      .map((row) => row.id)
      .join(", ");
    fail(`Missing on this machine: ${missing}. Run "tsx scripts/components.ts install".`, 1);
  }
  console.log("Every required component loads.");
}

main().catch((error: unknown) => {
  // A throw past the handlers above is a bug, not a refusal. Nothing partial is left behind: the
  // installer promotes a staging directory and writes its marker last.
  console.error(error);
  process.exit(1);
});

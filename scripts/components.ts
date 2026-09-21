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
 * for a month.
 *
 * `install` IS A REPAIR, NOT AN UPGRADE PATH. A manifest bump is a rebuild, full stop: the image
 * carries the components, the build check proves it, and a new version reaches a server the same
 * way every other change does. What `install` is for is the box whose bundled copy is present but
 * does not load — a corrupt layer, a binding built for the wrong libc — where fetching the
 * manifest's copy into the operator-owned root gets document reading back without waiting for a
 * rebuild. It installs only what is MISSING and skips anything the probe already loads, so on an
 * image that passed the build check it does nothing at all, by design.
 *
 * AFTER AN INSTALL THAT ACTUALLY INSTALLED SOMETHING, RESTART THE APP.
 * `packages/host/src/file-extract/anydoc.ts` memoises the load for the life of the process,
 * failure included, and this script is a different process from the server. Until the app restarts
 * it keeps using the fallback reader it already decided on.
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

/**
 * Install the components that do not load, and nothing else.
 *
 * Returns how many were actually installed, because that decides whether the caller has to say
 * "restart". Zero is the normal answer on a healthy image: the build check passed, so every probe
 * already resolves the bundled copy and there is nothing to fetch. That is not a silent no-op
 * pretending to be an upgrade — a new manifest version arrives in a new image, and this command
 * exists for the box whose bundled copy stopped loading.
 */
async function installMissing(modules: ComponentsModules): Promise<number> {
  refuseUnmanagedServerInstall(modules);
  let installed = 0;
  for (const row of modules.server.serverComponentReport().rows) {
    if (row.ok) {
      console.log(
        `  ${row.id}@${row.version} already loads (${row.detail}); nothing to install. ` +
          "A newer version comes with a new image, not with this command.",
      );
      continue;
    }
    console.log(`  installing ${row.id}@${row.version} …`);
    try {
      const status = await modules.install.installComponent(row.id);
      console.log(`  ${row.id}: ${status.state}${status.source ? ` (${status.source})` : ""}`);
      installed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(`  ${row.id}: install failed — ${message}`, 1);
    }
  }
  return installed;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const modules = await load();

  let installed = 0;
  if (command === "install") {
    installed = await installMissing(modules);
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
  if (installed > 0) {
    /*
     * The running server has not noticed. `file-extract/anydoc.ts` caches its loader result,
     * failure included, for the life of the process, and only an in-process `resetAnydocCache()`
     * clears it — which this separate process cannot call. The install is on disk; the app is not
     * using it yet.
     */
    console.log(
      "Restart the app so it picks this up: docker compose -f webapp-deploy/compose.yml restart app " +
        "(the running process cached its previous answer and will keep using the fallback reader).",
    );
  }
}

main().catch((error: unknown) => {
  // A throw past the handlers above is a bug, not a refusal. Nothing partial is left behind: the
  // installer promotes a staging directory and writes its marker last.
  console.error(error);
  process.exit(1);
});

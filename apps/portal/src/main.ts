/** `pnpm portal:dev` — config, migrations, store, server, and a clean shutdown. */
import { mkdir } from "node:fs/promises";
import { prepareStore } from "./boot";
import { loadConfig, PortalConfigError } from "./config";
import { createRuntime } from "./flows/context";
import { resolveKeyring } from "./jwt/keys";
import { log } from "./log";
import { createMailer } from "./mail";
import { installProcessGuards } from "./process-guards";
import { registerPortalRoutes } from "./routes";
import { createPortalServer } from "./server";

// First, before anything can fail: a rejection or exception that nothing handled is written
// through the portal's logger, and then the process exits 1 for the supervisor to restart it.
installProcessGuards({ target: process, log, exit: (code) => process.exit(code) });

async function main(): Promise<void> {
  const config = loadConfig();
  await mkdir(config.dataDir, { recursive: true });

  // Migrations on the owner's connection, which is closed again before anything listens; then the
  // server's own connection, refused in production if it can see past a tenant policy (boot.ts).
  const store = await prepareStore(config, log);

  // The keyring is resolved before anything listens: in production a missing PORTAL_SIGNING_KEY
  // must stop the process, not surface as a 500 on the first sign-in.
  const keys = resolveKeyring(config, log);
  const mailer = createMailer(config, log);

  const portal = createPortalServer({ config, store });
  const runtime = createRuntime({ config, store, log, mailer, keys });
  registerPortalRoutes(portal, runtime);

  const { host, port } = await portal.listen();
  log.info("portal_listening", {
    host,
    port,
    production: config.production,
    issuer: runtime.issuer,
    trustProxy: runtime.trustProxy,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info("portal_stopping", { signal });
    await portal.close();
    await mailer.close();
    await store.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  if (error instanceof PortalConfigError) {
    // A config problem is the operator's to fix, so it is printed as prose, not as a stack.
    console.error(error.message);
    process.exit(2);
  }
  log.error("portal_failed", { reason: error instanceof Error ? error.message : "unknown" });
  process.exit(1);
});

/**
 * The store's front door.
 *
 * There is one driver. `PORTAL_DATABASE_URL` is validated as a Postgres DSN in `../config.ts`, so
 * by the time anything reaches here the question "which backend?" has already been answered.
 */
import type { PortalConfig } from "../config";
import { openPostgresStore } from "./postgres";
import type { Clock, PortalStore } from "./types";

export { openPostgresStore } from "./postgres";
export * from "./types";

export function openStore(config: PortalConfig, clock?: Clock): PortalStore {
  return openPostgresStore({ databaseUrl: config.databaseUrl, clock });
}

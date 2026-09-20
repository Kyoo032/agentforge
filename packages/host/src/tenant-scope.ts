/**
 * The verified session of the request currently being handled, in async-local storage.
 *
 * Phase 3 lane C. `dispatch` (`./router.ts`) runs every handler inside `withRequestSession`, so a
 * handler that still calls `getTenant(request.workspaceId)` — all 102 of them until lane E sweeps
 * the call sites — resolves the tenant from the **session** rather than from the client-supplied
 * workspace cookie. Without this, lane C would close the seam and leave every hosted handler
 * resolving `local-tenant` until lane E landed.
 *
 * The same idiom as `./run-context.ts`, `./edit/context.ts` and `./sql-tool.ts`. It is a backstop,
 * not the contract: `getTenant(request)` is the explicit seam and is what lane E sweeps to. Nothing
 * here is a substitute for passing the request — a job that outlives its request has no store and
 * therefore no tenant, which in server mode is a refusal (see `getTenant`).
 *
 * Off server mode the store is never set, so the desktop and webdev behave exactly as before.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { HostSession } from "./types";

const storage = new AsyncLocalStorage<HostSession>();

export function withRequestSession<T>(session: HostSession, fn: () => Promise<T>): Promise<T> {
  return storage.run(session, fn);
}

export function currentRequestSession(): HostSession | undefined {
  return storage.getStore();
}

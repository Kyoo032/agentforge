/**
 * The verified session of the request currently being handled, in async-local storage.
 *
 * Phase 3 lane C. `dispatch` (`./router.ts`) runs every handler inside `withRequestSession`, so a
 * handler that calls `getTenant(request.workspaceId)` resolves the tenant from the **session**
 * rather than from the client-supplied workspace cookie. Without this, lane C would have closed the
 * seam and left every hosted handler resolving `local-tenant` until lane E landed.
 *
 * **Lane E has now landed.** All 104 host call sites pass the request itself (`getTenant(request)`),
 * so the session reaches `getTenant` on the request and this store is no longer load-bearing for
 * any handler in the tree. It is kept as the backstop it was always described as, for two reasons:
 * a handler added tomorrow that passes a bare desk id still resolves the session's tenant rather
 * than another tenant's desk, and `getTenant()` with no argument at all (the shape `./edit/harness.ts`
 * uses) still has somewhere to read a session from. `getTenant(request)` remains the contract, and
 * `./tenancy-harness.test.ts` is what proves it holds on every by-id route.
 *
 * The same idiom as `./run-context.ts`, `./edit/context.ts` and `./sql-tool.ts`. Nothing here is a
 * substitute for passing the request — a job that outlives its request has no store and therefore
 * no tenant, which in server mode is a refusal (see `getTenant`).
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

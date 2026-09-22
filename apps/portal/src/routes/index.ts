/**
 * The route table, registered onto the server `src/server.ts` builds.
 *
 * `createPortalServer(...).register(route)` is the seam (`apps/portal/AGENTS.md`), so the portal's
 * whole surface is a list of route objects rather than a rewrite of that file. One call in
 * `src/main.ts` turns a health-check-only process into the login service.
 */
import type { PortalRuntime } from "../flows/context";
import type { PortalRoute, PortalServer } from "../server";
import { activateRoutes } from "./activate";
import { assetRoutes } from "./assets";
import { authorizeRoutes } from "./authorize";
import { logoutRoutes } from "./logout";
import { tokenRoutes } from "./tokens";

export function portalRoutes(runtime: PortalRuntime): readonly PortalRoute[] {
  return Object.freeze([
    ...authorizeRoutes(runtime),
    ...activateRoutes(runtime),
    ...logoutRoutes(runtime),
    ...tokenRoutes(runtime),
    // The brand mark the page shell references. Static, unauthenticated, and the only non-text
    // response the portal sends.
    ...assetRoutes(),
  ]);
}

export function registerPortalRoutes(server: PortalServer, runtime: PortalRuntime): void {
  for (const route of portalRoutes(runtime)) {
    server.register(route);
  }
}

export { requestContext, type RequestContext } from "./support";

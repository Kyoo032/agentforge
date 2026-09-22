/**
 * The brand mark, and nothing else.
 *
 * The page shell (`views/layout.ts`) shows the product's mark beside its name. The owner's
 * 2026-09-21 ruling is that the LOGO is the chevron lockup and the NAME everywhere is DPSBuddy, so
 * this file is the mark and `locales/<locale>/portal.json` is the name. `assets/logo.png` is a
 * byte-for-byte copy of what the product ships at `apps/web/public/brand/logo.png` -- a copy and
 * not a reach across the workspace, because
 * `apps/portal/AGENTS.md` is explicit that the portal is the backend team's service and imports
 * nothing from this repo. Replacing the mark means replacing both files.
 *
 * **One exact path, one file, read once at module load.** There is no directory to list, no path
 * segment taken from the request and no `join` of anything a caller sent, so the traversal class of
 * bug has nothing to traverse. The route table in `src/server.ts` matches `route.path === path`
 * exactly, which is what makes that true rather than merely likely.
 *
 * `Cache-Control: public, max-age=31536000, immutable` -- the opposite of every other response
 * here, and deliberately so. The server's blanket `no-store` exists because portal pages carry
 * one-time codes; a logo carries nothing, and re-fetching 167 KB on every screen of a sign-in over
 * a phone connection is a cost paid for no reason. A changed mark ships as a changed file, and the
 * portal is redeployed, which is when a year-long cache is a problem worth solving with a
 * fingerprint. Today it is one file on a service the operator restarts by hand.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PortalRoute } from "../server";
import { LOGO_PATH } from "../views/layout";

export { LOGO_PATH };

/** `apps/portal` -- this file is at `apps/portal/src/routes/assets.ts`. */
const ASSETS_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "assets");

/**
 * Read once, at module load, and held. It is 167 KB and it never changes while the process runs, so
 * a read per request would be filesystem work to produce the same bytes. A missing file is a broken
 * build and throws here, at boot, rather than 500ing the first sign-in page somebody opens.
 */
const LOGO_BYTES: Buffer = readFileSync(join(ASSETS_DIR, "logo.png"));

const ONE_YEAR_SECONDS = 31_536_000;

export function logoBytes(): Buffer {
  return LOGO_BYTES;
}

export function assetRoutes(): readonly PortalRoute[] {
  return Object.freeze([
    {
      method: "GET" as const,
      path: LOGO_PATH,
      handle() {
        return {
          status: 200,
          headers: {
            "content-type": "image/png",
            // Overrides the server's `no-store`; see the header of this file.
            "cache-control": `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
            "x-content-type-options": "nosniff",
          },
          bytes: LOGO_BYTES,
        };
      },
    },
  ]);
}

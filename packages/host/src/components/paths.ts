/**
 * Where a downloaded component lives, and the completion marker that says it is whole.
 *
 * Layout: `<localDataDir()>/components/<id>/<version>/node_modules/@scope/<pkg>/…`, with
 * `.component-complete.json` at the version root. Version in the path means an upgrade downloads
 * beside the old copy and never edits one that is in use; the marker is written last, atomically,
 * so a half-unpacked directory is never mistaken for an installed component.
 *
 * `localDataDir()` is also Electron's userData in the packaged app — see `packages/db/src/reset.ts`.
 * `components` is listed in `HOST_RESET_ENTRIES` so "Start over" drops it with everything else the
 * host wrote; it is re-downloadable, so losing it costs a download and no data.
 *
 * PHASE 7 — `AGENTFORGE_COMPONENTS_DIR` moves that root somewhere else. A hosted server points it
 * at an operator-owned directory outside the tenant data volume, which is what lets `/data` be
 * mounted `noexec` (security spec H3): no native module is ever loaded out of the volume tenants
 * write to. Unset — every desk, every webdev — the path is exactly what it always was, and the
 * "Start over" entry keeps matching it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type EnvLike, isServerMode } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";
import { isInside, realPathOrNull } from "../tenant-paths";
import { platformKey } from "./manifest";
import type { ComponentId } from "./types";

export const COMPONENTS_DIR = "components";
/** The environment variable an operator sets to move the components root off the data volume. */
export const COMPONENTS_DIR_ENV = "AGENTFORGE_COMPONENTS_DIR";
export const COMPONENT_MARKER_FILE = ".component-complete.json";
export const COMPONENT_MARKER_SCHEMA = 1;

/** The file `createRequire` is anchored at; it never has to exist, only to sit in the right folder. */
const REQUIRE_ANCHOR = "_.js";

export type ComponentMarker = {
  readonly schemaVersion: typeof COMPONENT_MARKER_SCHEMA;
  readonly id: ComponentId;
  readonly version: string;
  readonly platform: string;
  readonly completedAt: string;
};

/**
 * The directory every component is unpacked under.
 *
 * `AGENTFORGE_COMPONENTS_DIR` wins when it is set; otherwise `<localDataDir()>/components`, which is
 * what `HOST_RESET_ENTRIES` names. Read per call, not frozen at import, for the same reason
 * `isServerMode()` is: the suites and `apps/web` both set environment after the module graph loads.
 */
export function componentsRootDir(env: EnvLike = process.env): string {
  const configured = env.AGENTFORGE_COMPONENTS_DIR?.trim();
  return configured ? resolve(configured) : resolve(localDataDir(env), COMPONENTS_DIR);
}

/**
 * The operator-owned components root, or `null` when there is none.
 *
 * `null` means either that `AGENTFORGE_COMPONENTS_DIR` is unset (so the root is inside the data
 * dir) or that it was set to a path inside the data dir anyway, which buys nothing: the point of
 * the variable is to put executable content somewhere the tenant volume is not.
 */
export function managedComponentsRoot(env: EnvLike = process.env): string | null {
  if (!env[COMPONENTS_DIR_ENV]?.trim()) {
    return null;
  }
  const root = componentsRootDir(env);
  const dataDir = localDataDir(env);
  /*
   * Compared twice, and `null` if EITHER comparison says inside.
   *
   * `isInside` is `path.resolve` only, so it answers about the spelling of a path rather than the
   * place on disk it names: `AGENTFORGE_COMPONENTS_DIR=/opt/agentforge/components` pointing at a
   * symlink whose target is `/data/components` reads as outside the data dir and is not. The claim
   * this function makes — that no native module is loaded out of the tenant volume — has to be
   * true of the inode, so both sides are canonicalised with the same helper every per-tenant guard
   * uses (`tenant-paths.ts`). Keeping the lexical test as well is the fail-closed half: a path that
   * is plainly inside stays refused even where nothing on disk exists yet to resolve.
   */
  const realRoot = realPathOrNull(root) ?? root;
  const realDataDir = realPathOrNull(dataDir) ?? dataDir;
  if (isInside(dataDir, root) || isInside(realDataDir, realRoot)) {
    return null;
  }
  return root;
}

/**
 * May a component be loaded out of the components root at all?
 *
 * Off server mode: yes, always — that root is the desk's own data directory and the first-run
 * installer is the whole feature. In server mode: only from a managed root. A hosted box whose
 * operator has not set `AGENTFORGE_COMPONENTS_DIR` loads the copy baked into the image and nothing
 * else, which is the posture the image ships in and the one security spec H3 wants kept: `/data`
 * can be mounted `noexec` exactly when no native module is ever loaded out of it.
 *
 * This is a LOAD rule, not only an install rule. Refusing the install route (`handlers/components.ts`)
 * stops a tenant asking for a download; this stops a directory that is already there — left by an
 * older build, or written by anything else with the volume mounted — from being `createRequire`d.
 */
export function downloadedComponentsAllowed(env: EnvLike = process.env): boolean {
  return isServerMode(env) ? managedComponentsRoot(env) !== null : true;
}

/** `<components root>/<id>` — the parent every version of one component shares. */
export function componentVersionsDir(id: ComponentId): string {
  return resolve(componentsRootDir(), id);
}

export function componentRoot(id: ComponentId, version: string): string {
  return resolve(componentVersionsDir(id), version);
}

export function componentModulesDir(root: string): string {
  return resolve(root, "node_modules");
}

/** Where one npm package's files are unpacked, e.g. `.../node_modules/@firecrawl/anydoc`. */
export function componentPackageDir(root: string, packageName: string): string {
  return resolve(componentModulesDir(root), ...packageName.split("/"));
}

/** Pass this to `createRequire` to resolve `moduleId` out of the component's private node_modules. */
export function componentRequireAnchor(root: string): string {
  return resolve(componentModulesDir(root), REQUIRE_ANCHOR);
}

export function componentMarkerPath(root: string): string {
  return resolve(root, COMPONENT_MARKER_FILE);
}

function isMarker(value: unknown, id: ComponentId, version: string): value is ComponentMarker {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ComponentMarker>;
  return record.schemaVersion === COMPONENT_MARKER_SCHEMA && record.id === id && record.version === version;
}

/**
 * The marker, or null when it is missing, unreadable, malformed, or for another id/version.
 * Never throws: a component that cannot be confirmed is simply not installed.
 */
export function readComponentMarker(id: ComponentId, version: string, root = componentRoot(id, version)) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(componentMarkerPath(root), "utf8"));
    return isMarker(parsed, id, version) ? parsed : null;
  } catch {
    return null;
  }
}

export function hasComponentMarker(id: ComponentId, version: string, root = componentRoot(id, version)): boolean {
  return readComponentMarker(id, version, root) !== null;
}

/** Written last and atomically: a crash mid-write must not leave a marker that claims completion. */
export function writeComponentMarker(
  id: ComponentId,
  version: string,
  root = componentRoot(id, version),
  platform = platformKey(),
): void {
  const marker: ComponentMarker = {
    schemaVersion: COMPONENT_MARKER_SCHEMA,
    id,
    version,
    platform,
    completedAt: new Date().toISOString(),
  };
  const path = componentMarkerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

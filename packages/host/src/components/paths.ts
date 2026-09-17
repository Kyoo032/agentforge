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
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";
import { platformKey } from "./manifest";
import type { ComponentId } from "./types";

export const COMPONENTS_DIR = "components";
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

/** `<data>/components/<id>` — the parent every version of one component shares. */
export function componentVersionsDir(id: ComponentId): string {
  return resolve(localDataDir(), COMPONENTS_DIR, id);
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

import { createRequire } from "node:module";

/**
 * Approximate-nearest-neighbour scaffolding for the builtin backend.
 *
 * TODO(spike-5): the plan's Spike 5 asks whether `better-sqlite3`'s `loadExtension` can load
 * sqlite-vec's `vec0` from a packaged Electron app on Windows and mac. Until that spike runs,
 * sqlite-vec is not a dependency, nothing calls `loadExtension`, and `SqliteBuiltinBackend`
 * ignores this module entirely — the JSON cosine scan stays the vector path. This file exists so
 * the flag (`knowledge.ann`) has one place to ask "could we?" without a bare `require` throwing
 * MODULE_NOT_FOUND inside a retrieval.
 */

/** The npm package the spike would install. Never added by this phase. */
export const ANN_EXTENSION = "sqlite-vec";

/**
 * Whether the sqlite-vec module is resolvable from this host. False in every build today.
 * Resolution only — the extension is never loaded here, and a missing module is not an error.
 */
export function annAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve(ANN_EXTENSION);
    return true;
  } catch {
    return false;
  }
}

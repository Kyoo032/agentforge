import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";
import {
  assertAllowedEndpointUrl,
  extractContextLength,
  parseModelsDevRegistry,
  type ModelsDevRegistry,
} from "@agentforge/core";

const MODELS_DEV_URL = "https://models.dev/api.json";

/**
 * What this process keeps of the models.dev registry.
 *
 * The only reader is `lookupModelsDevContext` (`packages/core/src/models/context-length.ts`, reached
 * through `withContextLengths` in `selectable-models.ts`). It walks providers in key order, looks a
 * model id up by exact, case-insensitive and `:cloud` / `-cloud` spellings, and reads one number from
 * the entry. So the projection keeps, per provider that has any, exactly that number:
 *
 *   { [provider]: { models: { [modelId]: { context_length: <tokens> } } } }
 *
 * `context_length` is the first key `extractContextLength` reads, and `<tokens>` is what it already
 * resolved from the full entry (`limit.context`, `context_window`, `top_provider.context_length` and
 * the rest), so a lookup against the projection answers identically to one against the full entry.
 * Models with no usable context window are dropped, since they could only ever answer "unknown".
 *
 * Projecting is idempotent: a projected registry projects to itself. Add a field for a new consumer
 * here and old cache files keep working, they just lack the field until the next weekly refresh.
 */
export function projectContextRegistry(registry: ModelsDevRegistry): ModelsDevRegistry | undefined {
  const projected: ModelsDevRegistry = {};
  for (const [provider, entry] of Object.entries(registry)) {
    const models: Record<string, { context_length: number }> = {};
    for (const [id, model] of Object.entries(entry.models ?? {})) {
      const tokens = extractContextLength(model);
      if (tokens !== undefined) {
        models[id] = { context_length: tokens };
      }
    }
    if (Object.keys(models).length > 0) {
      projected[provider] = { models };
    }
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

/**
 * Written into the cache file beside the registry it holds, so a load can tell a projected file
 * (trust it, no rework) from one written before the projection existed (project it once). Projecting
 * a projection is a no-op that still costs ~20 ms cold, which is what the marker saves.
 */
const PROJECTION_SHAPE = "context-v1";

let memory: ModelsDevRegistry | undefined;

/** Test hook: forget what this process loaded, so the next read goes back to disk. */
export function resetModelsDevMemoryForTests(): void {
  memory = undefined;
}

/** Re-download at most once a week unless forced; the file is 8 MB and every settings save used to rewrite it. */
const REGISTRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cachePath(): string {
  if (process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH) {
    return process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH;
  }
  // One source of truth for where this desk keeps its files: `localDataDir()` also honours
  // AGENTFORGE_SETTINGS_PATH, which reading AGENTFORGE_DATA_DIR by hand did not — so a desk with a
  // custom settings path wrote its caches somewhere the "Start over" wipe list never looked.
  return resolve(localDataDir(), "models-dev-cache.json");
}

/**
 * The freshness sidecar, next to the registry: `models-dev-cache.json` -> `models-dev-cache.meta.json`.
 * It holds one timestamp, so "is the cache still fresh?" no longer means parsing the registry (the
 * full file was 8.7 MB, 95 ms and ~27 MB of transient heap per check, twice per refresh call).
 */
function metaPath(): string {
  const file = cachePath();
  return file.endsWith(".json") ? `${file.slice(0, -".json".length)}.meta.json` : `${file}.meta.json`;
}

function parseTimestamp(value: unknown): number | null {
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? at : null;
}

/**
 * When the on-disk registry was fetched, in ms. The sidecar answers; a missing or unreadable one falls
 * back to the registry file's mtime, which is how a desk that predates the sidecar keeps working: only
 * a refresh ever writes the registry, so its mtime is its fetch time.
 */
function cachedFetchedAt(): number | null {
  try {
    const meta = JSON.parse(readFileSync(metaPath(), "utf8")) as { fetchedAt?: unknown };
    const at = parseTimestamp(meta.fetchedAt);
    if (at !== null) {
      return at;
    }
  } catch {
    // no sidecar, or a corrupt one: use the registry file's own mtime below
  }
  try {
    return statSync(cachePath()).mtimeMs;
  } catch {
    return null;
  }
}

/** How far ahead of this clock a stamp may sit before it is not believed: drift, not a wrong clock. */
const CLOCK_DRIFT_MS = 60_000;

/**
 * True when the on-disk registry is recent enough to skip the network. Reads a few bytes, never the
 * registry. A stamp from the future is not fresh: it was written while the clock was ahead, and
 * `now - at` being negative would otherwise pass any age limit until the wall clock caught up.
 */
export function modelsDevRegistryFresh(now = Date.now()): boolean {
  const at = cachedFetchedAt();
  if (at === null) {
    return false;
  }
  const age = now - at;
  return age >= -CLOCK_DRIFT_MS && age < REGISTRY_MAX_AGE_MS;
}

/** Cheap change key for memoizing derived catalogs: the registry file's mtime + size, or "missing". */
export function modelsDevCacheStamp(): string {
  try {
    const stat = statSync(cachePath());
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

/**
 * The registry as this process keeps it (see `projectContextRegistry`). A cache file written before
 * the projection existed is the full 8.7 MB registry; it is parsed once here, projected, and the
 * parsed tree is garbage the moment this returns: the full registry is never held. A file this module
 * wrote is marked `PROJECTION_SHAPE` and is used as it stands.
 */
export function loadModelsDevRegistry(): ModelsDevRegistry | undefined {
  if (memory) {
    return memory;
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as { registry?: unknown; shape?: unknown };
    const registry = parseModelsDevRegistry(parsed.registry ?? parsed);
    if (!registry) {
      return undefined;
    }
    memory = parsed.shape === PROJECTION_SHAPE ? registry : projectContextRegistry(registry);
    return memory;
  } catch {
    return undefined;
  }
}

/** Temp file then rename, so a crash or a concurrent reader never sees half a document. */
function writeFileAtomic(file: string, content: string): void {
  const temp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, content, "utf8");
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Best effort: a cache that cannot be written costs the next boot a download, never the answer in hand. */
function persistRegistry(registry: ModelsDevRegistry, fetchedAt: string): void {
  try {
    const file = cachePath();
    mkdirSync(dirname(file), { recursive: true });
    // Registry first, sidecar second: a crash between them leaves an older sidecar, which only ever
    // makes the cache look staler than it is.
    writeFileAtomic(file, JSON.stringify({ fetchedAt, shape: PROJECTION_SHAPE, registry }));
    writeFileAtomic(metaPath(), JSON.stringify({ fetchedAt }));
  } catch (error) {
    console.warn(`could not save the models.dev registry: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function refreshModelsDevRegistry(
  fetchFn: typeof fetch = fetch,
  options: { force?: boolean } = {},
): Promise<ModelsDevRegistry | undefined> {
  const stale = loadModelsDevRegistry();
  if (!options.force && stale && modelsDevRegistryFresh()) {
    return stale;
  }
  try {
    assertAllowedEndpointUrl(MODELS_DEV_URL);
    const response = await fetchFn(MODELS_DEV_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return stale;
    }
    const full = parseModelsDevRegistry(await response.json());
    const registry = full ? projectContextRegistry(full) : undefined;
    if (!registry) {
      return stale;
    }
    memory = registry;
    persistRegistry(registry, new Date().toISOString());
    return registry;
  } catch {
    return stale;
  }
}

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { localDataDir } from "@agentforge/db/vault-key";
import { assertAllowedEndpointUrl, parseModelsDevRegistry, type ModelsDevRegistry } from "@agentforge/core";

const MODELS_DEV_URL = "https://models.dev/api.json";

let memory: ModelsDevRegistry | undefined;

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

function cachedFetchedAt(): number | null {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as { fetchedAt?: unknown };
    const at = typeof parsed.fetchedAt === "string" ? Date.parse(parsed.fetchedAt) : NaN;
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

/** True when the on-disk registry is recent enough to skip the network. */
export function modelsDevRegistryFresh(now = Date.now()): boolean {
  const at = cachedFetchedAt();
  return at !== null && now - at < REGISTRY_MAX_AGE_MS;
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

export function loadModelsDevRegistry(): ModelsDevRegistry | undefined {
  if (memory) {
    return memory;
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as { registry?: unknown };
    memory = parseModelsDevRegistry(parsed.registry ?? parsed);
    return memory;
  } catch {
    return undefined;
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
    const registry = parseModelsDevRegistry(await response.json());
    if (!registry) {
      return stale;
    }
    memory = registry;
    const file = cachePath();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ fetchedAt: new Date().toISOString(), registry }, null, 2)}\n`, "utf8");
    return registry;
  } catch {
    return stale;
  }
}

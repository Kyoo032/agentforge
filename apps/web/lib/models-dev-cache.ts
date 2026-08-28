import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assertAllowedEndpointUrl, parseModelsDevRegistry, type ModelsDevRegistry } from "@agentforge/core";

const MODELS_DEV_URL = "https://models.dev/api.json";

let memory: ModelsDevRegistry | undefined;

function cachePath(): string {
  if (process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH) {
    return process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH;
  }
  return resolve(process.cwd(), "../../data/models-dev-cache.json");
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

export async function refreshModelsDevRegistry(fetchFn: typeof fetch = fetch): Promise<ModelsDevRegistry | undefined> {
  const stale = loadModelsDevRegistry();
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

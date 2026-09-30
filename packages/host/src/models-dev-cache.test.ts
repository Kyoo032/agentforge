/**
 * The models.dev registry cache.
 *
 * It used to parse the whole 8.7 MB file to read one timestamp (95 ms, ~27 MB of transient heap, twice
 * per refresh call), keep the full parsed registry resident (8.8 MB), and rewrite it pretty-printed.
 * These cases hold the replacement to the same answers: freshness from a sidecar, the fields the
 * catalog reads and nothing else, and a fall back that never loses a working cache.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lookupModelsDevContext, parseModelsDevRegistry } from "@agentforge/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadModelsDevRegistry,
  modelsDevCacheStamp,
  modelsDevRegistryFresh,
  projectContextRegistry,
  refreshModelsDevRegistry,
  resetModelsDevMemoryForTests,
} from "./models-dev-cache";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-29T05:00:00.000Z");

/** A models.dev-shaped body: every field a real entry carries, and the ways a context window is spelled. */
const FULL_BODY = {
  openai: {
    id: "openai",
    name: "OpenAI",
    env: ["OPENAI_API_KEY"],
    models: {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        cost: { input: 1.25, output: 10 },
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 1_050_000, output: 128_000 },
      },
      "GPT-Mixed-Case": { id: "GPT-Mixed-Case", limit: { context: 65_536 } },
      "no-window": { id: "no-window", name: "Announces no window", cost: { input: 1 } },
    },
  },
  deepinfra: {
    id: "deepinfra",
    models: {
      "tencent/Hy3": {
        id: "tencent/Hy3",
        description: "long text ".repeat(50),
        limit: { context: 262_144, input: 192_000 },
      },
      "qwen3:cloud": { id: "qwen3:cloud", context_window: 131_072 },
    },
  },
  gateway: {
    models: {
      "vendor-model": { top_provider: { context_length: 200_000 } },
      "tiny-window": { context_length: 512 },
    },
  },
  "no-models-here": { id: "no-models-here", name: "A provider with no models object" },
  "not-an-object": "ignored",
} as const;

/** What the catalog keeps of FULL_BODY: one number per model that has one, in the same key order. */
const PROJECTED = {
  openai: {
    models: {
      "gpt-5.4": { context_length: 1_050_000 },
      "GPT-Mixed-Case": { context_length: 65_536 },
    },
  },
  deepinfra: {
    models: {
      "tencent/Hy3": { context_length: 262_144 },
      "qwen3:cloud": { context_length: 131_072 },
    },
  },
  gateway: { models: { "vendor-model": { context_length: 200_000 } } },
};

let dir: string;
let cacheFile: string;
let metaFile: string;

function ago(ms: number): Date {
  return new Date(NOW - ms);
}

function writeLegacy(body: unknown = FULL_BODY, fetchedAt = "2000-01-01T00:00:00.000Z"): void {
  writeFileSync(cacheFile, `${JSON.stringify({ fetchedAt, registry: body }, null, 2)}\n`, "utf8");
}

function okFetch(body: unknown = FULL_BODY) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

const previous = process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "models-dev-cache-"));
  cacheFile = join(dir, "models-dev-cache.json");
  metaFile = join(dir, "models-dev-cache.meta.json");
  process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH = cacheFile;
  resetModelsDevMemoryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetModelsDevMemoryForTests();
  if (previous === undefined) {
    delete process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH;
  } else {
    process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH = previous;
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("freshness", () => {
  it("is read from the sidecar and never from the registry", () => {
    // The registry file is not JSON at all: any code that parsed it to find a timestamp would throw
    // and answer "not fresh", so a `true` here can only have come from the sidecar.
    writeFileSync(cacheFile, "{ this is not json", "utf8");
    writeFileSync(metaFile, JSON.stringify({ fetchedAt: ago(DAY_MS).toISOString() }), "utf8");

    expect(modelsDevRegistryFresh(NOW)).toBe(true);
  });

  it("goes stale after seven days by the sidecar's clock", () => {
    writeFileSync(cacheFile, "{}", "utf8");
    writeFileSync(metaFile, JSON.stringify({ fetchedAt: ago(7 * DAY_MS - 1000).toISOString() }), "utf8");
    expect(modelsDevRegistryFresh(NOW)).toBe(true);

    writeFileSync(metaFile, JSON.stringify({ fetchedAt: ago(7 * DAY_MS).toISOString() }), "utf8");
    expect(modelsDevRegistryFresh(NOW)).toBe(false);
  });

  it("prefers the sidecar to the file's mtime when they disagree", () => {
    writeFileSync(cacheFile, "{}", "utf8");
    utimesSync(cacheFile, ago(30 * DAY_MS), ago(30 * DAY_MS)); // an old file...
    writeFileSync(metaFile, JSON.stringify({ fetchedAt: ago(DAY_MS).toISOString() }), "utf8"); // ...a recent fetch
    expect(modelsDevRegistryFresh(NOW)).toBe(true);
  });

  it("falls back to the registry's mtime when a desk has no sidecar yet", () => {
    writeLegacy(FULL_BODY, "2000-01-01T00:00:00.000Z"); // the timestamp inside the file is ancient and must be ignored
    utimesSync(cacheFile, ago(2 * DAY_MS), ago(2 * DAY_MS));
    expect(existsSync(metaFile)).toBe(false);
    expect(modelsDevRegistryFresh(NOW)).toBe(true);

    utimesSync(cacheFile, ago(8 * DAY_MS), ago(8 * DAY_MS));
    expect(modelsDevRegistryFresh(NOW)).toBe(false);
  });

  it("falls back to the mtime when the sidecar is corrupt or carries no usable date", () => {
    writeFileSync(cacheFile, "{}", "utf8");
    utimesSync(cacheFile, ago(3 * DAY_MS), ago(3 * DAY_MS));

    for (const bad of [
      "not json {",
      "{}",
      JSON.stringify({ fetchedAt: 12 }),
      JSON.stringify({ fetchedAt: "yesterday-ish" }),
    ]) {
      writeFileSync(metaFile, bad, "utf8");
      expect(modelsDevRegistryFresh(NOW), bad).toBe(true);
    }
  });

  it("does not trust a stamp from the future, but forgives a little clock drift", () => {
    // A refresh written while the system clock was set ahead, then the clock put right: `now - at`
    // is negative, which is under any age limit, so the registry read as fresh until the wall clock
    // caught up with the stamp plus seven days (a stamp 30 days ahead held off refreshes for 37).
    writeFileSync(cacheFile, "{}", "utf8");
    writeFileSync(metaFile, JSON.stringify({ fetchedAt: new Date(NOW + 30 * DAY_MS).toISOString() }), "utf8");
    expect(modelsDevRegistryFresh(NOW)).toBe(false);

    writeFileSync(metaFile, JSON.stringify({ fetchedAt: new Date(NOW + 5_000).toISOString() }), "utf8");
    expect(modelsDevRegistryFresh(NOW)).toBe(true);

    // The mtime fallback answers the same way.
    rmSync(metaFile);
    utimesSync(cacheFile, new Date(NOW + 30 * DAY_MS), new Date(NOW + 30 * DAY_MS));
    expect(modelsDevRegistryFresh(NOW)).toBe(false);
  });

  it("is false when there is nothing on disk at all", () => {
    expect(modelsDevRegistryFresh(NOW)).toBe(false);
  });
});

describe("what the process keeps", () => {
  it("projects a full registry down to one context window per model, dropping the rest", () => {
    writeLegacy();

    expect(loadModelsDevRegistry()).toEqual(PROJECTED);
  });

  it("keeps provider and model order, because lookups take the first provider that answers", () => {
    writeLegacy();

    const registry = loadModelsDevRegistry();
    expect(Object.keys(registry ?? {})).toEqual(["openai", "deepinfra", "gateway"]);
    expect(Object.keys(registry?.deepinfra?.models ?? {})).toEqual(["tencent/Hy3", "qwen3:cloud"]);
  });

  it("answers every context lookup exactly as the full registry does", () => {
    const full = parseModelsDevRegistry(FULL_BODY);
    const projected = projectContextRegistry(full ?? {});
    const queries: Array<[string, string | undefined, number | undefined]> = [
      ["gpt-5.4", undefined, 1_050_000], // exact, no hint
      ["openai/gpt-5.4", undefined, 1_050_000], // provider-prefixed
      ["gpt-mixed-case", "openai", 65_536], // case-insensitive, hinted
      ["GPT-MIXED-CASE", undefined, 65_536], // case-insensitive, found by scanning every provider
      ["qwen3", "deepinfra", 131_072], // `:cloud` suffix
      ["mirror/qwen3", undefined, 131_072], // unknown provider prefix: the leaf is scanned across providers, `:cloud` included
      ["Hy3", undefined, undefined], // the registry keys it as "tencent/Hy3"; a bare leaf does not match
      ["tencent/Hy3", undefined, 262_144],
      ["vendor-model", "gateway", 200_000], // top_provider spelling
      ["tiny-window", undefined, undefined], // below the 1024 floor: no answer either way
      ["no-window", "openai", undefined], // announces no window: no answer either way
      ["never-heard-of-it", undefined, undefined],
      ["models/gpt-5.4", undefined, 1_050_000], // Gemini-style prefix
    ];

    for (const [id, hint, expected] of queries) {
      expect(lookupModelsDevContext(full, id, hint), `full: ${id}`).toBe(expected);
      expect(lookupModelsDevContext(projected, id, hint), `projected: ${id}`).toBe(expected);
    }
  });

  it("uses a file marked as already projected as it stands, and projects one that is not", () => {
    const entry = { context_length: 5000, extra: "only a legacy file would carry this" };
    const registry = { p: { models: { m: entry } } };

    writeFileSync(
      cacheFile,
      JSON.stringify({ fetchedAt: "2026-09-29T00:00:00.000Z", shape: "context-v1", registry }),
      "utf8",
    );
    expect(loadModelsDevRegistry()).toEqual({ p: { models: { m: { context_length: 5000, extra: entry.extra } } } });

    resetModelsDevMemoryForTests();
    writeFileSync(cacheFile, JSON.stringify({ fetchedAt: "2026-09-29T00:00:00.000Z", registry }), "utf8");
    expect(loadModelsDevRegistry()).toEqual({ p: { models: { m: { context_length: 5000 } } } });

    resetModelsDevMemoryForTests();
    writeFileSync(
      cacheFile,
      JSON.stringify({ fetchedAt: "2026-09-29T00:00:00.000Z", shape: "context-v0", registry }),
      "utf8",
    );
    expect(loadModelsDevRegistry()).toEqual({ p: { models: { m: { context_length: 5000 } } } });
  });

  it("projects a projection to itself", () => {
    const once = projectContextRegistry(parseModelsDevRegistry(FULL_BODY) ?? {});
    expect(projectContextRegistry(once ?? {})).toEqual(once);
    expect(once).toEqual(PROJECTED);
  });

  it("has no registry to keep when no model announces a window", () => {
    expect(projectContextRegistry({ p: { models: { a: { name: "x" }, b: { limit: {} } } } })).toBeUndefined();
    expect(projectContextRegistry({})).toBeUndefined();
  });

  it("is what loads back from a file a refresh wrote", async () => {
    await refreshModelsDevRegistry(okFetch(), { force: true });
    resetModelsDevMemoryForTests();

    expect(loadModelsDevRegistry()).toEqual(PROJECTED);
  });
});

describe("a missing or corrupt cache", () => {
  it("loads as undefined when there is no file", () => {
    expect(loadModelsDevRegistry()).toBeUndefined();
    expect(modelsDevCacheStamp()).toBe("missing");
  });

  it.each([
    ["not json at all", "{ nope"],
    ["an empty file", ""],
    ["a JSON array", "[1,2,3]"],
    ["an object with no providers", JSON.stringify({ fetchedAt: "2026-09-29T00:00:00.000Z", registry: {} })],
    ["a null registry", JSON.stringify({ fetchedAt: "2026-09-29T00:00:00.000Z", registry: null })],
  ])("loads as undefined for %s, without throwing", (_name, content) => {
    writeFileSync(cacheFile, content, "utf8");
    expect(loadModelsDevRegistry()).toBeUndefined();
  });

  it("is replaced by the next refresh, even when the sidecar still says fresh", async () => {
    writeFileSync(cacheFile, "{ nope", "utf8");
    writeFileSync(metaFile, JSON.stringify({ fetchedAt: new Date().toISOString() }), "utf8");
    const fetchFn = okFetch();

    const registry = await refreshModelsDevRegistry(fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(registry).toEqual(PROJECTED);
    expect(JSON.parse(readFileSync(cacheFile, "utf8")).registry).toEqual(PROJECTED);
  });
});

describe("refreshModelsDevRegistry", () => {
  it("on a first run creates the directory, the registry and the sidecar", async () => {
    const nested = join(dir, "not", "yet", "there");
    process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH = join(nested, "models-dev-cache.json");

    const registry = await refreshModelsDevRegistry(okFetch());

    expect(registry).toEqual(PROJECTED);
    expect(readdirSync(nested).sort()).toEqual(["models-dev-cache.json", "models-dev-cache.meta.json"]);
  });

  it("writes compact JSON, a sidecar with the same timestamp, and no stray temp file", async () => {
    await refreshModelsDevRegistry(okFetch(), { force: true });

    const text = readFileSync(cacheFile, "utf8");
    expect(text).not.toContain("\n"); // compact: one line, no indentation
    const file = JSON.parse(text) as { fetchedAt: string; registry: unknown };
    expect(file.registry).toEqual(PROJECTED);
    expect(Object.keys(file).sort()).toEqual(["fetchedAt", "registry", "shape"]);
    expect((file as { shape?: string }).shape).toBe("context-v1");
    expect(Number.isFinite(Date.parse(file.fetchedAt))).toBe(true);

    expect(JSON.parse(readFileSync(metaFile, "utf8"))).toEqual({ fetchedAt: file.fetchedAt });
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(modelsDevRegistryFresh()).toBe(true);
  });

  it("stores far less than the registry it downloaded", async () => {
    const big = {
      provider: {
        models: Object.fromEntries(
          Array.from({ length: 400 }, (_, i) => [
            `model-${i}`,
            {
              id: `model-${i}`,
              name: `Model ${i}`,
              description: "a long description ".repeat(20),
              limit: { context: 128_000 + i },
            },
          ]),
        ),
      },
    };
    const downloaded = JSON.stringify(big).length;

    await refreshModelsDevRegistry(okFetch(big), { force: true });

    expect(downloaded).toBeGreaterThan(150_000);
    expect(statSync(cacheFile).size).toBeLessThan(20_000);
  });

  it("does not fetch while the cache is fresh, and fetches again when forced", async () => {
    const fetchFn = okFetch();
    await refreshModelsDevRegistry(fetchFn);
    resetModelsDevMemoryForTests(); // a new process reading the same files

    expect(await refreshModelsDevRegistry(fetchFn)).toEqual(PROJECTED);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await refreshModelsDevRegistry(fetchFn, { force: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fetches again once the sidecar is more than a week old", async () => {
    const fetchFn = okFetch();
    await refreshModelsDevRegistry(fetchFn);
    writeFileSync(metaFile, JSON.stringify({ fetchedAt: new Date(Date.now() - 8 * DAY_MS).toISOString() }), "utf8");

    await refreshModelsDevRegistry(fetchFn);

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("serves a desk that predates the sidecar from its file, then converts it on the next download", async () => {
    writeLegacy();
    const fetchFn = okFetch();

    // Fresh by mtime: no download, and the full registry is projected on the way in.
    expect(await refreshModelsDevRegistry(fetchFn)).toEqual(PROJECTED);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(existsSync(metaFile)).toBe(false);

    await refreshModelsDevRegistry(fetchFn, { force: true });
    expect(existsSync(metaFile)).toBe(true);
    expect(readFileSync(cacheFile, "utf8")).not.toContain("Announces no window");
  });

  it("keeps the registry it has when the download fails", async () => {
    await refreshModelsDevRegistry(okFetch(), { force: true });
    const before = readFileSync(cacheFile, "utf8");

    const failures: Array<typeof fetch> = [
      vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
      vi.fn(async () => {
        throw new Error("socket hang up");
      }) as unknown as typeof fetch,
      vi.fn(async () => new Response(JSON.stringify([1, 2, 3]), { status: 200 })) as unknown as typeof fetch,
      vi.fn(
        async () => new Response(JSON.stringify({ p: { models: { m: { name: "no window" } } } }), { status: 200 }),
      ) as unknown as typeof fetch,
    ];
    for (const fetchFn of failures) {
      expect(await refreshModelsDevRegistry(fetchFn, { force: true })).toEqual(PROJECTED);
    }
    expect(readFileSync(cacheFile, "utf8")).toBe(before);
  });

  it("answers undefined, and writes nothing, when the first download fails", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));

    expect(await refreshModelsDevRegistry(fetchFn as unknown as typeof fetch)).toBeUndefined();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("returns the registry and cleans up when only the sidecar cannot be written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A directory where the sidecar file belongs: the registry lands, the sidecar's rename cannot.
    mkdirSync(metaFile);

    const registry = await refreshModelsDevRegistry(okFetch(), { force: true });

    expect(registry).toEqual(PROJECTED);
    expect(JSON.parse(readFileSync(cacheFile, "utf8")).registry).toEqual(PROJECTED);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("still returns the registry it just downloaded when the disk will not take it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A regular file where the directory should be: mkdir and every write under it fail.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x", "utf8");
    process.env.AGENTFORGE_MODELS_DEV_CACHE_PATH = join(blocker, "models-dev-cache.json");
    mkdirSync(join(dir, "unused"), { recursive: true });

    const registry = await refreshModelsDevRegistry(okFetch(), { force: true });

    expect(registry).toEqual(PROJECTED);
    expect(loadModelsDevRegistry()).toEqual(PROJECTED); // held in memory for this process
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("could not save the models.dev registry");
  });
});

describe("modelsDevCacheStamp", () => {
  it("changes when a refresh rewrites the registry, so the catalog memo rebuilds", async () => {
    expect(modelsDevCacheStamp()).toBe("missing");
    await refreshModelsDevRegistry(okFetch(), { force: true });
    const first = modelsDevCacheStamp();
    expect(first).toMatch(/^\d+(\.\d+)?:\d+$/);

    utimesSync(cacheFile, ago(DAY_MS), ago(DAY_MS));
    expect(modelsDevCacheStamp()).not.toBe(first);
  });
});

/**
 * Bundled, then downloaded, then nothing.
 *
 * The order matters twice over: a packaged app must always prefer the copy it shipped with (no
 * download, no data dir dependency), and a desk that only has the first-run download must still get
 * the converter instead of silently falling back to the old extractors forever.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-anydoc-loader-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SETTINGS_PATH;

const { loadDownloadedAnydoc, resetAnydocCache, resolveAnydoc } = await import("./anydoc");
const { componentManifest } = await import("../components/manifest");
const { componentPackageDir, componentRoot, writeComponentMarker } = await import("../components/paths");
type AnydocModule = import("./anydoc").AnydocModule;

const VERSION = componentManifest("anydoc").version;
const MODULE = { formatFromBytes: () => null, formatFromExtension: () => null, toMarkdownBytes: async () => "" };

function fake(): AnydocModule {
  return MODULE as unknown as AnydocModule;
}

function missing(): never {
  throw new Error("Cannot find native binding");
}

beforeEach(() => {
  resetAnydocCache();
  rmSync(componentRoot("anydoc", VERSION), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("resolveAnydoc", () => {
  it("prefers the bundled module and never looks in the data dir", () => {
    const downloaded = vi.fn(fake);
    expect(resolveAnydoc({ bundled: fake, downloaded })).toEqual({ module: MODULE, source: "bundled" });
    expect(downloaded).not.toHaveBeenCalled();
  });

  it("falls through to the downloaded copy when the bundled one is not there", () => {
    expect(resolveAnydoc({ bundled: missing, downloaded: fake })).toEqual({ module: MODULE, source: "downloaded" });
  });

  it("returns null when neither place has it, instead of throwing", () => {
    expect(resolveAnydoc({ bundled: missing, downloaded: missing })).toBeNull();
  });
});

describe("loadDownloadedAnydoc", () => {
  it("refuses a component directory with no completion marker", () => {
    const root = componentRoot("anydoc", VERSION);
    mkdirSync(componentPackageDir(root, "@firecrawl/anydoc"), { recursive: true });
    expect(() => loadDownloadedAnydoc()).toThrowError(/No installed anydoc component/);
  });

  it("requires the module out of the component's own node_modules once the marker is there", () => {
    const root = componentRoot("anydoc", VERSION);
    const pkg = componentPackageDir(root, "@firecrawl/anydoc");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@firecrawl/anydoc", main: "index.js" }));
    writeFileSync(join(pkg, "index.js"), "module.exports = { fromComponentDir: true };\n");
    writeComponentMarker("anydoc", VERSION, root);

    expect(loadDownloadedAnydoc()).toMatchObject({ fromComponentDir: true });
  });
});

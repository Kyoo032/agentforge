/**
 * The installer's probe stage runs before the completion marker exists, so it must judge the
 * unpacked directory on its own. A live run on 2026-09-17 failed `probe_failed` on every real
 * download because the probe asked for the marker that is only written after it passes.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-unpacked-probe-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;

const { componentLoadsFrom } = await import("./status");
const { hasComponentMarker } = await import("./paths");

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function fakeUnpackedRoot(): string {
  const root = mkdtempSync(join(dataDir, "root-"));
  const moduleDir = join(root, "node_modules", "@firecrawl", "anydoc");
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, "package.json"), JSON.stringify({ name: "@firecrawl/anydoc", main: "index.js" }));
  writeFileSync(join(moduleDir, "index.js"), "module.exports = { toMarkdownBytes() { return ''; } };");
  return root;
}

describe("componentLoadsFrom", () => {
  it("accepts an unpacked module that has no completion marker yet", () => {
    const root = fakeUnpackedRoot();
    expect(hasComponentMarker("anydoc", "0.2.4", root)).toBe(false);
    expect(componentLoadsFrom("anydoc", root)).toBe(true);
  });

  it("rejects a directory with nothing loadable in it", () => {
    const root = mkdtempSync(join(dataDir, "empty-"));
    expect(componentLoadsFrom("anydoc", root)).toBe(false);
  });
});

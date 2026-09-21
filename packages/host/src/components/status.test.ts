/**
 * `componentStatus()` is what the renderer branches on, so each of the five states is pinned here —
 * including `auto`, the flag that keeps Cloud, CI and Playwright from ever reaching the registry.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-component-status-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SETTINGS_PATH;

const { componentManifest, manifestBytes, platformKey, requiredPackages } = await import("./manifest");
const { componentAutoInstallAllowed, componentStatus } = await import("./status");

const ENTRY = componentManifest("anydoc");
const SUPPORTED = "win32-x64";
const UNSUPPORTED = "sunos-sparc";
const BYTES = manifestBytes(ENTRY, SUPPORTED);

function status(extra: Parameters<typeof componentStatus>[1] = {}) {
  return componentStatus("anydoc", { platform: SUPPORTED, probe: () => null, ...extra });
}

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("componentAutoInstallAllowed", () => {
  it("is false under the stub runtime, so Cloud never downloads", () => {
    expect(componentAutoInstallAllowed({ AGENTFORGE_RUNTIME: "stub" })).toBe(false);
  });

  it("is false in a test process, so Playwright and vitest never download", () => {
    expect(componentAutoInstallAllowed({ NODE_ENV: "test" })).toBe(false);
  });

  it("is true on an ordinary desk", () => {
    expect(componentAutoInstallAllowed({ NODE_ENV: "production" })).toBe(true);
    expect(componentAutoInstallAllowed({})).toBe(true);
  });

  it("only reacts to an exact stub runtime value", () => {
    expect(componentAutoInstallAllowed({ AGENTFORGE_RUNTIME: "stubby" })).toBe(true);
  });
});

describe("componentStatus", () => {
  it("reports ready/bundled with no bytes when the shipped module loads", () => {
    expect(status({ probe: () => "bundled" })).toEqual({
      id: "anydoc",
      version: ENTRY.version,
      state: "ready",
      source: "bundled",
      auto: false,
      managed: false,
      bytes: 0,
    });
  });

  it("reports ready/downloaded at the manifest size", () => {
    expect(status({ probe: () => "downloaded" })).toMatchObject({ state: "ready", source: "downloaded", bytes: BYTES });
  });

  it("reports missing with the download cost when nothing loads", () => {
    expect(status()).toMatchObject({ state: "missing", source: null, bytes: BYTES });
  });

  it("reports installing while a run is in flight", () => {
    expect(status({ installing: true })).toMatchObject({ state: "installing", source: null });
  });

  it("carries the last failure through as failed + error", () => {
    const failure = { code: "integrity_mismatch", message: "bad hash" } as const;
    expect(status({ failure })).toMatchObject({ state: "failed", error: failure });
  });

  it("reports unsupported, not an error, on a platform with no prebuilt", () => {
    expect(status({ platform: UNSUPPORTED })).toMatchObject({ state: "unsupported", source: null, bytes: 0 });
  });

  it("still reports ready on an unsupported platform when the module is bundled anyway", () => {
    expect(status({ platform: UNSUPPORTED, probe: () => "bundled" })).toMatchObject({ state: "ready" });
  });

  it("reports auto true when the env allows an automatic install", () => {
    expect(status({ env: { NODE_ENV: "production" } }).auto).toBe(true);
  });
});

describe("the manifest itself", () => {
  it("pins a sha512 and a registry.npmjs.org tarball for every package", () => {
    const packages = [ENTRY.main, ...Object.values(ENTRY.platforms)];
    for (const pkg of packages) {
      expect(pkg.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
      expect(pkg.tarball.startsWith("https://registry.npmjs.org/")).toBe(true);
      expect(pkg.tarball).toContain(`-${ENTRY.version}.tgz`);
      expect(pkg.unpackedBytes).toBeGreaterThan(0);
    }
  });

  it("covers the four platforms the app ships on", () => {
    expect(Object.keys(ENTRY.platforms).sort()).toEqual(["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]);
  });

  it("asks for the main package and exactly one prebuilt", () => {
    const packages = requiredPackages(ENTRY, SUPPORTED);
    expect(packages.map((pkg) => pkg.name)).toEqual(["@firecrawl/anydoc", "@firecrawl/anydoc-win32-x64-msvc"]);
  });

  it("throws unsupported_platform rather than guessing a binary", () => {
    expect(() => requiredPackages(ENTRY, UNSUPPORTED)).toThrowError(/no prebuilt binary/);
    expect(manifestBytes(ENTRY, UNSUPPORTED)).toBe(0);
  });

  it("keys platforms the way this process would ask for them", () => {
    expect(platformKey("win32", "x64")).toBe("win32-x64");
    expect(platformKey()).toBe(`${process.platform}-${process.arch}`);
  });
});

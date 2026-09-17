/**
 * The pinned component manifest — the ONLY source of download URLs in this subsystem.
 *
 * No URL, package name, version or hash is ever read from a request body, a setting, an environment
 * variable or a registry response. A caller names a component id; everything else comes from here.
 * Every entry carries the npm `sha512` integrity in SRI form, which is checked before a single byte
 * is written into the component directory.
 *
 * A second component (ffmpeg is the next one planned) is a new entry plus a new `kind` in
 * `install.ts`. Nothing else about this file changes shape.
 */
import { type ComponentId, ComponentError } from "./types";

/** npm registry origin, spelled once. `assertPublicHttpsUrl` re-checks it on every hop anyway. */
const REGISTRY = "https://registry.npmjs.org";

export type ComponentPackage = {
  /** Full npm package name, e.g. `@firecrawl/anydoc-win32-x64-msvc`. */
  readonly name: string;
  readonly tarball: string;
  /** SRI form, `sha512-<base64>`, exactly as the registry publishes it. */
  readonly integrity: string;
  /** Unpacked size on disk. The tar reader caps a package at twice this. */
  readonly unpackedBytes: number;
};

/**
 * `npm-native`: a main JS package plus one prebuilt napi-rs binary package per platform, unpacked
 * into a private `node_modules` and loaded with `createRequire`. ABI-independent, so one download
 * survives every Electron upgrade.
 */
export type ComponentKind = "npm-native";

export type ComponentManifestEntry = {
  readonly id: ComponentId;
  readonly kind: ComponentKind;
  readonly version: string;
  /** What `createRequire(...)` is asked for once the files are on disk. */
  readonly moduleId: string;
  readonly main: ComponentPackage;
  /** Keyed by `<process.platform>-<process.arch>`. A key that is absent is `unsupported`. */
  readonly platforms: Readonly<Record<string, ComponentPackage>>;
};

function npmPackage(scopedName: string, version: string, integrity: string, unpackedBytes: number): ComponentPackage {
  // `@firecrawl/anydoc-linux-x64-gnu` → tarball basename `anydoc-linux-x64-gnu-0.2.4.tgz`.
  const bare = scopedName.slice(scopedName.indexOf("/") + 1);
  return Object.freeze({
    name: scopedName,
    tarball: `${REGISTRY}/${scopedName}/-/${bare}-${version}.tgz`,
    integrity,
    unpackedBytes,
  });
}

const ANYDOC_VERSION = "0.2.4";

const ANYDOC: ComponentManifestEntry = Object.freeze({
  id: "anydoc",
  kind: "npm-native",
  version: ANYDOC_VERSION,
  moduleId: "@firecrawl/anydoc",
  main: npmPackage(
    "@firecrawl/anydoc",
    ANYDOC_VERSION,
    "sha512-rfJxa5L+nhoqR5yodcRZoGDLaSfxMTpBuhVj1gSacfW4ZGjBt4cjfErXwaKjPYrpWRTPIBye2sh36UhqgOP1Og==",
    57_136,
  ),
  platforms: Object.freeze({
    "win32-x64": npmPackage(
      "@firecrawl/anydoc-win32-x64-msvc",
      ANYDOC_VERSION,
      "sha512-E7d14hy5kZNsMNnHiutU6r9yr53LrKXSsMSFtl0QhU/1KWuvRnjhQEuMiuW4YbsMcPlEaK10WtBVF86g9OMW6A==",
      8_276_356,
    ),
    "darwin-arm64": npmPackage(
      "@firecrawl/anydoc-darwin-arm64",
      ANYDOC_VERSION,
      "sha512-1Eg0rPGVMN052E7Y2+zswANS0KLaWhXvYb9CPgO8HEtclzu3hKAIJ00lIu5PF+DXafZ10ZS4fmrcP+9Ifct9qw==",
      7_008_205,
    ),
    "darwin-x64": npmPackage(
      "@firecrawl/anydoc-darwin-x64",
      ANYDOC_VERSION,
      "sha512-fTM8y6COu+jBqWRJ0Je0OqaDDt7YxJ8LU4ISoypO5eOBNXI3+l6tK1ZRwUclYWXGBr/6JaUWEgdyJVFfd/fpJg==",
      7_457_690,
    ),
    "linux-x64": npmPackage(
      "@firecrawl/anydoc-linux-x64-gnu",
      ANYDOC_VERSION,
      "sha512-yfvx+iGo2CvZH0TB9MeyNjkrd5/psNFEuxkl2Jah/VNFesPRASqjjCkDRY7tKw7fPij1u/UyFVxI6bsu6Iow9Q==",
      8_190_015,
    ),
  }),
});

const MANIFEST: Readonly<Record<ComponentId, ComponentManifestEntry>> = Object.freeze({ anydoc: ANYDOC });

export function componentManifest(id: ComponentId): ComponentManifestEntry {
  return MANIFEST[id];
}

/** `<platform>-<arch>`, the manifest's platform key and the value written into the marker. */
export function platformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

/** The prebuilt for this machine, or null when the manifest has none (not an error — `unsupported`). */
export function platformPackage(entry: ComponentManifestEntry, key: string = platformKey()): ComponentPackage | null {
  return entry.platforms[key] ?? null;
}

/** The two packages an install downloads, main first. Throws `unsupported_platform` when there is none. */
export function requiredPackages(entry: ComponentManifestEntry, key: string = platformKey()): ComponentPackage[] {
  const platform = platformPackage(entry, key);
  if (!platform) {
    throw new ComponentError("unsupported_platform", `${entry.id} has no prebuilt binary for ${key}`);
  }
  return [entry.main, platform];
}

/** What the install costs on this platform, or 0 when it cannot run here. */
export function manifestBytes(entry: ComponentManifestEntry, key: string = platformKey()): number {
  const platform = platformPackage(entry, key);
  return platform ? entry.main.unpackedBytes + platform.unpackedBytes : 0;
}

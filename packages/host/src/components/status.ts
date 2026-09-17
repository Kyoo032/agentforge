/**
 * What `GET /api/v1/components` answers, and what the installer resolves to.
 *
 * Reading a status never downloads anything. It probes what is already loadable (bundled first, then
 * a completed download), reads the in-flight and last-failure registers `install.ts` keeps, and maps
 * that to one of five states. A machine the manifest has no prebuilt for is `unsupported`, which is
 * an answer, not an error: `file-extract/fallback.ts` still reads the formats it always read.
 */
import { manifestBytes, componentManifest, platformKey, platformPackage } from "./manifest";
import type { ComponentManifestEntry } from "./manifest";
import { loadAnydocFrom, resolveAnydoc } from "../file-extract/anydoc";
import type { ComponentFailure, ComponentId, ComponentSource, ComponentStatus } from "./types";

/** How a component reports "already here". One entry per manifest id. */
export type ComponentProbe = () => ComponentSource | null;

const PROBES: Readonly<Record<ComponentId, ComponentProbe>> = Object.freeze({
  anydoc: () => resolveAnydoc()?.source ?? null,
});

/**
 * Does the copy just unpacked at `root` load? Used by the installer's probe stage only, where the
 * completion marker does not exist yet — `PROBES` would call an unmarked directory missing.
 */
const UNPACKED_PROBES: Readonly<Record<ComponentId, (root: string) => boolean>> = Object.freeze({
  anydoc: (root: string) => {
    try {
      loadAnydocFrom(root);
      return true;
    } catch {
      return false;
    }
  },
});

export function componentLoadsFrom(id: ComponentId, root: string): boolean {
  return UNPACKED_PROBES[id](root);
}

export function componentProbe(id: ComponentId): ComponentProbe {
  return PROBES[id];
}

/**
 * Whether the app may install this on its own.
 *
 * False under the stub runtime and in any test / Playwright process: Cloud and CI must never reach
 * `registry.npmjs.org`, and a unit test that downloaded 8 MB would not be a unit test. An explicit
 * install request still works — `auto` gates the automatic first run, not the owner's button.
 */
export function componentAutoInstallAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTFORGE_RUNTIME?.trim() !== "stub" && env.NODE_ENV !== "test";
}

export type StatusOptions = {
  readonly probe?: ComponentProbe;
  readonly installing?: boolean;
  readonly failure?: ComponentFailure | null;
  readonly env?: NodeJS.ProcessEnv;
  /** Test seams. No route sets either: production always reads the frozen manifest for this machine. */
  readonly manifest?: ComponentManifestEntry;
  readonly platform?: string;
};

export function componentStatus(id: ComponentId, options: StatusOptions = {}): ComponentStatus {
  const entry = options.manifest ?? componentManifest(id);
  const key = options.platform ?? platformKey();
  const auto = componentAutoInstallAllowed(options.env ?? process.env);
  const base = { id, version: entry.version, auto } as const;

  const source = (options.probe ?? componentProbe(id))();
  if (source) {
    // Bundled costs nothing; a downloaded copy is on disk at the manifest's size.
    return { ...base, state: "ready", source, bytes: source === "bundled" ? 0 : manifestBytes(entry, key) };
  }
  if (!platformPackage(entry, key)) {
    return { ...base, state: "unsupported", source: null, bytes: 0 };
  }
  // `bytes` is what the download costs from here, so the renderer can say so before asking.
  const bytes = manifestBytes(entry, key);
  if (options.installing) {
    return { ...base, state: "installing", source: null, bytes };
  }
  if (options.failure) {
    return { ...base, state: "failed", source: null, bytes, error: options.failure };
  }
  return { ...base, state: "missing", source: null, bytes };
}

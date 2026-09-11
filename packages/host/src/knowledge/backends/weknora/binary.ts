import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Where the WeKnora-lite sidecar lives, in the same three-step shape as `edit/ffmpeg-binary.ts`:
 * an explicit env override, then the packaged copy under `process.resourcesPath`, then the staged
 * dev copy in the repo. Nothing is ever downloaded and nothing is searched for on `PATH` — a
 * sidecar we did not ship is a sidecar we cannot vouch for, and the built-in backend is always
 * there to answer instead.
 *
 * Layout (see `apps/desktop/resources/weknora/README.md`), one folder per `platform-arch`:
 *
 *     resources/weknora/win32-x64/     WeKnora-lite.exe  migrations/sqlite/  LICENSE
 *     resources/weknora/darwin-arm64/  WeKnora-lite      migrations/sqlite/  THIRD_PARTY_NOTICES.md
 *     resources/weknora/darwin-x64/    WeKnora-lite      migrations/sqlite/  licenses/
 *
 * `migrations/sqlite/` sitting next to the binary is load-bearing: WeKnora reads it from disk
 * relative to its working directory, which is why the supervisor spawns with `cwd` = this folder.
 */

export const WEKNORA_BINARY_BASENAME = "WeKnora-lite";

/** Platforms a sidecar is built for. Anything else resolves to `unsupported_platform`. */
export const WEKNORA_PLATFORMS = ["win32-x64", "darwin-arm64", "darwin-x64"] as const;
export type WeKnoraPlatform = (typeof WEKNORA_PLATFORMS)[number];

export type WeKnoraBinary = {
  available: boolean;
  /** Absolute path to the binary, or null when it was not found. */
  path: string | null;
  /**
   * Why it is unavailable — a short machine-readable token the Knowledge page shows verbatim:
   * `unsupported_platform`, `not_staged`, `env_path_missing`, or null when it is available.
   */
  reason: string | null;
};

type ProcessWithResources = NodeJS.Process & { resourcesPath?: string };

export function weknoraPlatformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`;
}

function binaryFileName(platform: string = process.platform): string {
  return platform === "win32" ? `${WEKNORA_BINARY_BASENAME}.exe` : WEKNORA_BINARY_BASENAME;
}

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * First existing ancestor of `from` that contains `relative`. The dev tree is found by walking up
 * rather than from `import.meta.url`, so it works the same from a `src/` test, a `dist/` build and
 * a `pnpm --filter` run whose cwd is a package directory.
 */
function findUpwards(from: string, relative: string, maxDepth = 6): string | null {
  let dir = path.resolve(from);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

const DEV_RESOURCES = path.join("apps", "desktop", "resources", "weknora");

/** Candidate paths in resolution order. Exported so a test can assert the order without a binary. */
export function weknoraBinaryCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const file = binaryFileName();
  const key = weknoraPlatformKey();
  const out: string[] = [];
  const resourcesPath = (process as ProcessWithResources).resourcesPath;
  if (process.versions.electron && resourcesPath) {
    // Staged per platform (what `scripts/stage-weknora.mjs` writes), then flat: a build that
    // copied only the one platform's folder contents is equally valid and equally ours.
    out.push(path.join(resourcesPath, "weknora", key, file));
    out.push(path.join(resourcesPath, "weknora", file));
  }
  const dev = findUpwards(env.AGENTFORGE_REPO_ROOT?.trim() || process.cwd(), DEV_RESOURCES);
  if (dev) {
    out.push(path.join(dev, key, file));
  }
  return out;
}

/**
 * A sticky, process-wide refusal. Set when the sidecar's port turned out to be owned by a process
 * that is not the child we spawned (see port-owner.ts): that machine has something sitting on
 * loopback ports ahead of us, and retrying would just hand it another chance at our credentials.
 * Cleared only by restarting the host — deliberately, so the owner sees a stable "unavailable".
 */
let disabledReason: string | null = null;

export function disableWeknoraBinary(reason: string): void {
  disabledReason = reason;
}

/** Test hook: forget a sticky refusal so the next case starts from a clean process. */
export function resetWeknoraBinaryStateForTests(): void {
  disabledReason = null;
}

/**
 * Resolve the sidecar. Pure and cheap (a handful of `stat` calls), so it is *not* cached: the
 * binary can appear between two calls — a dev stages it, or an installer repairs it — and a cached
 * "missing" would hide that until the next restart.
 */
export function weknoraAvailable(env: NodeJS.ProcessEnv = process.env): WeKnoraBinary {
  if (disabledReason) {
    return { available: false, path: null, reason: disabledReason };
  }
  const override = env.AGENTFORGE_WEKNORA_PATH?.trim();
  if (override) {
    // An explicit override that does not exist is an error the owner needs to see, never a silent
    // fall-through to a different binary than the one they named.
    return isFile(override)
      ? { available: true, path: override, reason: null }
      : { available: false, path: null, reason: "env_path_missing" };
  }
  if (!(WEKNORA_PLATFORMS as readonly string[]).includes(weknoraPlatformKey())) {
    return { available: false, path: null, reason: "unsupported_platform" };
  }
  for (const candidate of weknoraBinaryCandidates(env)) {
    if (isFile(candidate)) {
      return { available: true, path: candidate, reason: null };
    }
  }
  return { available: false, path: null, reason: "not_staged" };
}

/** The directory the sidecar must be spawned in, so `migrations/sqlite` resolves next to it. */
export function weknoraBinaryDir(binaryPath: string): string {
  return path.dirname(binaryPath);
}

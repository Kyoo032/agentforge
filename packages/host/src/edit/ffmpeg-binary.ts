import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { wellKnownBinaryPaths, wingetPackageBinaryPaths } from "./ffmpeg-locations";
import { minimalEnv } from "./ffmpeg/env";

export type BinaryStatus = {
  found: boolean;
  path: string | null;
  version: string | null;
  reason?: string;
};

type ProcessWithResources = NodeJS.Process & { resourcesPath?: string };

let ffmpegCache: BinaryStatus | undefined;
let ffprobeCache: BinaryStatus | undefined;

export function resetFfmpegBinaryCache(): void {
  ffmpegCache = undefined;
  ffprobeCache = undefined;
}

export function parseFfmpegVersion(stdout: string): { version: string; major: number } | null {
  const match = stdout.match(/version\s+n?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!match) {
    return null;
  }
  const major = Number(match[1]);
  if (!Number.isInteger(major)) {
    return null;
  }
  const version = [match[1], match[2], match[3]].filter((part) => part != null).join(".");
  return { version, major };
}

function execVersion(binPath: string): string {
  return execFileSync(binPath, ["-version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    // A probe is still a spawn of a binary we did not build, picked up from PATH or a winget
    // directory. It gets the same allowlisted environment as a real ffmpeg run, so the wrap key is
    // never one `child.env` away from whatever is sitting at that path.
    env: minimalEnv(),
  });
}

function probeBinary(candidate: string): BinaryStatus {
  try {
    const stdout = execVersion(candidate);
    const parsed = parseFfmpegVersion(stdout);
    if (!parsed) {
      return { found: false, path: candidate, version: null, reason: "unparsed_version" };
    }
    if (parsed.major < 6) {
      return { found: false, path: candidate, version: parsed.version, reason: "version_below_6" };
    }
    return { found: true, path: candidate, version: parsed.version };
  } catch {
    return { found: false, path: candidate, version: null, reason: "exec_failed" };
  }
}

/**
 * `where.exe` by absolute path on Windows: resolving it through PATH means the first `where.exe`
 * on PATH decides where we look for ffmpeg, which is the lookup we are trying to secure.
 * `%SystemRoot%` falls back to the default install path when the variable is missing.
 */
function whichCommand(): string {
  if (process.platform !== "win32") {
    // Left as a PATH lookup: `which` lives in different places across macOS and the Linux distros
    // the mac/Cloud routes run on, and pinning it there would break discovery for no gain.
    return "which";
  }
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows";
  // `path.win32`, not `path.join`: this branch is building a Windows path by hand, and on Windows
  // the two are the same function. Off Windows `path.join` joins with "/", so the absolute path
  // this is supposed to pin came out as `C:\Windows/System32/where.exe` — which is why the test
  // for this hardening only passed when it ran on Windows, i.e. never in CI.
  return path.win32.join(systemRoot, "System32", "where.exe");
}

function whichOnPath(name: string): string | null {
  const cmd = whichCommand();
  try {
    const out = execFileSync(cmd, [name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      env: minimalEnv(),
    });
    const first = out
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return first ?? null;
  } catch {
    return null;
  }
}

function packagedBinary(name: "ffmpeg" | "ffprobe"): string | null {
  if (!process.versions.electron) {
    return null;
  }
  const resourcesPath = (process as ProcessWithResources).resourcesPath;
  if (!resourcesPath) {
    return null;
  }
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const candidate = path.join(resourcesPath, "ffmpeg", file);
  return existsSync(candidate) ? candidate : null;
}

function siblingBinary(ffmpegPath: string, name: "ffprobe"): string | null {
  const dir = path.dirname(ffmpegPath);
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const candidate = path.join(dir, file);
  return existsSync(candidate) ? candidate : null;
}

function listDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Probe package-manager install locations for GUI apps with a bare PATH.
 * Every existing candidate is tried, so a dangling leftover (e.g. after `brew uninstall`)
 * does not hide a working build further down the list.
 */
function probeWellKnown(kind: "ffmpeg" | "ffprobe"): BinaryStatus {
  const ctx = { platform: process.platform, env: process.env, home: os.homedir() };
  const candidates = [...wellKnownBinaryPaths(kind, ctx), ...wingetPackageBinaryPaths(kind, ctx, listDirSafe)];
  let lastFailure: BinaryStatus | null = null;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    const status = probeBinary(candidate);
    if (status.found) {
      return status;
    }
    lastFailure = status;
  }
  return lastFailure ?? { found: false, path: null, version: null, reason: "missing" };
}

function resolveNamed(kind: "ffmpeg" | "ffprobe"): BinaryStatus {
  const envKey = kind === "ffmpeg" ? "AGENTFORGE_FFMPEG_PATH" : "AGENTFORGE_FFPROBE_PATH";
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) {
    return probeBinary(fromEnv);
  }
  if (kind === "ffprobe") {
    const ffmpegEnv = process.env.AGENTFORGE_FFMPEG_PATH?.trim();
    if (ffmpegEnv) {
      const sibling = siblingBinary(ffmpegEnv, "ffprobe");
      if (sibling) {
        return probeBinary(sibling);
      }
    }
  }
  const packaged = packagedBinary(kind);
  if (packaged) {
    return probeBinary(packaged);
  }
  const onPath = whichOnPath(kind);
  if (onPath) {
    const status = probeBinary(onPath);
    if (status.found) {
      return status;
    }
  }
  return probeWellKnown(kind);
}

export function resolveFfmpeg(): BinaryStatus {
  if (!ffmpegCache) {
    ffmpegCache = resolveNamed("ffmpeg");
  }
  return ffmpegCache;
}

export function resolveFfprobe(): BinaryStatus {
  if (!ffprobeCache) {
    ffprobeCache = resolveNamed("ffprobe");
  }
  return ffprobeCache;
}

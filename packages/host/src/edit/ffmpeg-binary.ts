import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { wellKnownBinaryPaths, wingetPackageBinaryPaths } from "./ffmpeg-locations";

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

function whichOnPath(name: string): string | null {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(cmd, [name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
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

import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { trackChild } from "../child-processes";
import { wellKnownBinaryPaths, wingetPackageBinaryPaths } from "./ffmpeg-locations";
import { minimalEnv } from "./ffmpeg/env";

export type BinaryStatus = {
  found: boolean;
  path: string | null;
  version: string | null;
  reason?: string;
};

type ProcessWithResources = NodeJS.Process & { resourcesPath?: string };

type BinaryKind = "ffmpeg" | "ffprobe";

/**
 * One probe result per binary for the life of the process.
 *
 * Finding ffmpeg costs a PATH walk (`where.exe` alone is ~220 ms on a Windows desk) plus a
 * `-version` run, so the answer is kept until something that could change it does:
 *  - the configured path (`AGENTFORGE_FFMPEG_PATH` / `AGENTFORGE_FFPROBE_PATH`) changes, which the
 *    `key` here records, or
 *  - `resetFfmpegBinaryCache()` is called: the Edit banner's "Check again" (`getEditDoctor` /
 *    `getEditDoctorAsync` with `recheck`) is the one production caller. There is no ffmpeg entry in
 *    the component installer yet (`components/manifest.ts`); the day one lands, its install step
 *    calls this reset too.
 */
type CacheEntry = { key: string; status: BinaryStatus };

type Slot = {
  cache?: CacheEntry;
  /** The async probe currently running, so two callers during boot share one PATH walk. */
  inflight?: { key: string; promise: Promise<BinaryStatus> };
};

let slots: Record<BinaryKind, Slot> = { ffmpeg: {}, ffprobe: {} };

function configuredKey(): string {
  return JSON.stringify([
    process.env.AGENTFORGE_FFMPEG_PATH?.trim() ?? "",
    process.env.AGENTFORGE_FFPROBE_PATH?.trim() ?? "",
  ]);
}

/**
 * Forget every answer, and every probe still running. The slots are replaced rather than emptied on
 * purpose: an async probe that started before the reset holds the old slot, so when it finishes it
 * fills an orphan, not the cache of the question asked after the reset.
 */
export function resetFfmpegBinaryCache(): void {
  slots = { ffmpeg: {}, ffprobe: {} };
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

/**
 * Spawn options shared by every probe, sync and async.
 *
 * A probe is still a spawn of a binary we did not build, picked up from PATH or a winget directory.
 * It gets the same allowlisted environment as a real ffmpeg run, so the wrap key is never one
 * `child.env` away from whatever is sitting at that path.
 */
function probeOptions() {
  return { encoding: "utf8" as const, windowsHide: true, timeout: 10_000, env: minimalEnv() };
}

/**
 * The async twin of `execFileSync`: same options, same "any failure rejects". The child is tracked,
 * so a Cmd+Q that lands mid-probe signals it like any other helper (`child-processes.ts`); the
 * synchronous probes never needed that, because nothing could quit while they blocked.
 */
function execAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, probeOptions(), (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
    if (child) {
      trackChild(child);
    }
  });
}

/** A `-version` banner turned into a verdict. Shared by both probes so they cannot disagree. */
function statusFromBanner(candidate: string, stdout: string): BinaryStatus {
  const parsed = parseFfmpegVersion(stdout);
  if (!parsed) {
    return { found: false, path: candidate, version: null, reason: "unparsed_version" };
  }
  if (parsed.major < 6) {
    return { found: false, path: candidate, version: parsed.version, reason: "version_below_6" };
  }
  return { found: true, path: candidate, version: parsed.version };
}

function execFailed(candidate: string): BinaryStatus {
  return { found: false, path: candidate, version: null, reason: "exec_failed" };
}

function probeBinary(candidate: string): BinaryStatus {
  try {
    return statusFromBanner(candidate, execFileSync(candidate, ["-version"], probeOptions()));
  } catch {
    return execFailed(candidate);
  }
}

async function probeBinaryAsync(candidate: string): Promise<BinaryStatus> {
  try {
    return statusFromBanner(candidate, await execAsync(candidate, ["-version"]));
  } catch {
    return execFailed(candidate);
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

/** `where`/`which` print one match per line; the first one is the one PATH order would run. */
function firstMatch(out: string): string | null {
  const first = out
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return first ?? null;
}

function whichOnPath(name: string): string | null {
  try {
    return firstMatch(execFileSync(whichCommand(), [name], probeOptions()));
  } catch {
    return null;
  }
}

async function whichOnPathAsync(name: string): Promise<string | null> {
  try {
    return firstMatch(await execAsync(whichCommand(), [name]));
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

/** Existing package-manager install locations, in the order they are tried. */
function wellKnownCandidates(kind: BinaryKind): string[] {
  const ctx = { platform: process.platform, env: process.env, home: os.homedir() };
  return [...wellKnownBinaryPaths(kind, ctx), ...wingetPackageBinaryPaths(kind, ctx, listDirSafe)].filter((candidate) =>
    existsSync(candidate),
  );
}

const MISSING: BinaryStatus = { found: false, path: null, version: null, reason: "missing" };

/**
 * Probe package-manager install locations for GUI apps with a bare PATH.
 * Every existing candidate is tried, so a dangling leftover (e.g. after `brew uninstall`)
 * does not hide a working build further down the list.
 */
function probeWellKnown(kind: BinaryKind): BinaryStatus {
  let lastFailure: BinaryStatus | null = null;
  for (const candidate of wellKnownCandidates(kind)) {
    const status = probeBinary(candidate);
    if (status.found) {
      return status;
    }
    lastFailure = status;
  }
  return lastFailure ?? { ...MISSING };
}

async function probeWellKnownAsync(kind: BinaryKind): Promise<BinaryStatus> {
  let lastFailure: BinaryStatus | null = null;
  for (const candidate of wellKnownCandidates(kind)) {
    const status = await probeBinaryAsync(candidate);
    if (status.found) {
      return status;
    }
    lastFailure = status;
  }
  return lastFailure ?? { ...MISSING };
}

/**
 * The one path that settles the question without a PATH search, if there is one: the configured
 * path, then (for ffprobe) the sibling of the configured ffmpeg, then the copy bundled with the
 * packaged app. Whatever this returns is probed and reported as-is, found or not.
 */
function directCandidate(kind: BinaryKind): string | null {
  const envKey = kind === "ffmpeg" ? "AGENTFORGE_FFMPEG_PATH" : "AGENTFORGE_FFPROBE_PATH";
  const fromEnv = process.env[envKey]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  if (kind === "ffprobe") {
    const ffmpegEnv = process.env.AGENTFORGE_FFMPEG_PATH?.trim();
    if (ffmpegEnv) {
      const sibling = siblingBinary(ffmpegEnv, "ffprobe");
      if (sibling) {
        return sibling;
      }
    }
  }
  return packagedBinary(kind);
}

function resolveNamed(kind: BinaryKind): BinaryStatus {
  const direct = directCandidate(kind);
  if (direct) {
    return probeBinary(direct);
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

async function resolveNamedAsync(kind: BinaryKind): Promise<BinaryStatus> {
  const direct = directCandidate(kind);
  if (direct) {
    return probeBinaryAsync(direct);
  }
  const onPath = await whichOnPathAsync(kind);
  if (onPath) {
    const status = await probeBinaryAsync(onPath);
    if (status.found) {
      return status;
    }
  }
  return probeWellKnownAsync(kind);
}

function resolveCached(kind: BinaryKind): BinaryStatus {
  const slot = slots[kind];
  const key = configuredKey();
  if (slot.cache?.key === key) {
    return slot.cache.status;
  }
  const status = resolveNamed(kind);
  slot.cache = { key, status };
  return status;
}

function resolveCachedAsync(kind: BinaryKind): Promise<BinaryStatus> {
  const slot = slots[kind];
  const key = configuredKey();
  if (slot.cache?.key === key) {
    return Promise.resolve(slot.cache.status);
  }
  if (slot.inflight?.key === key) {
    return slot.inflight.promise;
  }
  const promise = resolveNamedAsync(kind)
    .then((status) => {
      // `slot` is the one this probe started under; after a reset it is an orphan and this is harmless.
      slot.cache = { key, status };
      return status;
    })
    .finally(() => {
      // Cleared on failure too: a probe that rejects must not leave its rejected promise as the
      // answer to every later call. The synchronous path would simply try again, and so does this.
      if (slot.inflight?.key === key) {
        slot.inflight = undefined;
      }
    });
  slot.inflight = { key, promise };
  return promise;
}

export function resolveFfmpeg(): BinaryStatus {
  return resolveCached("ffmpeg");
}

/**
 * `resolveFfmpeg` without blocking the event loop. Boot uses this to warm the cache after the first
 * paint; the Edit doctor route uses it so a "Check again" does not freeze the host for the ~300 ms a
 * cold PATH walk takes. Sync callers keep `resolveFfmpeg` and read the cache this fills.
 */
export function resolveFfmpegAsync(): Promise<BinaryStatus> {
  return resolveCachedAsync("ffmpeg");
}

export function resolveFfprobe(): BinaryStatus {
  return resolveCached("ffprobe");
}

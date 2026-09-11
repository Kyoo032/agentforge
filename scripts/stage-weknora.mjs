#!/usr/bin/env node
/**
 * Stage the pinned WeKnora-lite sidecar into apps/desktop/resources/weknora/<platform>/ so
 * electron-builder bundles it (extraResources). Nothing here runs at install or app runtime.
 *
 *   node scripts/stage-weknora.mjs                 # current platform only
 *   node scripts/stage-weknora.mjs --all           # win32-x64 + darwin-arm64 + darwin-x64
 *   node scripts/stage-weknora.mjs --platform darwin-arm64
 *   node scripts/stage-weknora.mjs --from <dir>    # use archives already on disk (CI artifact dir)
 *   node scripts/stage-weknora.mjs --write-lock    # record sha256 of freshly downloaded archives
 *
 * Source of truth: apps/desktop/weknora.lock.json (ref, release tag, per-platform archive + sha256).
 * Downloads use `gh release download` (the release lives on the private repo, so gh auth is the
 * credential). A sha256 mismatch against the lock is fatal; a null sha256 is only accepted with
 * --write-lock, which fills it in.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = path.join(ROOT, "apps", "desktop", "weknora.lock.json");
const DEST_ROOT = path.join(ROOT, "apps", "desktop", "resources", "weknora");
const PLATFORMS = ["win32-x64", "darwin-arm64", "darwin-x64"];

function parseArgs(argv) {
  const args = { all: false, platform: null, from: null, writeLock: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") args.all = true;
    else if (arg === "--write-lock") args.writeLock = true;
    else if (arg === "--platform") args.platform = argv[++i] ?? null;
    else if (arg === "--from") args.from = argv[++i] ?? null;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function currentPlatform() {
  const key = `${process.platform}-${process.arch}`;
  if (!PLATFORMS.includes(key)) {
    throw new Error(`no WeKnora-lite build for ${key}; supported: ${PLATFORMS.join(", ")}`);
  }
  return key;
}

function readLock() {
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8"));
  for (const key of ["ref", "releaseTag", "releaseRepo", "platforms"]) {
    if (!lock[key]) throw new Error(`weknora.lock.json: missing "${key}"`);
  }
  return lock;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit ${result.status}`);
  }
}

function download(lock, archive, into) {
  mkdirSync(into, { recursive: true });
  run("gh", ["release", "download", lock.releaseTag, "-R", lock.releaseRepo, "-p", archive, "-D", into, "--clobber"]);
  const file = path.join(into, archive);
  if (!existsSync(file)) throw new Error(`download did not produce ${file}`);
  return file;
}

function extract(archive, into) {
  rmSync(into, { recursive: true, force: true });
  mkdirSync(into, { recursive: true });
  if (archive.endsWith(".zip")) {
    if (process.platform === "win32") {
      run("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${into}' -Force`]);
    } else {
      run("unzip", ["-q", "-o", archive, "-d", into]);
    }
  } else {
    run("tar", ["-xzf", archive, "-C", into]);
  }
  // Archives contain a single top-level folder named after the archive; flatten it.
  const entries = readdirSync(into);
  if (entries.length === 1 && statSync(path.join(into, entries[0])).isDirectory()) {
    const inner = path.join(into, entries[0]);
    for (const name of readdirSync(inner)) {
      const src = path.join(inner, name);
      const dst = path.join(into, name);
      rmSync(dst, { recursive: true, force: true });
      run(process.platform === "win32" ? "cmd" : "mv", process.platform === "win32" ? ["/c", "move", "/y", src, dst] : [src, dst]);
    }
    rmSync(inner, { recursive: true, force: true });
  }
}

function verifyLayout(platform, dir) {
  const binary = platform.startsWith("win32") ? "WeKnora-lite.exe" : "WeKnora-lite";
  const required = [binary, "migrations/sqlite", "LICENSE", "THIRD_PARTY_NOTICES.md"];
  const missing = required.filter((rel) => !existsSync(path.join(dir, rel)));
  if (missing.length > 0) {
    throw new Error(`${platform}: staged folder is missing ${missing.join(", ")}`);
  }
  const size = statSync(path.join(dir, binary)).size;
  console.log(`  ${platform}: ${binary} ${(size / 1024 / 1024).toFixed(1)} MB, migrations/sqlite present`);
}

function stage(lock, platform, args) {
  const entry = lock.platforms[platform];
  if (!entry) throw new Error(`weknora.lock.json has no entry for ${platform}`);
  const work = path.join(tmpdir(), `weknora-stage-${platform}`);
  const archive = args.from ? path.join(args.from, entry.archive) : download(lock, entry.archive, work);
  if (!existsSync(archive)) throw new Error(`archive not found: ${archive}`);
  const digest = sha256(archive);
  if (entry.sha256 && entry.sha256 !== digest) {
    throw new Error(`${platform}: sha256 mismatch\n  lock: ${entry.sha256}\n  file: ${digest}`);
  }
  if (!entry.sha256 && !args.writeLock) {
    throw new Error(`${platform}: lock has no sha256 yet; re-run with --write-lock to record ${digest}`);
  }
  extract(archive, path.join(DEST_ROOT, platform));
  verifyLayout(platform, path.join(DEST_ROOT, platform));
  return digest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const lock = readLock();
  const targets = args.all ? PLATFORMS : [args.platform ?? currentPlatform()];
  console.log(`staging WeKnora-lite ${lock.releaseTag} (${lock.ref.slice(0, 12)}) for ${targets.join(", ")}`);
  const digests = {};
  for (const platform of targets) {
    digests[platform] = stage(lock, platform, args);
  }
  if (args.writeLock) {
    const next = { ...lock, platforms: { ...lock.platforms } };
    for (const [platform, digest] of Object.entries(digests)) {
      next.platforms[platform] = { ...next.platforms[platform], sha256: digest };
    }
    writeFileSync(LOCK_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`updated ${path.relative(ROOT, LOCK_PATH)}`);
  }
  console.log("done");
}

try {
  main();
} catch (error) {
  console.error(`stage-weknora: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

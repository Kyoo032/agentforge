#!/usr/bin/env node
/**
 * Build the macOS dmg + zip on this Windows box through Docker (Linux container).
 *
 * electron-builder allows the mac target on Linux but not on Windows, and a Linux container can
 * run the tools that replace Apple's: libdmg-hfsplus for the disk image, rcodesign for the ad-hoc
 * signature, hfsprogs for the HFS+ volume. See apps/desktop/platform/macos/docker/.
 *
 *   node scripts/mac-build-docker.mjs [--arch arm64|x64|all] [--no-image-build] [--allow-dirty]
 *
 * Builds only what is committed (the container clones HEAD); starter media is copied from the
 * working tree because it is generated. Output lands in apps/desktop/dist/ as
 * Agentforge-<version>-mac-<arch>.dmg|zip plus a sha256 manifest, ready for
 * `pnpm desktop:release --attach-mac`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopRoot, "..", "..");
const dockerDir = join(desktopRoot, "platform", "macos", "docker");
const distDir = join(desktopRoot, "dist");
const IMAGE = "agentforge-mac-builder:latest";
const CACHE_VOLUME = "agentforge-mac-cache";

function fail(message) {
  console.error(`mac-build-docker: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = { arch: "all", imageBuild: true, allowDirty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--arch") {
      flags.arch = argv[++i] ?? "";
    } else if (arg === "--no-image-build") {
      flags.imageBuild = false;
    } else if (arg === "--allow-dirty") {
      flags.allowDirty = true;
    } else {
      fail(`unknown argument ${arg}`);
    }
  }
  if (!["arm64", "x64", "all"].includes(flags.arch)) {
    fail("--arch must be arm64, x64 or all");
  }
  return flags;
}

function run(command, args, options = {}) {
  const shown = [command, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
  console.log(`mac-build-docker: ${shown}`);
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) {
    fail(`could not start ${command}: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function checkDocker() {
  const info = spawnSync("docker", ["info", "--format", "{{.OSType}}"], { encoding: "utf8" });
  if (info.status !== 0 || !info.stdout.includes("linux")) {
    fail("Docker engine is not running or is not in Linux container mode. Start Docker Desktop first.");
  }
}

function checkTree(flags) {
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
  if (status.status !== 0) {
    fail("git status failed");
  }
  const dirty = status.stdout.trim();
  if (dirty) {
    console.warn("mac-build-docker: working tree is dirty; the container builds HEAD only. Uncommitted:");
    console.warn(dirty.split(/\r?\n/).slice(0, 15).map((line) => `  ${line}`).join("\n"));
    if (!flags.allowDirty) {
      fail("commit first, or pass --allow-dirty to build HEAD anyway");
    }
  }
  const starters = join(desktopRoot, "resources", "starters");
  const media = existsSync(starters) ? readdirSync(starters).filter((n) => /\.(mp4|m4a)$/i.test(n)) : [];
  if (media.length === 0) {
    fail("no starter media in apps/desktop/resources/starters; run node scripts/edit-starters.mjs first");
  }
}

function version() {
  return JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8")).version;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  checkDocker();
  checkTree(flags);
  mkdirSync(distDir, { recursive: true });

  if (flags.imageBuild) {
    const built = run("docker", ["build", "-t", IMAGE, "-f", join(dockerDir, "Dockerfile"), dockerDir]);
    if (built !== 0) {
      fail(`docker build exited ${built}`);
    }
  }

  const arches = flags.arch === "all" ? "arm64 x64" : flags.arch;
  const status = run("docker", [
    "run", "--rm",
    "-v", `${repoRoot}:/src:ro`,
    "-v", `${distDir}:/out`,
    "-v", `${CACHE_VOLUME}:/cache`,
    "-e", `MAC_ARCHES=${arches}`,
    IMAGE,
  ]);
  if (status !== 0) {
    fail(`container build exited ${status}`);
  }

  const v = version();
  const produced = readdirSync(distDir).filter((n) => n.startsWith(`Agentforge-${v}-mac-`)).sort();
  console.log(`mac-build-docker: artifacts in apps/desktop/dist:\n${produced.map((n) => `  ${n}`).join("\n")}`);
  console.log("mac-build-docker: next: node scripts/release-desktop.mjs --attach-mac --dry-run");
}

main();

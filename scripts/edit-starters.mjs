#!/usr/bin/env node
/**
 * Generate the bundled Edit starter media into apps/desktop/resources/starters/.
 *
 * The manifest (packages/core/src/edit/starter-media.json) is the single source of truth:
 * every entry's `generate` block is rendered here with ffmpeg lavfi sources, deterministically,
 * so the files never need to be downloaded. Swap any file for real footage of the same
 * duration and aspect and the starter picks it up unchanged.
 *
 * Usage (repo root): node scripts/edit-starters.mjs [--check]
 *   --check  only verify that every manifest file exists; exit 1 if any is missing.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "packages/core/src/edit/starter-media.json");
const outDir = path.join(repoRoot, "apps/desktop/resources/starters");
const checkOnly = process.argv.includes("--check");

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const names = Object.keys(manifest.files);

if (checkOnly) {
  const missing = names.filter((name) => !existsSync(path.join(outDir, name)));
  if (missing.length > 0) {
    console.error(`edit-starters: missing ${missing.length} file(s) in ${outDir}: ${missing.join(", ")}`);
    console.error("Run `node scripts/edit-starters.mjs` (needs ffmpeg) or drop your own files there.");
    process.exit(1);
  }
  console.log(`edit-starters: all ${names.length} files present in ${outDir}`);
  process.exit(0);
}

function ffmpegBin() {
  const fromEnv = process.env.AGENTFORGE_FFMPEG_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "ffmpeg";
}

const ENCODE_V = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-maxrate", "900k", "-bufsize", "1800k",
  "-pix_fmt", "yuv420p", "-threads", "1", "-x264-params", "threads=1:sliced-threads=0",
];
const BITEXACT = ["-fflags", "+bitexact", "-flags", "+bitexact", "-map_metadata", "-1"];

function runFfmpeg(args) {
  execFileSync(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
}

function render(name, file) {
  const dest = path.join(outDir, name);
  const seconds = String(file.durationSeconds);
  const gen = file.generate;
  const args = [];
  if (gen.video) {
    args.push("-f", "lavfi", "-i", gen.video);
  }
  if (gen.audio) {
    args.push("-f", "lavfi", "-i", gen.audio);
  }
  const filters = [];
  if (gen.video && gen.videoFilter) {
    filters.push(`[0:v]${gen.videoFilter}[v]`);
  }
  if (gen.audio && gen.audioFilter) {
    filters.push(`[${gen.video ? 1 : 0}:a]${gen.audioFilter}[a]`);
  }
  if (filters.length > 0) {
    args.push("-filter_complex", filters.join(";"));
  }
  if (gen.video) {
    args.push("-map", gen.videoFilter ? "[v]" : "0:v");
  }
  if (gen.audio) {
    args.push("-map", gen.audioFilter ? "[a]" : `${gen.video ? 1 : 0}:a`);
  }
  args.push("-t", seconds);
  if (gen.video) {
    args.push(...ENCODE_V);
  }
  if (gen.audio) {
    args.push("-c:a", "aac", "-b:a", "96k");
  } else {
    args.push("-an");
  }
  args.push(...BITEXACT, dest);
  runFfmpeg(args);
}

mkdirSync(outDir, { recursive: true });
for (const name of names) {
  render(name, manifest.files[name]);
  console.log(`edit-starters: wrote ${name}`);
}
console.log(`edit-starters: ${names.length} files in ${outDir}`);

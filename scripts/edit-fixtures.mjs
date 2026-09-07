#!/usr/bin/env node
/**
 * Generate deterministic Edit lavfi fixtures into apps/web/tests/fixtures/edit/.
 * Captions/script are committed source; mp4/png are gitignored outputs.
 *
 * Usage (repo root): node scripts/edit-fixtures.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "apps/web/tests/fixtures/edit");

function ffmpegBin() {
  const fromEnv = process.env.AGENTFORGE_FFMPEG_PATH?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : "ffmpeg";
}

const ENCODE_V = [
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "28",
  "-maxrate",
  "180k",
  "-bufsize",
  "360k",
  "-pix_fmt",
  "yuv420p",
  "-threads",
  "1",
  "-x264-params",
  "threads=1:sliced-threads=0",
];

const BITEXACT = ["-fflags", "+bitexact", "-flags", "+bitexact", "-map_metadata", "-1"];

function runFfmpeg(args) {
  execFileSync(ffmpegBin(), ["-y", "-hide_banner", "-loglevel", "error", ...args], {
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
}

function talk60s() {
  const dest = path.join(outDir, "talk-60s.mp4");
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1280x720:rate=30:duration=60",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=60",
    "-filter_complex",
    "[1:a]volume=0:enable='between(t,10,12)+between(t,25,27.5)+between(t,45,46.5)'[a]",
    "-map",
    "0:v",
    "-map",
    "[a]",
    "-t",
    "60",
    ...ENCODE_V,
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    ...BITEXACT,
    dest,
  ]);
}

function scenes45s() {
  const dest = path.join(outDir, "scenes-45s.mp4");
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=1280x720:r=30:d=15",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:s=1280x720:r=30:d=15",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=1280x720:r=30:d=15",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
    "-map",
    "[v]",
    ...ENCODE_V,
    "-an",
    ...BITEXACT,
    dest,
  ]);
}

function portrait() {
  const dest = path.join(outDir, "portrait-9x16.mp4");
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=720x1280:rate=30:duration=10",
    "-t",
    "10",
    ...ENCODE_V,
    "-an",
    ...BITEXACT,
    dest,
  ]);
}

function photo(index, hue) {
  const dest = path.join(outDir, `photo-${index}.png`);
  runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=320x240:rate=1,hue=h=${hue}:s=1`,
    "-frames:v",
    "1",
    "-update",
    "1",
    dest,
  ]);
}

mkdirSync(outDir, { recursive: true });
talk60s();
scenes45s();
portrait();
photo(1, 0);
photo(2, 120);
photo(3, 240);
console.log(`edit-fixtures: wrote ${outDir}`);

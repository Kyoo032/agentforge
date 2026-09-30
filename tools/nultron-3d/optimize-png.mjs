#!/usr/bin/env node
// Lossless re-encode of PNG files (smaller files, identical pixels): the brand PNGs render-all.mjs writes to <out>/brand.
//   node optimize-png.mjs <dir | file.png> [...]
// Every scanline gets the filter with the smallest residuals and the deflate stream is level 9. A file is only replaced when the
// new one is smaller AND decodes to exactly the same pixels; otherwise it is left as it was.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodePng, encodePng } from "./lib/png.mjs";

function pngFiles(target) {
  if (statSync(target).isDirectory()) {
    return readdirSync(target)
      .filter((name) => name.toLowerCase().endsWith(".png"))
      .sort()
      .map((name) => join(target, name));
  }
  return [target];
}

const targets = process.argv.slice(2).map((p) => resolve(p));
if (targets.length === 0) {
  console.error("usage: optimize-png.mjs <dir | file.png> [...]");
  process.exit(2);
}
let saved = 0;
for (const file of targets.flatMap(pngFiles)) {
  const before = readFileSync(file);
  const image = decodePng(before);
  const after = encodePng(image);
  const same = decodePng(after).pixels.equals(image.pixels);
  const better = same && after.length < before.length;
  if (better) writeFileSync(file, after);
  saved += better ? before.length - after.length : 0;
  console.log(`${file}  ${before.length} -> ${better ? after.length : before.length}${better ? "" : same ? " (already smaller)" : " (KEPT: pixels differ)"}`);
}
console.log(`optimize-png: ${saved} bytes saved`);

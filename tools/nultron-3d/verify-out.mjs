// Checks a render directory: every manifest entry exists, strips have the advertised size, and prints per-folder bytes.
//   node verify-out.mjs [dir]      (default: tools/nultron-3d/out)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "out"));
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(out);
const by = {};
let total = 0;
for (const f of files) {
  const s = statSync(f).size;
  total += s;
  const k = f.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  by[k] = (by[k] ?? 0) + s;
}
console.log("files", files.length);
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(14), String(v).padStart(9), `${(v / 1024).toFixed(0)} KB`);
console.log("TOTAL out/".padEnd(14), String(total).padStart(9), `${(total / 1e6).toFixed(3)} MB (${(total / 1048576).toFixed(3)} MiB)`);

const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
let problems = 0;
const need = (rel) => {
  if (!existsSync(join(out, rel))) {
    console.log("MISSING", rel);
    problems++;
  }
};
for (const v of Object.values(m.full.states)) need(v);
for (const v of Object.values(m.head.states)) need(v);
for (const v of Object.values(m.clips)) need(v.src);
for (const v of Object.values(m.loops)) need(v.src);
// WebP header: RIFF....WEBPVP8X, canvas width/height at bytes 24..29 (24-bit little endian, minus one)
const dims = (rel) => {
  const b = readFileSync(join(out, rel));
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") return null;
  const fourcc = b.toString("ascii", 12, 16);
  if (fourcc === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: Boolean(b[20] & 0x10), fourcc };
  return { fourcc };
};
const check = (label, rel, w, h) => {
  const d = dims(rel);
  if (!d || d.w !== w || d.h !== h || !d.alpha) {
    console.log("DIM/ALPHA MISMATCH", label, rel, JSON.stringify(d), "want", w, h);
    problems++;
  }
};
for (const [s, rel] of Object.entries(m.full.states)) check(`full ${s}`, rel, 512, 512);
for (const [s, rel] of Object.entries(m.head.states)) check(`head ${s}`, rel, 256, 256);
for (const [s, c] of Object.entries(m.clips)) check(`clip ${s}`, c.src, c.frames * c.size, c.size);
for (const [s, c] of Object.entries(m.loops)) check(`loop ${s}`, c.src, c.frames * c.size, c.size);
const clipSeconds = Object.entries(m.clips).map(([s, c]) => `${s} ${(c.frames / c.fps).toFixed(2)}s`).join(", ");
console.log("clips:", clipSeconds);
console.log("loops:", Object.entries(m.loops).map(([s, c]) => `${s} ${c.frames}f@${c.fps}`).join(", "));
const assets = files.filter((f) => f.endsWith(".webp")).reduce((a, f) => a + statSync(f).size, 0);
console.log("webp assets", assets, "manifest.bytes", m.bytes, assets === m.bytes ? "(match)" : "(MISMATCH)");
console.log(problems ? `PROBLEMS: ${problems}` : "manifest OK: all files present, sizes and alpha as advertised");
process.exit(problems ? 1 : 0);

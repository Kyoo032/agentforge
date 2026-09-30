#!/usr/bin/env node
// Regenerates every Nultron raster from the master SVGs: the PNG ladder, icon.ico, icon.icns, favicon.ico and the
// same-size replacements for the logo/mark PNGs the repo ships today.
//
//   node apps/desktop/scripts/brand-icons.mjs --src <dir with the SVGs> --out <dir to write into>
//
// --src must hold icon-master.svg, icon-small.svg and mark.svg. Nothing here needs an npm dependency: the SVGs are
// rasterised by this repo's Electron (an offscreen, transparent BrowserWindow, captured through the DevTools
// screenshot call because capturePage is clamped to the window, which is clamped to the desktop), and the ICO and ICNS
// containers are written by the small writers below. ICO uses the classic layout the Windows resource tools expect
// (32-bit BGRA DIB entries plus a 1-bit AND mask for every size below 256, PNG for 256 only); ICNS carries PNG entries.
// The script starts itself twice: under node it launches Electron on this same file, and under Electron it renders.
//
// PNG source mode (the app logo), the default:
//   node apps/desktop/scripts/brand-icons.mjs --out <dir> [--png-src <dir>] [--src <dir with the wordmark SVGs>]
// --png-src defaults to apps/desktop/branding/agentforge/source. It must hold app-logo-cut.png (the logo tile with transparent
// corners, square, at least 1024 px) or, when that is absent, app-logo.webp: Rizky's 1600 px master, which Electron decodes and
// brand-logo-cut.mjs cuts out of its white corners (the cut is written to <out>/source/app-logo-cut.png). It may also hold
// icon-<n>.png (an exact-size picture that wins over resizing). Everything is derived from the one file: the Windows and
// web ladder (tile nearly full-bleed), a size-tuned tighter crop of the artwork for 16 to 32 px, an Apple-grid master
// (824 px tile in a 1024 canvas with a soft shadow) for the Dock sizes of the ICNS, the rail marks, the apple-touch icon
// and the replacement PNGs. Sizes are made with a Lanczos-3 resize on premultiplied alpha plus a small unsharp mask at the
// tiny sizes. With --src pointing at wordmark.svg and wordmark-light.svg the tile is also composited with the wordmark
// into stacked and horizontal lockup PNGs. Without --src the whole run is plain node (no Electron).
// Exit code 1 means a replacement PNG would not have the pixel size of the repo file it replaces (see --repo).
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";
import { CUT_SOURCE_SIZE, cutLogoTile } from "./brand-logo-cut.mjs";

export const PNG_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
export const FAVICON_ICO_SIZES = [16, 32, 48];
// Apple's PNG-in-ICNS types: type -> edge in pixels (ic10 is the 512@2x slot, so it carries 1024 px).
export const ICNS_TYPES = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
];
// icon-small.svg (bolder shapes, no fine highlights) takes over at this edge and below; larger sizes use the master.
export const SMALL_MAX = 32;

export const SOURCES = { master: "icon-master.svg", small: "icon-small.svg", mark: "mark.svg" };
export const FAVICON_SVG = "favicon.svg";

// Every repo file the kit's art lands on, and the kit file it becomes. `width` x `height` is the pixel size the repo file has and
// must keep (a swap that changed it would shift the layouts that show it); `ico: true` marks a container (.ico, .icns) with no
// single pixel size; `optional` files are refreshed when they exist and never created. Several paths are byte-identical copies
// of one another, so several paths share one kit file. Checked byte for byte against the tree on 2026-09-29: see
// docs/internal/maps/mascot-and-brand.md, "Regenerating".
const LOGO = { file: "replace/logo-1024.png", width: 1024, height: 1024, art: "icon" };
const LOGO_SMALL = { file: "replace/logo-160.png", width: 160, height: 160, art: "icon", optional: true };
const MARK = { file: "replace/mark-1024.png", width: 1024, height: 1024, art: "mark", fit: 0.64 };
// The display logo is the same tile at 256 px (110 KB): the packaged preload inlines it as base64 at every launch.
const LOGO_DISPLAY = { file: "mark/mark-256.png", width: 256, height: 256, art: "icon" };
const railMark = (size) => ({ file: `mark/mark-${size}.png`, width: size, height: size, art: "icon" });
export const REPLACEMENTS = [
  { repo: "apps/web/public/brand/logo.png", ...LOGO_DISPLAY },
  { repo: "apps/portal/assets/logo.png", ...LOGO_DISPLAY },
  { repo: "apps/desktop/resources/brand/logo.png", ...LOGO_DISPLAY },
  { repo: "apps/desktop/branding/agentforge/logo.png", ...LOGO_DISPLAY },
  { repo: "apps/desktop/splash/logo.png", ...LOGO_DISPLAY },
  { repo: "apps/desktop/logo.png", ...LOGO_SMALL },
  { repo: "apps/desktop/branding/agentforge/icon.png", ...LOGO },
  { repo: "apps/desktop/build/icon.png", ...LOGO },
  { repo: "apps/desktop/branding/agentforge/mark.png", ...MARK },
  { repo: "apps/web/components/brand-art/mark-24.png", ...railMark(24) },
  { repo: "apps/web/components/brand-art/mark-32.png", ...railMark(32) },
  { repo: "apps/web/components/brand-art/mark-48.png", ...railMark(48) },
  { repo: "apps/web/components/brand-art/mark-64.png", ...railMark(64) },
  { repo: "apps/web/public/brand/favicon-32.png", file: "favicon-32.png", width: 32, height: 32, art: "icon" },
  { repo: "apps/web/public/brand/favicon-180.png", file: "favicon-180.png", width: 180, height: 180, art: "icon" },
  { repo: "apps/web/public/brand/favicon.ico", file: "favicon.ico", ico: true },
  { repo: "apps/desktop/branding/agentforge/icon.ico", file: "icon.ico", ico: true },
  { repo: "apps/desktop/build/icon.ico", file: "icon.ico", ico: true },
  { repo: "apps/desktop/splash/icon.ico", file: "icon.ico", ico: true },
  { repo: "apps/desktop/branding/agentforge/icon.icns", file: "icon.icns", ico: true },
  { repo: "apps/desktop/build/icon.icns", file: "icon.icns", ico: true },
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR. Throws on anything that is not a PNG. */
export function readPngSize(png) {
  if (!Buffer.isBuffer(png) || png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG buffer");
  }
  if (png.toString("ascii", 12, 16) !== "IHDR") throw new Error("PNG has no IHDR chunk first");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function assertSquarePng(png, size, label) {
  const { width, height } = readPngSize(png);
  if (width !== size || height !== size) {
    throw new Error(`${label}: expected a ${size}x${size} PNG, got ${width}x${height}`);
  }
}

/** Entries this size and above stay PNG inside an ICO; smaller ones are DIBs (what makensis and rcedit have always read). */
export const ICO_PNG_FROM = 256;

/**
 * Decodes an 8-bit, non-interlaced RGB or RGBA PNG into straight (non-premultiplied) RGBA bytes, top row first.
 * That is all the rasteriser ever writes, so the other PNG flavours are refused rather than half-supported.
 */
export function decodePng(png) {
  const { width, height } = readPngSize(png);
  let ihdr = null;
  const idat = [];
  for (let pos = 8; pos + 12 <= png.length; ) {
    const length = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") ihdr = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + length;
  }
  const [bitDepth, colourType, , , interlace] = ihdr.subarray(8, 13);
  if (bitDepth !== 8 || interlace !== 0 || (colourType !== 6 && colourType !== 2)) {
    throw new Error(
      `unsupported PNG (bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace}): need 8-bit RGB or RGBA, not interlaced`,
    );
  }
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error("PNG pixel data has the wrong length");
  const rgba = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`PNG row ${y} has unknown filter ${filter}`);
      line[i] = (line[i] + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const from = x * bpp;
      const to = (y * width + x) * 4;
      rgba[to] = line[from];
      rgba[to + 1] = line[from + 1];
      rgba[to + 2] = line[from + 2];
      rgba[to + 3] = bpp === 4 ? line[from + 3] : 255;
    }
    prev = line;
  }
  return rgba;
}

/**
 * One ICO image in the classic DIB layout: a BITMAPINFOHEADER whose height is doubled (XOR bitmap plus AND mask), 32-bit
 * BGRA rows stored bottom-up, then a 1-bit AND mask (also bottom-up, rows padded to 4 bytes, 1 = transparent). Fully
 * transparent pixels are written as 0,0,0,0 so the mask and the XOR bits agree for renderers that ignore alpha.
 */
function dibFromRgba(rgba, size) {
  const maskRow = Math.ceil(size / 32) * 4;
  const xorBytes = size * size * 4;
  const dib = Buffer.alloc(40 + xorBytes + maskRow * size);
  dib.writeUInt32LE(40, 0); // biSize
  dib.writeInt32LE(size, 4); // biWidth
  dib.writeInt32LE(size * 2, 8); // biHeight: XOR bitmap and AND mask
  dib.writeUInt16LE(1, 12); // biPlanes
  dib.writeUInt16LE(32, 14); // biBitCount
  dib.writeUInt32LE(0, 16); // biCompression: BI_RGB
  dib.writeUInt32LE(xorBytes, 20); // biSizeImage, as the icons this replaces have it
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y; // bottom-up
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = 40 + (row * size + x) * 4;
      const alpha = rgba[from + 3];
      if (alpha === 0) {
        dib[40 + xorBytes + row * maskRow + (x >> 3)] |= 0x80 >> (x & 7);
        continue;
      }
      dib[to] = rgba[from + 2]; // B
      dib[to + 1] = rgba[from + 1]; // G
      dib[to + 2] = rgba[from]; // R
      dib[to + 3] = alpha;
    }
  }
  return dib;
}

/**
 * ICO in the layout Windows resource tools have always read: 32-bit DIB entries (with AND mask) for every size below 256
 * and a PNG for 256. `images` is [{ size, png }]; entries are written smallest first.
 */
export function buildIco(images) {
  if (!Array.isArray(images) || images.length === 0) throw new Error("buildIco needs at least one image");
  const sorted = [...images].sort((a, b) => a.size - b.size);
  for (const { size, png } of sorted) {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new Error(`ICO entries hold 1..256 px, got ${size}`);
    assertSquarePng(png, size, `ico ${size}`);
  }
  const blobs = sorted.map(({ size, png }) => (size >= ICO_PNG_FROM ? png : dibFromRgba(decodePng(png), size)));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(sorted.length, 4);
  const directory = Buffer.alloc(16 * sorted.length);
  let offset = header.length + directory.length;
  sorted.forEach(({ size }, i) => {
    const at = i * 16;
    directory.writeUInt8(size === 256 ? 0 : size, at); // 0 means 256
    directory.writeUInt8(size === 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2); // palette colours: none
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4); // colour planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(blobs[i].length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += blobs[i].length;
  });
  return Buffer.concat([header, directory, ...blobs]);
}

/** ICNS with PNG entries. `images` is [{ type, png }] with the types and sizes listed in ICNS_TYPES. */
export function buildIcns(images) {
  if (!Array.isArray(images) || images.length === 0) throw new Error("buildIcns needs at least one image");
  const edgeByType = new Map(ICNS_TYPES);
  const order = ICNS_TYPES.map(([type]) => type);
  const sorted = [...images].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const chunks = sorted.map(({ type, png }) => {
    const edge = edgeByType.get(type);
    if (!edge) throw new Error(`unknown ICNS type "${type}"`);
    assertSquarePng(png, edge, `icns ${type}`);
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "ascii");
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, 4, "ascii");
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

/** Which SVG draws a given edge length. */
export function sourceFor(size, smallMax = SMALL_MAX) {
  return size <= smallMax ? SOURCES.small : SOURCES.master;
}

/** Every raster this run makes, as plain data (no rendering), so the plan is testable. */
export function plan(smallMax = SMALL_MAX) {
  const png = PNG_SIZES.map((size) => ({ file: `png/icon-${size}.png`, size, svg: sourceFor(size, smallMax) }));
  const faviconPng = FAVICON_ICO_SIZES.map((size) => ({ size, svg: SOURCES.small }));
  const drawn = REPLACEMENTS.filter((r) => !r.ico && r.file.startsWith("replace/"));
  const replacements = [...new Map(drawn.map((r) => [r.file, r])).values()].map((r) => ({
    file: r.file,
    width: r.width,
    height: r.height,
    svg: r.art === "mark" ? SOURCES.mark : sourceFor(r.width, smallMax),
    fit: r.fit ?? 1,
  }));
  return { png, faviconPng, replacements };
}

// ---------------------------------------------------------------------------------------------------------------------
// PNG source mode: every output from the cut-out app logo (a square RGBA tile with transparent corners). Everything in
// this section is a pure function on RGBA buffers, so it runs (and is tested) under plain node; only rasterising the
// wordmark SVGs for the lockups needs Electron.
// ---------------------------------------------------------------------------------------------------------------------

/** The file looked for in --png-src: the logo tile cut out of its white corners (at least 1024 px, square). */
export const LOGO_SOURCE = "app-logo-cut.png";
/** The master the cut is made from: Rizky's painted logo, 1600 px, no alpha, white corners. */
export const LOGO_MASTER = "app-logo.webp";
/** Where --png-src points when it is not given: the master lives next to the brand it belongs to. */
export const DEFAULT_PNG_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "branding", "agentforge", "source");
export const MARK_SIZES = [24, 32, 48, 64, 128, 256];
// The tile is a superellipse |x/a|^n + |y/a|^n = 1, fitted to the artwork's own edge (n 4.67, a 807 px on the 1600 px
// canvas, so the source image crops the tile by a few px per side). `half` is a as a fraction of the canvas width.
export const TILE_SHAPE = { n: 4.67, half: 807 / 1600 };
export const TILE_PAD = 0.03; // Windows and web icons: the tile nearly full-bleed
export const MAC_TILE = 824 / 1024; // Apple's icon grid: an 824 px tile centred in a 1024 px canvas
export const MAC_SHADOW = { dy: 12 / 1024, sigma: 14 / 1024, opacity: 0.32 }; // soft drop shadow, as fractions of the canvas
// Size-tuned tile for 16 to 32 px: the same tile shape around a tighter crop of the artwork (the face fills the tile,
// the gem and the blue rim stay), as fractions of the source width. `pad` is the margin left inside the canvas.
export const SMALL_CROP = { cx: 0.5, cy: 0.565, side: 0.8, pad: 0.02 };
export const SMALL_SOURCE_SIZE = 256;
export const APPLE_TOUCH_SIZE = 180;
const LOCKUP_WORD_WIDTH = 2048; // the wordmark SVG is rasterised this wide once, then scaled into each layout
export const MARK_CENTRE = 0.5; // the tile's middle, for lining the wordmark up in the horizontal lockup
export const LOCKUP_HORIZONTAL = { width: 1600, height: 400 };
export const LOCKUP_STACKED_SIZES = [1024, 160];

/** Unsharp amount by output size: the tiny sizes need their eye edges pulled back after a big downscale. */
export function sharpenFor(size) {
  if (size <= 16) return 0.6;
  if (size <= 24) return 0.55;
  if (size <= 32) return 0.45;
  if (size <= 48) return 0.3;
  if (size <= 64) return 0.2;
  return 0;
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
  }
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** 8-bit RGBA PNG. Each row picks the cheapest of none, sub and up (by summed magnitude), then zlib level 9. */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) throw new Error("encodePng: the pixel buffer does not match width x height");
  const stride = width * 4;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = rgba.subarray(y * stride, (y + 1) * stride);
    const sub = Buffer.alloc(stride);
    const up = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      sub[i] = (line[i] - (i >= 4 ? line[i - 4] : 0)) & 0xff;
      up[i] = (line[i] - prev[i]) & 0xff;
    }
    const cost = (row) => row.reduce((sum, v) => sum + (v < 128 ? v : 256 - v), 0);
    const picks = [
      [0, line],
      [1, sub],
      [2, up],
    ];
    const [type, best] = picks.reduce((a, b) => (cost(b[1]) < cost(a[1]) ? b : a));
    rows.push(Buffer.from([type]), best);
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Decodes a PNG file's bytes into { rgba, width, height }. */
export function loadPng(png) {
  const { width, height } = readPngSize(png);
  return { rgba: decodePng(png), width, height };
}

function lanczos3(x) {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}
// For every output index: the first source index and its normalised Lanczos-3 weights (window widened when shrinking).
function axisWeights(srcLen, dstLen) {
  const scale = srcLen / dstLen;
  const stretch = Math.max(scale, 1);
  const support = 3 * stretch;
  const taps = [];
  for (let i = 0; i < dstLen; i++) {
    const centre = (i + 0.5) * scale;
    const start = Math.max(0, Math.floor(centre - support + 0.5));
    const end = Math.min(srcLen - 1, Math.floor(centre + support - 0.5));
    const w = new Float32Array(end - start + 1);
    let sum = 0;
    for (let s = start; s <= end; s++) {
      w[s - start] = lanczos3((s + 0.5 - centre) / stretch);
      sum += w[s - start];
    }
    for (let k = 0; k < w.length; k++) w[k] /= sum;
    taps.push({ start, w });
  }
  return taps;
}

/**
 * Lanczos-3 resize of straight-alpha RGBA, done on premultiplied colour (so a soft edge never drags dark fringes in) and
 * returned as a new buffer. `sharpen` is an unsharp amount (0 = off) applied to colour only, never to alpha.
 */
export function resizeRgba(rgba, sw, sh, tw, th, { sharpen = 0 } = {}) {
  if (rgba.length !== sw * sh * 4) throw new Error("resizeRgba: the pixel buffer does not match its size");
  const src = new Float32Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = rgba[i * 4 + 3];
    src[i * 4] = (rgba[i * 4] * a) / 255;
    src[i * 4 + 1] = (rgba[i * 4 + 1] * a) / 255;
    src[i * 4 + 2] = (rgba[i * 4 + 2] * a) / 255;
    src[i * 4 + 3] = a;
  }
  const xs = axisWeights(sw, tw);
  const mid = new Float32Array(tw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < tw; x++) {
      const { start, w } = xs[x];
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < w.length; k++) {
        const at = (y * sw + start + k) * 4;
        r += src[at] * w[k];
        g += src[at + 1] * w[k];
        b += src[at + 2] * w[k];
        a += src[at + 3] * w[k];
      }
      const to = (y * tw + x) * 4;
      mid[to] = r;
      mid[to + 1] = g;
      mid[to + 2] = b;
      mid[to + 3] = a;
    }
  }
  const ys = axisWeights(sh, th);
  const out = new Float32Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const { start, w } = ys[y];
    for (let x = 0; x < tw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < w.length; k++) {
        const at = ((start + k) * tw + x) * 4;
        r += mid[at] * w[k];
        g += mid[at + 1] * w[k];
        b += mid[at + 2] * w[k];
        a += mid[at + 3] * w[k];
      }
      const to = (y * tw + x) * 4;
      out[to] = r;
      out[to + 1] = g;
      out[to + 2] = b;
      out[to + 3] = a;
    }
  }
  const result = Buffer.alloc(tw * th * 4);
  const sharp = sharpen > 0 ? blur3(out, tw, th) : null;
  for (let i = 0; i < tw * th; i++) {
    const raw = out[i * 4 + 3]; // Lanczos rings, so alpha can overshoot 255; colour is divided by the unclamped value
    result[i * 4 + 3] = Math.round(Math.min(255, Math.max(0, raw)));
    if (result[i * 4 + 3] === 0) continue; // a pixel that rounds to transparent carries no colour (no bleed from its neighbours)
    for (let c = 0; c < 3; c++) {
      let v = out[i * 4 + c];
      if (sharp) v += sharpen * (v - sharp[i * 4 + c]);
      v = Math.min(raw, Math.max(0, v)); // premultiplied colour cannot exceed alpha
      result[i * 4 + c] = Math.min(255, Math.round((v * 255) / raw));
    }
  }
  return result;
}
// 3x3 binomial blur of the colour channels (edge-clamped), the low-pass half of the unsharp mask
function blur3(px, w, h) {
  const out = new Float32Array(px.length);
  const k = [1, 2, 1];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = Math.min(h - 1, Math.max(0, y + dy));
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            sum += px[(yy * w + xx) * 4 + c] * k[dy + 1] * k[dx + 1];
          }
        }
        out[(y * w + x) * 4 + c] = sum / 16;
      }
    }
  }
  return out;
}

/** Bounding box of pixels whose alpha exceeds `threshold`, or null for an empty picture. */
export function alphaBounds(rgba, width, height, threshold = 8) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** New transparent (or `fill`-coloured) RGBA image. */
export function blankImage(width, height, fill = [0, 0, 0, 0]) {
  const rgba = Buffer.alloc(width * height * 4);
  if (fill.some((v) => v !== 0)) for (let i = 0; i < width * height; i++) rgba.set(fill, i * 4);
  return { rgba, width, height };
}

/** Returns a new image: `layer` composited over `base` (straight-alpha "over") with its top-left corner at (x, y). */
export function overImage(base, layer, x, y) {
  const rgba = Buffer.from(base.rgba);
  for (let ly = 0; ly < layer.height; ly++) {
    const by = y + ly;
    if (by < 0 || by >= base.height) continue;
    for (let lx = 0; lx < layer.width; lx++) {
      const bx = x + lx;
      if (bx < 0 || bx >= base.width) continue;
      const s = (ly * layer.width + lx) * 4;
      const d = (by * base.width + bx) * 4;
      const sa = layer.rgba[s + 3] / 255;
      const da = rgba[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) continue;
      for (let c = 0; c < 3; c++) {
        rgba[d + c] = Math.round((layer.rgba[s + c] * sa + rgba[d + c] * da * (1 - sa)) / oa);
      }
      rgba[d + 3] = Math.round(oa * 255);
    }
  }
  return { rgba, width: base.width, height: base.height };
}

function crop(img, rect) {
  const rgba = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    img.rgba.copy(
      rgba,
      y * rect.width * 4,
      ((rect.y + y) * img.width + rect.x) * 4,
      ((rect.y + y) * img.width + rect.x + rect.width) * 4,
    );
  }
  return { rgba, width: rect.width, height: rect.height };
}
function scaleImage(img, width, height, sharpen = 0) {
  if (img.width === width && img.height === height && sharpen === 0) return img;
  return { rgba: resizeRgba(img.rgba, img.width, img.height, width, height, { sharpen }), width, height };
}
/** The picture trimmed to its visible pixels. */
export function trimImage(img) {
  const b = alphaBounds(img.rgba, img.width, img.height);
  return b ? crop(img, b) : img;
}
function centred(canvasSize, art) {
  return overImage(
    blankImage(canvasSize, canvasSize),
    art,
    Math.floor((canvasSize - art.width) / 2),
    Math.floor((canvasSize - art.height) / 2),
  );
}

/** Antialiased coverage (0..1, row-major) of the tile shape reaching `half` px from the centre of a `size` px canvas. */
export function tileMask(size, half, n = TILE_SHAPE.n) {
  const mask = new Float32Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const ux = Math.abs(i + 0.5 - size / 2) / half;
      const uy = Math.abs(j + 0.5 - size / 2) / half;
      const f = ux ** n + uy ** n;
      const g = Math.hypot((n * ux ** (n - 1)) / half, (n * uy ** (n - 1)) / half) || 1e-9;
      mask[j * size + i] = Math.min(1, Math.max(0, 0.5 - (f - 1) / g)); // (f - 1) / |grad f| is the distance to the edge in px
    }
  }
  return mask;
}

/** Mean colour of the opaque pixels that touch a transparent or soft one: the tile's rim colour. */
export function edgeColour(img) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const alphaAt = (x, y) =>
    x < 0 || y < 0 || x >= img.width || y >= img.height ? 255 : img.rgba[(y * img.width + x) * 4 + 3];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const o = (y * img.width + x) * 4;
      if (img.rgba[o + 3] !== 255) continue;
      if (
        alphaAt(x - 1, y) === 255 &&
        alphaAt(x + 1, y) === 255 &&
        alphaAt(x, y - 1) === 255 &&
        alphaAt(x, y + 1) === 255
      )
        continue;
      r += img.rgba[o];
      g += img.rgba[o + 1];
      b += img.rgba[o + 2];
      count++;
    }
  }
  if (count === 0) throw new Error("edgeColour: the picture has no opaque edge");
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count), 255];
}

// three box-blur passes over a Float32 plane approximate a Gaussian
function blurPlane(values, w, h, radius) {
  let src = values;
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
        tmp[y * w + x] = sum / (2 * radius + 1);
      }
    }
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        out[y * w + x] = sum / (2 * radius + 1);
      }
    }
    src = out;
  }
  return src;
}

/** `img` over a soft black shadow of its own alpha, moved down `dy` px, blurred by `sigma` px, at `opacity`. */
export function dropShadow(img, { dy, sigma, opacity }) {
  const plane = new Float32Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const from = y - dy;
      plane[y * img.width + x] = from < 0 || from >= img.height ? 0 : img.rgba[(from * img.width + x) * 4 + 3] / 255;
    }
  }
  const blurred = blurPlane(plane, img.width, img.height, Math.max(1, Math.round(sigma)));
  const shadow = blankImage(img.width, img.height);
  for (let i = 0; i < blurred.length; i++) shadow.rgba[i * 4 + 3] = Math.round(Math.min(1, blurred[i] * opacity) * 255);
  return overImage(shadow, img, 0, 0);
}

/** A square window of `img` (centre and side as fractions of its width), pixels past the edge repeating the edge. */
function cropWindow(img, { cx, cy, side }) {
  const w = Math.round(side * img.width);
  const x0 = Math.round(cx * img.width - w / 2);
  const y0 = Math.round(cy * img.height - w / 2);
  const rgba = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) {
    const sy = Math.min(img.height - 1, Math.max(0, y0 + y));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, x0 + x));
      img.rgba.copy(rgba, (y * w + x) * 4, (sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4);
    }
  }
  return { rgba, width: w, height: w };
}

/**
 * The four masters every output comes from, derived from the cut-out logo:
 * `tile` (1024 canvas, tile nearly full-bleed: Windows, web), `small` (size-tuned crop, same tile shape, for 16 to 32 px),
 * `mac` (Apple grid: 824 px tile in a 1024 canvas with a soft shadow) and `full` (the cut logo itself, edge to edge).
 */
export function deriveLogoSources(cut) {
  if (!cut || cut.width !== cut.height || cut.width < 1024)
    throw new Error("the cut logo must be square and at least 1024 px");
  const inner = Math.round(1024 * (1 - 2 * TILE_PAD));
  const tile = centred(1024, scaleImage(cut, inner, inner));

  const s = SMALL_SOURCE_SIZE;
  const small = scaleImage(cropWindow(cut, SMALL_CROP), s, s);
  const mask = tileMask(s, (s / 2) * (1 - 2 * SMALL_CROP.pad));
  const tuned = Buffer.from(small.rgba);
  for (let i = 0; i < s * s; i++) {
    const a = Math.round(mask[i] * tuned[i * 4 + 3]);
    tuned[i * 4 + 3] = a;
    if (a === 0) tuned.fill(0, i * 4, i * 4 + 3);
  }

  const macInner = Math.round(1024 * MAC_TILE);
  const mac = dropShadow(centred(1024, scaleImage(cut, macInner, macInner)), {
    dy: Math.round(1024 * MAC_SHADOW.dy),
    sigma: 1024 * MAC_SHADOW.sigma,
    opacity: MAC_SHADOW.opacity,
  });
  return { tile, small: { rgba: tuned, width: s, height: s }, mac, full: cut };
}

/**
 * Every raster and container that needs no rendering, from the cut-out logo and `overrides` (Map size -> exact-size image
 * that wins over resizing). Returns Map(relative path -> Buffer).
 */
export function buildIconSet({ cut, overrides = new Map() }) {
  const { tile, small, mac, full } = deriveLogoSources(cut);
  const files = new Map();
  const png = (img) => encodePng(img.rgba, img.width, img.height);

  const ladder = new Map();
  for (const size of PNG_SIZES) {
    const exact = overrides.get(size);
    if (exact) {
      if (exact.width !== size || exact.height !== size)
        throw new Error(`icon-${size}.png override must be ${size}x${size}`);
      ladder.set(size, exact);
    } else {
      ladder.set(size, scaleImage(size <= SMALL_MAX ? small : tile, size, size, sharpenFor(size)));
    }
    files.set(`png/icon-${size}.png`, png(ladder.get(size)));
  }
  const pngOf = (size) => files.get(`png/icon-${size}.png`);
  files.set("icon.ico", buildIco(ICO_SIZES.map((size) => ({ size, png: pngOf(size) }))));
  files.set("favicon.ico", buildIco(FAVICON_ICO_SIZES.map((size) => ({ size, png: pngOf(size) }))));
  files.set("favicon-32.png", pngOf(32));

  // macOS: the Dock and Launchpad sizes (128 and up) are the Apple-grid master with its shadow; the Finder-list sizes
  // (16, 32, 64) are the Windows ladder, because an 824/1024 tile with a shadow would leave a 16 px icon 12 px wide
  files.set("mac/icon-mac-1024.png", png(mac));
  files.set(
    "icon.icns",
    buildIcns(
      ICNS_TYPES.map(([type, size]) => ({ type, png: size >= 128 ? png(scaleImage(mac, size, size)) : pngOf(size) })),
    ),
  );

  // iOS paints transparency black and rounds the corners itself: a full-bleed square in the tile's rim colour
  const ground = blankImage(APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE, edgeColour(full));
  files.set(
    `favicon-${APPLE_TOUCH_SIZE}.png`,
    png(overImage(ground, scaleImage(full, APPLE_TOUCH_SIZE, APPLE_TOUCH_SIZE, 0.15), 0, 0)),
  );

  // the rail mark is the logo tile itself, edge to edge with transparent corners; the tuned crop below 33 px
  for (const size of MARK_SIZES) {
    files.set(`mark/mark-${size}.png`, png(scaleImage(size <= SMALL_MAX ? small : full, size, size, sharpenFor(size))));
  }

  for (const r of REPLACEMENTS.filter((entry) => !entry.ico)) {
    if (files.has(r.file)) continue;
    if (r.art === "mark") {
      const inner = Math.round(r.width * r.fit);
      files.set(r.file, png(centred(r.width, scaleImage(full, inner, inner))));
    } else {
      files.set(r.file, png(scaleImage(full, r.width, r.height, r.width <= 160 ? 0.15 : 0)));
    }
  }
  return files;
}

/** Where the head and the wordmark go on a square stacked lockup. Sizes are of the trimmed pictures. */
export function stackedLayout(size, head, word) {
  const wordW = Math.round(size * 0.76);
  const wordH = Math.round((wordW * word.height) / word.width);
  const headH = Math.round(size * 0.46);
  const headW = Math.round((headH * head.width) / head.height);
  const gap = Math.round(size * 0.055);
  const top = Math.round((size - (headH + gap + wordH)) / 2);
  return {
    width: size,
    height: size,
    head: { x: Math.round((size - headW) / 2), y: top, width: headW, height: headH },
    word: { x: Math.round((size - wordW) / 2), y: top + headH + gap, width: wordW, height: wordH },
  };
}
/** Head left, wordmark right, the wordmark's middle level with the helmet's middle. Shrinks to fit the canvas margins. */
export function horizontalLayout(width, height, head, word) {
  const margin = height * 0.1;
  let headH = height - 2 * margin;
  const ratio = (h) => ({
    headW: (h * head.width) / head.height,
    gap: h * 0.14,
    wordH: h * 0.42,
    wordW: (h * 0.42 * word.width) / word.height,
  });
  let m = ratio(headH);
  const room = width - 2 * margin;
  const used = m.headW + m.gap + m.wordW;
  if (used > room) {
    headH *= room / used;
    m = ratio(headH);
  }
  const total = m.headW + m.gap + m.wordW;
  const x0 = (width - total) / 2;
  const y0 = (height - headH) / 2;
  const yMid = y0 + MARK_CENTRE * headH;
  const r = Math.round;
  return {
    width,
    height,
    head: { x: r(x0), y: r(y0), width: r(m.headW), height: r(headH) },
    word: { x: r(x0 + m.headW + m.gap), y: r(yMid - m.wordH / 2), width: r(m.wordW), height: r(m.wordH) },
  };
}
function composeLockup(layout, head, word) {
  const { head: h, word: w } = layout;
  const base = overImage(blankImage(layout.width, layout.height), scaleImage(head, h.width, h.height), h.x, h.y);
  return overImage(base, scaleImage(word, w.width, w.height), w.x, w.y);
}

/**
 * Lockup PNGs: `head` is the rendered head, `wordInk` / `wordLight` the rasterised wordmarks (dark ink for light
 * backgrounds, white for dark ones). Returns Map(relative path -> Buffer).
 */
export function buildLockups({ head, wordInk, wordLight }) {
  const files = new Map();
  const headT = trimImage(head);
  for (const [name, wordSrc] of [
    ["ink", wordInk],
    ["light", wordLight],
  ]) {
    const word = trimImage(wordSrc);
    for (const size of LOCKUP_STACKED_SIZES) {
      const img = composeLockup(stackedLayout(size, headT, word), headT, word);
      files.set(`lockup/lockup-stacked-${name}-${size}.png`, encodePng(img.rgba, size, size));
    }
    const { width, height } = LOCKUP_HORIZONTAL;
    const wide = composeLockup(horizontalLayout(width, height, headT, word), headT, word);
    files.set(`lockup/lockup-horizontal-${name}-${width}x${height}.png`, encodePng(wide.rgba, width, height));
  }
  return files;
}

/** viewBox width and height of an SVG's text. */
export function svgAspect(text) {
  const m = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(text);
  if (!m) throw new Error("the SVG has no viewBox");
  return { width: Number(m[1]), height: Number(m[2]) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------------

const USAGE = [
  "usage: brand-icons.mjs --out <dir> [--png-src <dir with app-logo.webp or app-logo-cut.png [icon-<n>.png]>]",
  "                       [--src <dir with wordmark.svg wordmark-light.svg>, for the lockups] [--repo <dir>]",
  "         (--png-src defaults to apps/desktop/branding/agentforge/source)",
  "                       [--check] exit 1 when a file the repo has differs from the kit's;  [--apply] write the kit's files over the repo's",
  "       brand-icons.mjs --src <dir with icon-master.svg icon-small.svg mark.svg> --out <dir> [--small-max <px>] [--repo <dir>]",
  "         (SVG mode: --src without --png-src)",
].join("\n");

export function parseArgs(argv) {
  const opts = { src: "", pngSrc: "", out: "", smallMax: SMALL_MAX, repo: "", apply: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (flag === "--apply" || flag === "--check") {
      opts[flag.slice(2)] = true;
      continue;
    }
    if (!["--src", "--png-src", "--out", "--small-max", "--repo"].includes(flag))
      throw new Error(`unknown argument "${flag}"\n${USAGE}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value\n${USAGE}`);
    i++;
    if (flag === "--src") opts.src = resolve(value);
    else if (flag === "--png-src") opts.pngSrc = resolve(value);
    else if (flag === "--out") opts.out = resolve(value);
    else if (flag === "--repo") opts.repo = resolve(value);
    else opts.smallMax = Number(value);
  }
  if (!opts.out) throw new Error(`--out is required\n${USAGE}`);
  if (!opts.src && !opts.pngSrc) opts.pngSrc = DEFAULT_PNG_SRC;
  if (!Number.isInteger(opts.smallMax) || opts.smallMax < 0)
    throw new Error("--small-max must be a whole number of px");
  return opts;
}

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "..");
const repoRootDefault = join(desktopRoot, "..", "..");

function electronBinary() {
  try {
    return createRequire(join(desktopRoot, "package.json"))("electron"); // the electron package exports the exe path
  } catch (err) {
    throw new Error(`Electron is not installed under apps/desktop/node_modules (${err.message}). Run pnpm install.`);
  }
}

function runUnderElectron(args) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // an IDE-launched shell may set it, and Electron would then start as plain node
  return new Promise((resolveRun, reject) => {
    const child = spawn(electronBinary(), [fileURLToPath(import.meta.url), ...args], { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Electron side: rasterise
// ---------------------------------------------------------------------------------------------------------------------

// A window cannot be taller than the desktop's work area, so capturePage cannot return a 1024 px capture on a 1080p
// screen (it comes back 1020 px tall). The DevTools protocol screenshot has no such limit: metrics are overridden to the
// exact output size at scale 1 (also immune to a 125%/150% Windows display scale) and the background is made transparent.
async function openRasteriser(electron) {
  const { app, BrowserWindow } = electron;
  app.disableHardwareAcceleration();
  await app.whenReady();
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await win.loadURL("data:text/html;charset=utf-8,<!doctype html><body style='margin:0;background:transparent'>");
  const dbg = win.webContents.debugger;
  dbg.attach("1.3");
  await dbg.sendCommand("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const cache = new Map();

  /**
   * Renders `svgPath` into a `width` x `height` transparent PNG. With the default fit of 1 the art fills the canvas exactly
   * (so give a non-square canvas the SVG's own aspect); with a smaller fit a square of that fraction is centred in it.
   */
  async function render(svgPath, width, height, fit = 1) {
    if (!cache.has(svgPath)) {
      cache.set(svgPath, `data:image/svg+xml;base64,${readFileSync(svgPath).toString("base64")}`);
    }
    const boxW = fit === 1 ? width : Math.round(Math.min(width, height) * fit);
    const boxH = fit === 1 ? height : boxW;
    const left = Math.round((width - boxW) / 2);
    const top = Math.round((height - boxH) / 2);
    await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await win.webContents.executeJavaScript(`(async () => {
      document.body.replaceChildren();
      const img = new Image();
      img.style.cssText = "position:absolute;left:${left}px;top:${top}px;width:${boxW}px;height:${boxH}px;display:block";
      img.src = ${JSON.stringify(cache.get(svgPath))};
      document.body.append(img);
      await img.decode();
      await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 300); });
    })()`);
    const { data } = await dbg.sendCommand("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    const png = Buffer.from(data, "base64");
    const got = readPngSize(png);
    if (got.width !== width || got.height !== height) {
      throw new Error(`capture of ${svgPath} came back ${got.width}x${got.height}, wanted ${width}x${height}`);
    }
    return png;
  }

  /** Decodes an image file (PNG, WebP, JPEG) with Chromium into straight RGBA bytes: { rgba, width, height }. */
  async function decode(bytes, mime) {
    const json = await win.webContents.executeJavaScript(`(async (b64, mime) => {
      const src = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([src], { type: mime }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
      ctx.drawImage(bmp, 0, 0);
      const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let bin = "";
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return JSON.stringify({ width: bmp.width, height: bmp.height, base64: btoa(bin) });
    })(${JSON.stringify(Buffer.from(bytes).toString("base64"))}, ${JSON.stringify(mime)})`);
    const { width, height, base64 } = JSON.parse(json);
    return { rgba: Buffer.from(base64, "base64"), width, height };
  }

  return { render, decode, close: () => win.destroy() };
}

function write(out, rel, data) {
  const target = join(out, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  console.log(`  ${rel}  ${data.length} bytes`);
}

// A replacement PNG must have the pixel size of the file it replaces, or the layouts that show it shift. Exit code 1
// (after everything is written) says a swap would do that.
function checkRepoSizes(repoRoot) {
  const drift = [];
  for (const r of REPLACEMENTS) {
    const abs = join(repoRoot, r.repo);
    if (!existsSync(abs) || r.ico) continue;
    try {
      const { width, height } = readPngSize(readFileSync(abs));
      if (width !== r.width || height !== r.height)
        drift.push(`${r.repo} is ${width}x${height}, replacement is ${r.width}x${r.height}`);
    } catch (err) {
      drift.push(`${r.repo}: ${err.message}`);
    }
  }
  if (drift.length === 0) {
    console.log(`repo check: every replaced PNG in ${repoRoot} has the size of its replacement`);
    return 0;
  }
  console.warn(`repo check: ${drift.length} size mismatch(es), a swap would shift layout:\n  ${drift.join("\n  ")}`);
  return 1;
}

/**
 * Compares every kit file that maps onto a repo path (REPLACEMENTS) with the file the repo has and, with `apply`, copies the
 * ones that differ or are missing over it. Returns how many differed. `optional` files are never created.
 */
export function syncRepoFiles(out, repoRoot, { apply }) {
  let identical = 0;
  let differing = 0;
  for (const r of REPLACEMENTS) {
    const from = join(out, r.file);
    const to = join(repoRoot, r.repo);
    const have = existsSync(to);
    if (!existsSync(from) || (!have && r.optional)) continue;
    if (have && readFileSync(from).equals(readFileSync(to))) {
      identical++;
      continue;
    }
    differing++;
    console.log(`  ${have ? "differs" : "missing"}: ${r.repo}  (kit file ${r.file})${apply ? "  -> written" : ""}`);
    if (apply) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
  }
  console.log(
    `repo files in ${repoRoot}: ${identical} identical, ${differing} ${apply ? "written" : "differ"} (of ${identical + differing})`,
  );
  return differing;
}

async function generate(opts) {
  for (const name of Object.values(SOURCES)) {
    if (!existsSync(join(opts.src, name))) throw new Error(`missing ${name} in --src ${opts.src}`);
  }
  const electron = (await import("electron")).default;
  const raster = await openRasteriser(electron);
  const at = (svg) => join(opts.src, svg);
  const jobs = plan(opts.smallMax);
  const pngs = new Map();
  try {
    console.log(`png ladder (icon-small.svg up to ${opts.smallMax} px, icon-master.svg above):`);
    for (const job of jobs.png) {
      const data = await raster.render(at(job.svg), job.size, job.size);
      pngs.set(job.size, data);
      write(opts.out, job.file, data);
    }

    console.log("icon.ico / icon.icns:");
    write(opts.out, "icon.ico", buildIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) }))));
    write(opts.out, "icon.icns", buildIcns(ICNS_TYPES.map(([type, size]) => ({ type, png: pngs.get(size) }))));

    console.log("favicon.svg / favicon.ico:");
    copyFileSync(at(SOURCES.small), join(opts.out, FAVICON_SVG));
    console.log(`  ${FAVICON_SVG}  copy of ${SOURCES.small}`);
    const favicons = [];
    for (const job of jobs.faviconPng)
      favicons.push({ size: job.size, png: await raster.render(at(job.svg), job.size, job.size) });
    write(opts.out, "favicon.ico", buildIco(favicons));

    console.log("replacements for the repo's logo and mark PNGs (same pixel size as the files they replace):");
    for (const job of jobs.replacements) {
      write(opts.out, job.file, await raster.render(at(job.svg), job.width, job.height, job.fit));
    }
  } finally {
    raster.close();
  }

  const map = Object.fromEntries(REPLACEMENTS.map((r) => [r.repo, r.file]));
  write(opts.out, "replacements.json", Buffer.from(`${JSON.stringify(map, null, 2)}\n`));
  return checkRepoSizes(opts.repo || repoRootDefault);
}

function readSource(dir, name, { required = false } = {}) {
  const file = join(dir, name);
  if (!existsSync(file)) {
    if (required) throw new Error(`missing ${name} in --png-src ${dir}`);
    return null;
  }
  return loadPng(readFileSync(file));
}

/** True when the cut has to be made from the master, which takes Chromium to decode the WebP. */
export function needsMasterCut(pngSrc) {
  return !existsSync(join(pngSrc, LOGO_SOURCE)) && existsSync(join(pngSrc, LOGO_MASTER));
}

/** The cut logo: the file in --png-src when there is one, else the master decoded and cut (and written to <out>/source). */
async function loadCut(opts) {
  if (!needsMasterCut(opts.pngSrc)) return readSource(opts.pngSrc, LOGO_SOURCE, { required: true });
  const raster = await openRasteriser((await import("electron")).default);
  try {
    const master = await raster.decode(readFileSync(join(opts.pngSrc, LOGO_MASTER)), "image/webp");
    if (master.width !== CUT_SOURCE_SIZE || master.height !== CUT_SOURCE_SIZE) {
      throw new Error(`${LOGO_MASTER} is ${master.width}x${master.height}, the cut is fitted to ${CUT_SOURCE_SIZE} px`);
    }
    console.log(`master: ${LOGO_MASTER} decoded (${master.width}px), cut out of its white corners`);
    const rgba = cutLogoTile(master.rgba, master.width, master.height);
    write(opts.out, `source/${LOGO_SOURCE}`, encodePng(rgba, master.width, master.height));
    return { rgba, width: master.width, height: master.height };
  } finally {
    raster.close();
  }
}

/** PNG mode: the ladder, containers, favicons, marks and replacements from the cut logo; lockups too when --src has the wordmarks. */
async function generatePng(opts) {
  const cut = await loadCut(opts);
  const overrides = new Map();
  for (const size of PNG_SIZES) {
    const exact = readSource(opts.pngSrc, `icon-${size}.png`);
    if (exact) overrides.set(size, exact);
  }
  console.log(
    `source: ${LOGO_SOURCE} ${cut.width}px (16 to ${SMALL_MAX} px from a tighter crop of it)${
      overrides.size ? `, exact-size overrides for ${[...overrides.keys()].join(", ")}` : ""
    }`,
  );
  for (const [rel, data] of buildIconSet({ cut, overrides })) write(opts.out, rel, data);

  const map = Object.fromEntries(REPLACEMENTS.map((r) => [r.repo, r.file]));
  write(opts.out, "replacements.json", Buffer.from(`${JSON.stringify(map, null, 2)}\n`));

  if (opts.src) {
    console.log("lockups (wordmark SVGs rasterised in Electron, composited with the logo tile):");
    const raster = await openRasteriser((await import("electron")).default);
    const words = {};
    try {
      for (const [key, name] of [
        ["wordInk", "wordmark.svg"],
        ["wordLight", "wordmark-light.svg"],
      ]) {
        const svg = join(opts.src, name);
        if (!existsSync(svg)) throw new Error(`missing ${name} in --src ${opts.src}`);
        const { width, height } = svgAspect(readFileSync(svg, "utf8"));
        const h = Math.round((LOCKUP_WORD_WIDTH * height) / width);
        words[key] = loadPng(await raster.render(svg, LOCKUP_WORD_WIDTH, h));
      }
    } finally {
      raster.close();
    }
    for (const [rel, data] of buildLockups({ head: cut, ...words })) write(opts.out, rel, data);
    // the same repo paths as replacements.json, pointing at the lockup that fits: light wordmark for the dark splash page,
    // dark ink elsewhere. Same pixel sizes as the tile-only files they stand in for.
    const alt = {};
    for (const r of REPLACEMENTS.filter(
      (entry) => entry.art === "icon" && LOCKUP_STACKED_SIZES.includes(entry.width),
    )) {
      const dark = r.repo.endsWith("splash/logo.png");
      alt[r.repo] = `lockup/lockup-stacked-${dark ? "light" : "ink"}-${r.width}.png`;
    }
    write(opts.out, "replacements-lockup.json", Buffer.from(`${JSON.stringify(alt, null, 2)}\n`));
  }
  const repoRoot = opts.repo || repoRootDefault;
  const drift = checkRepoSizes(repoRoot);
  const differing = syncRepoFiles(opts.out, repoRoot, { apply: opts.apply });
  return drift || (opts.check && differing > 0 ? 1 : 0);
}

async function main() {
  const args = process.argv.slice(2);
  let opts;
  try {
    opts = parseArgs(args);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  // SVG mode always needs Electron; PNG mode only when it has wordmark SVGs to rasterise for the lockups or a master to decode.
  const needsElectron = !opts.pngSrc || Boolean(opts.src) || needsMasterCut(opts.pngSrc);
  if (!process.versions.electron && needsElectron) {
    process.exit(await runUnderElectron(args));
  }
  const run = opts.pngSrc ? generatePng : generate;
  if (!process.versions.electron) {
    try {
      const code = await run(opts);
      console.log("brand-icons: done");
      process.exit(code);
    } catch (err) {
      console.error(`brand-icons: ${err.stack ?? err}`);
      process.exit(1);
    }
  }
  const { app } = (await import("electron")).default; // ESM entry: Electron exposes its API on the default export
  try {
    const code = await run(opts);
    console.log("brand-icons: done");
    app.exit(code);
  } catch (err) {
    console.error(`brand-icons: ${err.stack ?? err}`);
    app.exit(1);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  // Not awaited: Electron waits for an ESM entry module to finish evaluating before it emits "ready", so a top-level
  // await on the whole run would deadlock on app.whenReady().
  main().catch((err) => {
    console.error(`brand-icons: ${err.stack ?? err}`);
    process.exit(1);
  });
}

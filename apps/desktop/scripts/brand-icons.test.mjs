import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import {
  DEFAULT_PNG_SRC,
  LOGO_MASTER,
  LOGO_SOURCE,
  needsMasterCut,
  APPLE_TOUCH_SIZE,
  FAVICON_ICO_SIZES,
  ICNS_TYPES,
  ICO_PNG_FROM,
  ICO_SIZES,
  LOCKUP_HORIZONTAL,
  LOCKUP_STACKED_SIZES,
  MAC_TILE,
  MARK_CENTRE,
  MARK_SIZES,
  PNG_SIZES,
  REPLACEMENTS,
  SMALL_MAX,
  SOURCES,
  TILE_PAD,
  TILE_SHAPE,
  alphaBounds,
  blankImage,
  buildIcns,
  buildIco,
  buildIconSet,
  buildLockups,
  deriveLogoSources,
  decodePng,
  dropShadow,
  edgeColour,
  encodePng,
  horizontalLayout,
  loadPng,
  overImage,
  parseArgs,
  syncRepoFiles,
  plan,
  readPngSize,
  resizeRgba,
  sharpenFor,
  sourceFor,
  stackedLayout,
  svgAspect,
  tileMask,
  trimImage,
} from "./brand-icons.mjs";

// ---------- a tiny PNG encoder, so the tests need no image files ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
/** A solid RGBA PNG of `size` x `size` px (8-bit, colour type 6). */
function solidPng(size, [r, g, b, a] = [38, 136, 200, 255]) {
  const row = Buffer.alloc(1 + size * 4);
  for (let x = 0; x < size; x++) row.set([r, g, b, a], 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A picture with the properties the ICO checks need: transparent corners, an opaque red top half and blue bottom half
// inside a disc (so a flipped row order shows), and a half-transparent rim (so premultiplication or lost alpha shows).
const RED = [200, 40, 40];
const BLUE = [30, 60, 210];
function pixelAt(size, x, y) {
  const centre = (size - 1) / 2;
  const d = Math.hypot(x - centre, y - centre) / size;
  if (d > 0.45) return [0, 0, 0, 0];
  const [r, g, b] = y < size / 2 ? RED : BLUE;
  return [r, g, b, d > 0.4 ? 128 : 255];
}
// Filter types cycle none, sub, up, average, paeth row by row, so the decoder's whole unfilter path runs.
function filterRow(type, line, prev, bpp) {
  const out = Buffer.alloc(line.length);
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let predict = 0;
    if (type === 1) predict = a;
    else if (type === 2) predict = b;
    else if (type === 3) predict = (a + b) >> 1;
    else if (type === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      predict = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i] = (line[i] - predict) & 0xff;
  }
  return out;
}
/** `size` x `size` PNG of pixelAt(), 8-bit colour type 6 (or 2 when `alpha` is false), one filter type per row. */
function patternPng(size, { alpha = true } = {}) {
  const bpp = alpha ? 4 : 3;
  const rows = [];
  let prev = Buffer.alloc(size * bpp);
  for (let y = 0; y < size; y++) {
    const line = Buffer.alloc(size * bpp);
    for (let x = 0; x < size; x++) line.set(pixelAt(size, x, y).slice(0, bpp), x * bpp);
    const type = y % 5;
    rows.push(Buffer.concat([Buffer.from([type]), filterRow(type, line, prev, bpp)]));
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- PNG decoder (the ICO writer depends on it) ----------

test("decodePng: every filter type, RGBA and RGB, odd sizes", () => {
  for (const size of [16, 33]) {
    const rgba = decodePng(patternPng(size));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        assert.deepEqual(
          [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)],
          pixelAt(size, x, y),
          `${size}px (${x},${y})`,
        );
      }
    }
  }
  const rgb = decodePng(patternPng(16, { alpha: false }));
  assert.deepEqual([...rgb.subarray(0, 4)], [0, 0, 0, 255], "RGB PNGs come back opaque");
});

test("decodePng: refuses formats the rasteriser never writes", () => {
  const sixteenBit = Buffer.from(patternPng(16));
  sixteenBit[24] = 16; // IHDR bit depth
  assert.throws(() => decodePng(sixteenBit), /unsupported PNG \(bit depth 16/);
  const interlaced = Buffer.from(patternPng(16));
  interlaced[28] = 1; // IHDR interlace
  assert.throws(() => decodePng(interlaced), /interlace 1/);
  assert.throws(() => decodePng(Buffer.from("nope")), /not a PNG/);
});

// ---------- ICO ----------

/** Independent reader for the ICO layout the writer must produce. */
function parseIco(ico) {
  assert.equal(ico.readUInt16LE(0), 0, "reserved");
  assert.equal(ico.readUInt16LE(2), 1, "type 1 = icon");
  const count = ico.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16;
    const size = ico.readUInt8(at) || 256;
    assert.equal(ico.readUInt8(at + 1) || 256, size, `entry ${i} is square`);
    assert.equal(ico.readUInt8(at + 2), 0, "no palette");
    assert.equal(ico.readUInt16LE(at + 4), 1, "planes");
    assert.equal(ico.readUInt16LE(at + 6), 32, "bits per pixel");
    const bytes = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    const blob = ico.subarray(offset, offset + bytes);
    const isPng = blob.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    entries.push({
      size,
      bytes,
      offset,
      blob,
      encoding: isPng ? "png" : blob.readUInt32LE(0) === 40 ? "dib" : "unknown",
    });
  }
  return entries;
}
/** [r, g, b, a] of top-down pixel (x, y) in a DIB entry, plus its AND-mask bit; rows are stored bottom-up. */
function dibPixel({ blob, size }, x, y) {
  const row = size - 1 - y;
  const at = 40 + (row * size + x) * 4;
  const maskRow = Math.ceil(size / 32) * 4;
  const maskByte = blob[40 + size * size * 4 + row * maskRow + (x >> 3)];
  return { rgba: [blob[at + 2], blob[at + 1], blob[at], blob[at + 3]], masked: Boolean(maskByte & (0x80 >> (x & 7))) };
}

test("ICO: DIB below 256, PNG at 256, exact sizes, headers, offsets and lengths", () => {
  assert.deepEqual(ICO_SIZES, [16, 24, 32, 48, 64, 128, 256]);
  assert.equal(ICO_PNG_FROM, 256);
  const pngs = ICO_SIZES.map((size) => patternPng(size));
  // hand the entries over out of order: the writer sorts smallest first
  const ico = buildIco(ICO_SIZES.map((size, i) => ({ size, png: pngs[i] })).reverse());
  const entries = parseIco(ico);

  assert.deepEqual(
    entries.map((e) => e.size),
    ICO_SIZES,
  );
  assert.deepEqual(
    entries.map((e) => e.encoding),
    ["dib", "dib", "dib", "dib", "dib", "dib", "png"],
  );
  let expectedOffset = 6 + 16 * entries.length;
  entries.forEach((entry, i) => {
    const { size, blob } = entry;
    assert.equal(entry.offset, expectedOffset, `${size}: offset`);
    expectedOffset += entry.bytes;
    if (entry.encoding === "png") {
      assert.ok(blob.equals(pngs[i]), `${size}: the 256 entry is the PNG unchanged`);
      assert.deepEqual(readPngSize(blob), { width: 256, height: 256 });
      return;
    }
    // BITMAPINFOHEADER
    assert.equal(blob.readUInt32LE(0), 40, `${size}: biSize`);
    assert.equal(blob.readInt32LE(4), size, `${size}: biWidth`);
    assert.equal(blob.readInt32LE(8), size * 2, `${size}: biHeight is doubled (XOR bitmap + AND mask)`);
    assert.equal(blob.readUInt16LE(12), 1, `${size}: biPlanes`);
    assert.equal(blob.readUInt16LE(14), 32, `${size}: biBitCount`);
    assert.equal(blob.readUInt32LE(16), 0, `${size}: BI_RGB`);
    const maskBytes = Math.ceil(size / 32) * 4 * size;
    assert.equal(entry.bytes, 40 + size * size * 4 + maskBytes, `${size}: header + BGRA rows + 1-bit AND mask`);
  });
  assert.equal(ico.length, expectedOffset, "no trailing bytes");
});

test("ICO: DIB pixels are right way up, straight alpha, and the AND mask marks the transparent ones", () => {
  for (const size of [16, 24, 48, 128]) {
    const png = patternPng(size);
    const entry = parseIco(buildIco([{ size, png }]))[0];
    assert.equal(entry.encoding, "dib");
    const decoded = decodePng(png);

    // a known transparent corner
    const corner = dibPixel(entry, 0, 0);
    assert.equal(corner.rgba[3], 0, `${size}: corner alpha is 0`);
    assert.ok(corner.masked, `${size}: corner is set in the AND mask`);
    assert.equal(dibPixel(entry, size - 1, size - 1).rgba[3], 0, `${size}: opposite corner alpha is 0`);

    // known opaque pixels, one in each half: they match the colours the picture was built with and the PNG's own pixels
    const top = dibPixel(entry, size >> 1, size >> 2);
    const bottom = dibPixel(entry, size >> 1, (3 * size) >> 2);
    assert.deepEqual(top.rgba, [...RED, 255], `${size}: top-centre pixel is opaque red (rows are not flipped)`);
    assert.deepEqual(bottom.rgba, [...BLUE, 255], `${size}: bottom-centre pixel is opaque blue`);
    assert.ok(!top.masked && !bottom.masked, `${size}: opaque pixels are clear in the AND mask`);
    for (const [x, y] of [
      [size >> 1, size >> 2],
      [size >> 1, (3 * size) >> 2],
    ]) {
      const at = (y * size + x) * 4;
      assert.deepEqual(
        dibPixel(entry, x, y).rgba,
        [...decoded.subarray(at, at + 4)],
        `${size}: (${x},${y}) matches the PNG`,
      );
    }

    // every pixel: BGRA equals the picture (fully transparent ones are zeroed), mask bit is set exactly where alpha is 0
    let rim = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const want = pixelAt(size, x, y);
        const got = dibPixel(entry, x, y);
        assert.deepEqual(got.rgba, want, `${size}: (${x},${y})`);
        assert.equal(got.masked, want[3] === 0, `${size}: mask bit at (${x},${y})`);
        if (want[3] === 128) rim++;
      }
    }
    assert.ok(rim > 0, `${size}: the picture has a half-transparent rim, so straight alpha was exercised`);
  }
});

test("ICO: favicon ladder is 16, 32, 48, all DIB", () => {
  assert.deepEqual(FAVICON_ICO_SIZES, [16, 32, 48]);
  const entries = parseIco(buildIco(FAVICON_ICO_SIZES.map((size) => ({ size, png: patternPng(size) }))));
  assert.deepEqual(
    entries.map((e) => [e.size, e.encoding]),
    [
      [16, "dib"],
      [32, "dib"],
      [48, "dib"],
    ],
  );
});

test("ICO: refuses a PNG whose size differs from the declared one, and sizes ICO cannot hold", () => {
  assert.throws(() => buildIco([{ size: 16, png: solidPng(32) }]), /expected a 16x16 PNG, got 32x32/);
  assert.throws(() => buildIco([{ size: 512, png: solidPng(512) }]), /1\.\.256 px/);
  assert.throws(() => buildIco([{ size: 16, png: Buffer.from("not a png at all, sorry") }]), /not a PNG/);
  assert.throws(() => buildIco([]), /at least one image/);
});

// ---------- ICNS ----------

test("ICNS: PNG entries icp4, icp5, icp6, ic07, ic08, ic09, ic10 at 16..1024 px", () => {
  assert.deepEqual(
    ICNS_TYPES.map(([type]) => type),
    ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10"],
  );
  const edges = ICNS_TYPES.map(([, size]) => size);
  assert.deepEqual(edges, [16, 32, 64, 128, 256, 512, 1024]);

  const pngs = edges.map((size) => solidPng(size, [size % 256, 90, 30, 255]));
  // shuffled input: the writer emits the canonical order
  const icns = buildIcns(ICNS_TYPES.map(([type], i) => ({ type, png: pngs[i] })).reverse());

  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length, "header length is the whole file");
  let at = 8;
  const seen = [];
  for (let i = 0; at < icns.length; i++) {
    const type = icns.toString("ascii", at, at + 4);
    const length = icns.readUInt32BE(at + 4);
    const png = icns.subarray(at + 8, at + length);
    assert.ok(png.equals(pngs[i]), `${type} holds the PNG unchanged`);
    assert.equal(length, 8 + pngs[i].length, `${type} entry length includes its 8 byte header`);
    assert.deepEqual(readPngSize(png), { width: edges[i], height: edges[i] }, `${type} IHDR`);
    seen.push(type);
    at += length;
  }
  assert.equal(at, icns.length, "entries end exactly at end of file");
  assert.deepEqual(seen, ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10"]);
});

test("ICNS: refuses unknown types and wrong sizes", () => {
  assert.throws(() => buildIcns([{ type: "ic99", png: solidPng(16) }]), /unknown ICNS type "ic99"/);
  assert.throws(() => buildIcns([{ type: "ic08", png: solidPng(128) }]), /expected a 256x256 PNG, got 128x128/);
  assert.throws(() => buildIcns([]), /at least one image/);
});

// ---------- PNG reader ----------

test("readPngSize reads IHDR and rejects other data", () => {
  assert.deepEqual(readPngSize(solidPng(24)), { width: 24, height: 24 });
  assert.throws(() => readPngSize(Buffer.alloc(40)), /not a PNG/);
  assert.throws(() => readPngSize("nope"), /not a PNG/);
});

// ---------- plan: which SVG draws which size, and what replaces what ----------

test("plan: the ladder, the small/master split and the replacement files", () => {
  assert.deepEqual(PNG_SIZES, [16, 24, 32, 48, 64, 128, 256, 512, 1024]);
  const p = plan();
  assert.deepEqual(
    p.png.map((j) => j.file),
    PNG_SIZES.map((s) => `png/icon-${s}.png`),
  );
  for (const job of p.png) {
    assert.equal(job.svg, job.size <= SMALL_MAX ? SOURCES.small : SOURCES.master, `icon-${job.size}`);
  }
  assert.equal(sourceFor(SMALL_MAX), SOURCES.small);
  assert.equal(sourceFor(SMALL_MAX + 1), SOURCES.master);
  assert.equal(sourceFor(48, 64), SOURCES.small, "the cut-over can be moved");
  assert.ok(
    p.faviconPng.every((j) => j.svg === SOURCES.small),
    "favicon.ico is drawn from the small variant",
  );

  // every repo path from the brief maps to a file, at the size that path has today
  const byPath = Object.fromEntries(REPLACEMENTS.map((r) => [r.repo, r]));
  const png1024 = [
    "apps/desktop/branding/agentforge/icon.png",
    "apps/desktop/branding/agentforge/mark.png",
    "apps/desktop/build/icon.png",
  ];
  for (const path of png1024) assert.deepEqual([byPath[path].width, byPath[path].height], [1024, 1024], path);
  // the display logo is the tile at 256 px (the packaged preload inlines it as base64 at every launch), kit file mark-256
  for (const path of [
    "apps/web/public/brand/logo.png",
    "apps/desktop/resources/brand/logo.png",
    "apps/desktop/branding/agentforge/logo.png",
    "apps/desktop/splash/logo.png",
    "apps/portal/assets/logo.png",
  ]) {
    assert.deepEqual([byPath[path].width, byPath[path].height, byPath[path].file], [256, 256, "mark/mark-256.png"], path);
  }
  for (const size of [24, 32, 48, 64]) {
    assert.equal(byPath[`apps/web/components/brand-art/mark-${size}.png`].file, `mark/mark-${size}.png`);
  }
  assert.equal(byPath["apps/web/public/brand/favicon-180.png"].file, "favicon-180.png");
  assert.equal(byPath["apps/web/public/brand/favicon.ico"].file, "favicon.ico");
  for (const path of ["apps/desktop/branding/agentforge/icon.icns", "apps/desktop/build/icon.icns"]) {
    assert.equal(byPath[path].file, "icon.icns", path);
  }
  assert.deepEqual([byPath["apps/desktop/logo.png"].width, byPath["apps/desktop/logo.png"].height], [160, 160]);
  for (const path of [
    "apps/desktop/branding/agentforge/icon.ico",
    "apps/desktop/build/icon.ico",
    "apps/desktop/splash/icon.ico",
  ]) {
    assert.equal(byPath[path].file, "icon.ico", path);
  }
  assert.equal(byPath["apps/desktop/branding/agentforge/mark.png"].art, "mark", "the mark PNG is drawn from mark.svg");
  assert.equal(new Set(p.replacements.map((r) => r.file)).size, p.replacements.length, "shared files render once");
});

// ---------- PNG source mode: resize, trim, composite ----------

/** RGBA of a solid colour with a fully transparent 8 px frame. */
function framedSolid(size, [r, g, b] = [200, 40, 40]) {
  const img = blankImage(size, size);
  for (let y = 8; y < size - 8; y++)
    for (let x = 8; x < size - 8; x++) img.rgba.set([r, g, b, 255], (y * size + x) * 4);
  return img;
}
const pixel = (img, x, y) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test("resizeRgba: identity, no colour fringe on soft edges, averaging, sharpening keeps alpha", () => {
  const src = framedSolid(64);
  assert.ok(Buffer.from(resizeRgba(src.rgba, 64, 64, 64, 64)).equals(src.rgba), "same size is a no-op");

  const small = resizeRgba(src.rgba, 64, 64, 16, 16);
  assert.equal(small[3], 0, "the transparent corner stays transparent");
  let soft = 0;
  for (let i = 0; i < 16 * 16; i++) {
    const a = small[i * 4 + 3];
    if (a === 0) continue;
    if (a < 255) soft++;
    for (const [c, want] of [
      [0, 200],
      [1, 40],
      [2, 40],
    ]) {
      assert.ok(
        Math.abs(small[i * 4 + c] - want) <= 1,
        `colour of a ${a}-alpha pixel is still the fill (premultiplied resize)`,
      );
    }
  }
  assert.ok(soft > 0, "the picture has soft edge pixels, so the fringe check ran");

  const checker = blankImage(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++)
      checker.rgba.set(((x + y) & 1 ? [255, 255, 255] : [0, 0, 0]).concat(255), (y * 64 + x) * 4);
  const mid = resizeRgba(checker.rgba, 64, 64, 16, 16);
  assert.ok(Math.abs(mid[(8 * 16 + 8) * 4] - 128) <= 3, "a 1 px checkerboard averages to mid grey");

  // a step edge: dark left half, light right half. Sharpening raises the contrast next to the edge, never touches alpha.
  const step = blankImage(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) step.rgba.set(x < 32 ? [60, 60, 60, 255] : [200, 200, 200, 255], (y * 64 + x) * 4);
  const plain = resizeRgba(step.rgba, 64, 64, 16, 16);
  const crisp = resizeRgba(step.rgba, 64, 64, 16, 16, { sharpen: 0.8 });
  const at = (buf, x) => buf[(8 * 16 + x) * 4];
  assert.ok(at(crisp, 7) < at(plain, 7), "dark side gets darker next to the edge");
  assert.ok(at(crisp, 8) > at(plain, 8), "light side gets lighter next to the edge");
  for (let i = 0; i < 16 * 16; i++) assert.equal(crisp[i * 4 + 3], 255, "alpha is untouched");
  assert.throws(() => resizeRgba(Buffer.alloc(10), 64, 64, 16, 16), /does not match/);
});

test("encodePng and decodePng round-trip, alphaBounds and trimImage find the picture", () => {
  const img = blankImage(40, 30);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) img.rgba.set(pixelAt(40, x, y % 40), (y * 40 + x) * 4);
  const back = loadPng(encodePng(img.rgba, 40, 30));
  assert.deepEqual([back.width, back.height], [40, 30]);
  assert.ok(back.rgba.equals(img.rgba), "pixels survive the PNG encoder and decoder");
  assert.throws(() => encodePng(Buffer.alloc(8), 4, 4), /does not match/);

  const framed = framedSolid(64);
  assert.deepEqual(alphaBounds(framed.rgba, 64, 64), { x: 8, y: 8, width: 48, height: 48 });
  assert.equal(alphaBounds(blankImage(8, 8).rgba, 8, 8), null);
  assert.deepEqual([trimImage(framed).width, trimImage(framed).height], [48, 48]);

  const wide = blankImage(100, 60);
  for (let y = 20; y < 40; y++) for (let x = 10; x < 90; x++) wide.rgba.set([1, 2, 3, 255], (y * 100 + x) * 4);
  const trimmed = trimImage(wide);
  assert.deepEqual([trimmed.width, trimmed.height], [80, 20]);
  assert.deepEqual([...trimmed.rgba.subarray(0, 4)], [1, 2, 3, 255], "trimming keeps the pixels");
});

test("overImage composites straight-alpha 'over' and leaves the base alone", () => {
  const base = blankImage(4, 4, [0, 0, 200, 255]);
  const layer = blankImage(2, 2, [200, 0, 0, 128]);
  const out = overImage(base, layer, 1, 1);
  assert.deepEqual(pixel(base, 1, 1), [0, 0, 200, 255], "the base image is not mutated");
  const [r, g, b, a] = pixel(out, 1, 1);
  assert.equal(a, 255);
  assert.ok(Math.abs(r - 100) <= 1 && g === 0 && Math.abs(b - 100) <= 1, "half red over blue");
  assert.deepEqual(pixel(out, 0, 0), [0, 0, 200, 255], "outside the layer is untouched");
  const onClear = overImage(blankImage(3, 3), layer, 0, 0);
  assert.deepEqual(pixel(onClear, 0, 0), [200, 0, 0, 128], "over a clear pixel keeps the layer's colour and alpha");
  assert.deepEqual(pixel(overImage(blankImage(2, 2), layer, 1, 1), 0, 0), [0, 0, 0, 0]);
});

// ---------- PNG source mode: tile shape, shadow, derived masters ----------

const TILE_BLUE = [38, 136, 200];
const PATCH_MAGENTA = [220, 20, 200];
const PATCH_GREEN = [10, 200, 10];
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A stand-in for the cut-out logo: a blue tile (the real tile shape) with transparent corners, a cream face, dark eyes,
 * a green patch in the middle of the face and a magenta patch high on the tile (outside the small-size crop). */
function logoImage(size = 1024) {
  const img = blankImage(size, size);
  const mask = tileMask(size, size * TILE_SHAPE.half);
  const ell = (x, y, cx, cy, rx, ry) =>
    ((x - cx * size) / (rx * size)) ** 2 + ((y - cy * size) / (ry * size)) ** 2 <= 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = mask[y * size + x];
      if (a === 0) continue;
      let c = TILE_BLUE;
      if (ell(x, y, 0.5, 0.62, 0.36, 0.24)) c = [246, 231, 214];
      if (ell(x, y, 0.36, 0.58, 0.04, 0.05) || ell(x, y, 0.64, 0.58, 0.04, 0.05)) c = [33, 34, 32];
      if (ell(x, y, 0.5, 0.65, 0.05, 0.04)) c = PATCH_GREEN;
      if (ell(x, y, 0.5, 0.12, 0.05, 0.04)) c = PATCH_MAGENTA;
      img.rgba.set([...c, Math.round(a * 255)], (y * size + x) * 4);
    }
  }
  return img;
}
let cachedLogo = null;
const logo = () => {
  cachedLogo ??= logoImage();
  return cachedLogo;
};

test("tileMask: the tile shape, antialiased, symmetric, squarer than a circle", () => {
  const size = 256;
  const half = 115.5;
  const m = tileMask(size, half);
  const at = (x, y) => m[y * size + x];
  assert.equal(at(128, 128), 1, "the middle is fully covered");
  assert.equal(at(0, 0), 0, "the corner is outside");
  assert.equal(at(128, 0), 0, "the edge midpoint of the canvas is outside a tile that stops at 115 px");
  assert.ok(Math.abs(at(243, 128) - 0.5) < 0.1, `a pixel centred on the edge is half covered (${at(243, 128)})`);
  const d = Math.round(128 + 0.85 * half);
  assert.equal(at(d, d), 1, "at 45 degrees the shape reaches past a circle of the same half-size");
  assert.equal(at(d + 12, d + 12), 0, "and stops soon after");
  for (const [x, y] of [
    [20, 90],
    [200, 33],
    [77, 240],
  ]) {
    assert.equal(at(x, y), at(size - 1 - x, y), "mirror symmetric in x");
    assert.equal(at(x, y), at(x, size - 1 - y), "mirror symmetric in y");
  }
  let soft = 0;
  for (const v of m) if (v > 0 && v < 1) soft++;
  assert.ok(soft > 100 && soft < 4 * size * 4, "a thin antialiased rim, not a hard mask and not a blur");
});

test("edgeColour finds the rim colour and refuses an empty picture", () => {
  assert.deepEqual(edgeColour(logo()), [...TILE_BLUE, 255]);
  assert.throws(() => edgeColour(blankImage(8, 8)), /no opaque edge/);
});

test("dropShadow: soft black shadow, moved down, the picture itself untouched", () => {
  const base = blankImage(96, 96);
  for (let y = 32; y < 64; y++) for (let x = 32; x < 64; x++) base.rgba.set([200, 40, 40, 255], (y * 96 + x) * 4);
  const out = dropShadow(base, { dy: 6, sigma: 4, opacity: 0.5 });
  assert.deepEqual(pixel(out, 48, 48), [200, 40, 40, 255], "opaque pixels keep their colour");
  const below = pixel(out, 48, 68);
  const above = pixel(out, 48, 28);
  assert.ok(below[3] > above[3] + 20, `more shadow below (${below[3]}) than above (${above[3]})`);
  assert.deepEqual(below.slice(0, 3), [0, 0, 0], "the shadow is black");
  assert.ok(below[3] <= 128, "never darker than the opacity");
  assert.equal(pixel(out, 2, 2)[3], 0, "far corners stay clear");
});

test("deriveLogoSources: padded tile, size-tuned crop in the same shape, Apple-grid master with a shadow", () => {
  const { tile, small, mac, full } = deriveLogoSources(logo());
  assert.equal(full, logo());
  assert.deepEqual(
    [tile.width, tile.height, small.width, small.height, mac.width, mac.height],
    [1024, 1024, 256, 256, 1024, 1024],
  );

  const t = alphaBounds(tile.rgba, 1024, 1024, 200);
  assert.ok(
    Math.abs(t.width - Math.round(1024 * (1 - 2 * TILE_PAD))) <= 3,
    `the Windows tile is ${t.width} px wide, ${TILE_PAD * 100}% padding each side`,
  );
  assert.ok(Math.abs(t.x + t.width / 2 - 512) <= 2, "centred");

  const m = alphaBounds(mac.rgba, 1024, 1024, 200);
  assert.ok(Math.abs(m.width - Math.round(1024 * MAC_TILE)) <= 3, `the Apple-grid tile is ${m.width} px wide (824)`);
  assert.equal(pixel(mac, 512, 40)[3], 0, "no shadow above the tile");
  assert.ok(pixel(mac, 512, 1024 - 92)[3] > 0 && pixel(mac, 512, 1024 - 92)[3] < 255, "a soft shadow under it");
  assert.equal(pixel(mac, 3, 3)[3], 0);

  assert.equal(pixel(small, 0, 0)[3], 0, "the small tile has the same rounded shape");
  assert.equal(pixel(small, 128, 128)[3], 255);
  assert.ok(
    near(pixel(small, 128, Math.round(256 * ((0.65 - (0.565 - 0.4)) / 0.8))), PATCH_GREEN) < 40,
    "the face patch is in the crop",
  );
  assert.ok(
    near(pixel(small, 128, 14), TILE_BLUE) < near(pixel(small, 128, 14), PATCH_MAGENTA),
    "the magenta patch high on the tile is cropped away",
  );

  assert.throws(() => deriveLogoSources(blankImage(512, 512)), /at least 1024/);
  assert.throws(() => deriveLogoSources(blankImage(1024, 900)), /square/);
});

// ---------- PNG source mode: the icon set ----------

let cachedSet = null;
function iconSet() {
  cachedSet ??= buildIconSet({ cut: logo() });
  return cachedSet;
}
const decodeFile = (files, name) => loadPng(files.get(name));

test("buildIconSet: every file, PNG sizes, which master each size comes from", () => {
  const files = iconSet();
  const expected = [
    ...PNG_SIZES.map((s) => `png/icon-${s}.png`),
    "icon.ico",
    "icon.icns",
    "favicon.ico",
    "favicon-32.png",
    `favicon-${APPLE_TOUCH_SIZE}.png`,
    "mac/icon-mac-1024.png",
    ...MARK_SIZES.map((s) => `mark/mark-${s}.png`),
    "replace/logo-1024.png",
    "replace/logo-160.png",
    "replace/mark-1024.png",
  ];
  assert.deepEqual([...files.keys()].sort(), expected.sort());

  for (const size of PNG_SIZES) {
    const img = decodeFile(files, `png/icon-${size}.png`);
    assert.deepEqual([img.width, img.height], [size, size], `icon-${size} is ${size}x${size}`);
  }
  // the magenta patch sits high on the tile: tile-derived sizes (48 and up) show it, the size-tuned crop (up to 32) drops it
  for (const size of PNG_SIZES) {
    const img = decodeFile(files, `png/icon-${size}.png`);
    const y = Math.round(size / 2 + (0.12 - 0.5) * (1 - 2 * TILE_PAD) * size);
    const px = pixel(img, size >> 1, y);
    const magenta = near(px, PATCH_MAGENTA) < near(px, TILE_BLUE);
    assert.equal(
      magenta,
      size > SMALL_MAX,
      `icon-${size}: ${size > SMALL_MAX ? "from the padded tile" : "from the size-tuned crop"} (pixel ${px})`,
    );
  }
  assert.equal(SMALL_MAX, 32);
});

test("buildIconSet: the ICO is DIB below 256 and PNG at 256, favicon.ico is 16/32/48", () => {
  const files = iconSet();
  const ico = files.get("icon.ico");
  assert.equal(ico.readUInt16LE(4), 7);
  const kinds = [];
  for (let i = 0; i < 7; i++) {
    const at = 6 + i * 16;
    const size = ico.readUInt8(at) || 256;
    const blob = ico.subarray(ico.readUInt32LE(at + 12), ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8));
    kinds.push([
      size,
      blob.readUInt32LE(0) === 40 ? "dib" : blob.subarray(1, 4).toString("ascii") === "PNG" ? "png" : "?",
    ]);
  }
  assert.deepEqual(kinds, [
    [16, "dib"],
    [24, "dib"],
    [32, "dib"],
    [48, "dib"],
    [64, "dib"],
    [128, "dib"],
    [256, "png"],
  ]);
  const fav = files.get("favicon.ico");
  assert.equal(fav.readUInt16LE(4), 3);
  assert.deepEqual(
    [0, 1, 2].map((i) => fav.readUInt8(6 + i * 16)),
    [16, 32, 48],
  );
  assert.ok(files.get("favicon-32.png").equals(files.get("png/icon-32.png")), "favicon-32.png is the 32 px icon");
});

test("buildIconSet: the ICNS uses the Apple-grid master from 128 px up and the Windows ladder below", () => {
  const files = iconSet();
  const icns = files.get("icon.icns");
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const entries = new Map();
  for (let at = 8; at < icns.length; at += icns.readUInt32BE(at + 4)) {
    entries.set(icns.toString("ascii", at, at + 4), icns.subarray(at + 8, at + icns.readUInt32BE(at + 4)));
  }
  assert.deepEqual(
    [...entries.keys()],
    ICNS_TYPES.map(([t]) => t),
  );
  for (const [type, size] of ICNS_TYPES)
    assert.deepEqual([loadPng(entries.get(type)).width, loadPng(entries.get(type)).height], [size, size], type);

  for (const type of ["icp4", "icp5", "icp6"]) {
    const size = ICNS_TYPES.find(([t]) => t === type)[1];
    assert.ok(entries.get(type).equals(files.get(`png/icon-${size}.png`)), `${type} is the ${size} px ladder icon`);
  }
  const ic10 = loadPng(entries.get("ic10"));
  assert.equal(pixel(ic10, 512, 40)[3], 0, "ic10 keeps Apple's 100 px margin above the tile");
  assert.ok(pixel(ic10, 512, 1024 - 92)[3] > 0, "and the shadow below it");
  for (const type of ["ic07", "ic08", "ic09"]) {
    const size = ICNS_TYPES.find(([id]) => id === type)[1];
    // Apple leaves about 10% above the tile; the Windows ladder leaves 3%, so a row at 7% tells the two masters apart
    assert.equal(
      pixel(loadPng(entries.get(type)), size >> 1, Math.round(size * 0.07))[3],
      0,
      `${type} keeps the Apple-grid margin`,
    );
  }
  assert.ok(files.get("mac/icon-mac-1024.png").equals(entries.get("ic10")), "ic10 is the Apple-grid master");
});

test("buildIconSet: apple-touch icon is opaque in the rim colour, marks are the tile, replacements keep their sizes", () => {
  const files = iconSet();
  const touch = decodeFile(files, `favicon-${APPLE_TOUCH_SIZE}.png`);
  assert.deepEqual([touch.width, touch.height], [180, 180]);
  for (let i = 0; i < 180 * 180; i++)
    assert.equal(touch.rgba[i * 4 + 3], 255, "no transparent pixel for iOS to paint black");
  assert.deepEqual(pixel(touch, 0, 0), [...TILE_BLUE, 255], "the corners are the tile's rim colour");

  for (const size of MARK_SIZES) {
    const m = decodeFile(files, `mark/mark-${size}.png`);
    assert.deepEqual([m.width, m.height], [size, size]);
    assert.equal(m.rgba[3], 0, `mark-${size}: transparent corners`);
    assert.ok(m.rgba[((size >> 1) * size + (size >> 1)) * 4 + 3] === 255, `mark-${size}: opaque middle`);
    assert.ok(alphaBounds(m.rgba, size, size).width >= size - 2, `mark-${size}: the tile runs edge to edge`);
  }
  assert.ok(
    files.get("mark/mark-32.png").equals(files.get("png/icon-32.png")),
    "the small marks are the size-tuned icons",
  );

  const logo160 = decodeFile(files, "replace/logo-160.png");
  assert.deepEqual([logo160.width, logo160.height], [160, 160]);
  const logo1024 = decodeFile(files, "replace/logo-1024.png");
  assert.deepEqual([logo1024.width, logo1024.height], [1024, 1024]);
  assert.equal(logo1024.rgba[3], 0, "transparent corners");
  assert.equal(pixel(logo1024, 512, 0)[3], 255, "and the tile is edge to edge, like the file it replaces");
  const mark = decodeFile(files, "replace/mark-1024.png");
  const box = alphaBounds(mark.rgba, 1024, 1024, 200);
  assert.ok(
    Math.abs(box.width - Math.round(1024 * 0.64)) <= 3,
    `mark.png stand-in holds the tile at 64% (${box.width})`,
  );
});

test("buildIconSet: exact-size overrides win, bad inputs are refused", () => {
  const custom = blankImage(16, 16, [1, 2, 3, 255]);
  const files = buildIconSet({ cut: logo(), overrides: new Map([[16, custom]]) });
  assert.ok(
    decodeFile(files, "png/icon-16.png").rgba.equals(custom.rgba),
    "icon-16.png is the override, byte for byte",
  );
  assert.throws(() => buildIconSet({ cut: blankImage(512, 512) }), /at least 1024/);
  assert.throws(() => buildIconSet({ cut: logo(), overrides: new Map([[24, blankImage(32, 32)]]) }), /must be 24x24/);
});

test("sharpenFor falls with size and stops at 64 px", () => {
  const amounts = [16, 24, 32, 48, 64, 128, 1024].map(sharpenFor);
  for (let i = 1; i < amounts.length; i++) assert.ok(amounts[i] <= amounts[i - 1]);
  assert.ok(amounts[0] > 0);
  assert.equal(sharpenFor(128), 0);
});

// ---------- PNG source mode: lockups ----------

test("layouts: stacked stays centred and apart, horizontal aligns the wordmark with the helmet", () => {
  const head = { width: 400, height: 500 };
  const word = { width: 1000, height: 200 };
  const s = stackedLayout(1024, head, word);
  assert.ok(s.head.y >= 0 && s.word.y + s.word.height <= 1024 && s.word.x >= 0 && s.word.x + s.word.width <= 1024);
  assert.ok(s.head.y + s.head.height < s.word.y, "the head sits above the wordmark");
  for (const box of [s.head, s.word]) assert.ok(Math.abs(box.x + box.width / 2 - 512) <= 1, "centred horizontally");
  assert.ok(Math.abs(s.head.y - (1024 - (s.word.y + s.word.height))) <= 2, "the group is centred vertically");
  assert.ok(
    Math.abs(s.head.width / s.head.height - 0.8) < 0.01 && Math.abs(s.word.width / s.word.height - 5) < 0.05,
    "aspect ratios kept",
  );

  const h = horizontalLayout(1600, 400, head, word);
  assert.ok(h.head.x + h.head.width < h.word.x, "the wordmark is right of the head");
  assert.ok(h.head.x >= 0 && h.word.x + h.word.width <= 1600 && h.head.y >= 0 && h.head.y + h.head.height <= 400);
  const helmetMid = h.head.y + MARK_CENTRE * h.head.height;
  assert.ok(Math.abs(h.word.y + h.word.height / 2 - helmetMid) <= 1, "wordmark middle level with the helmet middle");
  // a very wide wordmark makes the layout shrink to fit instead of running off the canvas
  const wide = horizontalLayout(1600, 400, head, { width: 5000, height: 200 });
  assert.ok(wide.word.x + wide.word.width <= 1600 - 40 + 1 && wide.head.x >= 40 - 1);
});

test("buildLockups: stacked at 1024 and 160, horizontal at 1600x400, ink and light", () => {
  const head = logoImage(512);
  const word = (rgb) => {
    const img = blankImage(600, 130);
    for (let y = 10; y < 120; y++) for (let x = 10; x < 590; x++) img.rgba.set([...rgb, 255], (y * 600 + x) * 4);
    return img;
  };
  const files = buildLockups({ head, wordInk: word([59, 59, 61]), wordLight: word([248, 242, 232]) });
  assert.deepEqual(
    [...files.keys()].sort(),
    ["ink", "light"]
      .flatMap((v) => [
        ...LOCKUP_STACKED_SIZES.map((s) => `lockup/lockup-stacked-${v}-${s}.png`),
        `lockup/lockup-horizontal-${v}-${LOCKUP_HORIZONTAL.width}x${LOCKUP_HORIZONTAL.height}.png`,
      ])
      .sort(),
  );
  for (const size of LOCKUP_STACKED_SIZES) {
    const img = decodeFile(files, `lockup/lockup-stacked-ink-${size}.png`);
    assert.deepEqual([img.width, img.height], [size, size]);
    assert.equal(img.rgba[3], 0, "the corner is transparent");
    const box = alphaBounds(img.rgba, size, size);
    assert.ok(box.width < size && box.height < size && box.width > size * 0.5, "content inside the canvas with margin");
  }
  const wide = decodeFile(files, "lockup/lockup-horizontal-light-1600x400.png");
  assert.deepEqual([wide.width, wide.height], [1600, 400]);
  const wordBox = alphaBounds(wide.rgba, 1600, 400);
  assert.ok(wordBox.width > 800, "head plus wordmark span most of the canvas");
  // the light lockup's wordmark pixels are the light colour, the ink lockup's are the dark one
  const ink = decodeFile(files, "lockup/lockup-stacked-ink-1024.png");
  const layout = stackedLayout(1024, trimImage(head), trimImage(word([0, 0, 0])));
  const probe = (img) =>
    pixel(img, layout.word.x + (layout.word.width >> 1), layout.word.y + (layout.word.height >> 1));
  assert.deepEqual(probe(ink).slice(0, 3), [59, 59, 61]);
  assert.deepEqual(probe(decodeFile(files, "lockup/lockup-stacked-light-1024.png")).slice(0, 3), [248, 242, 232]);
});

test("svgAspect reads the viewBox", () => {
  assert.deepEqual(svgAspect('<svg viewBox="0 0 340.4 77.2" width="340.4">'), { width: 340.4, height: 77.2 });
  assert.deepEqual(svgAspect('<svg viewBox="0 -1.35 64 64">'), { width: 64, height: 64 });
  assert.throws(() => svgAspect("<svg></svg>"), /no viewBox/);
});

// ---------- command line ----------

test("parseArgs", () => {
  const ok = parseArgs(["--src", "brand", "--out", "out", "--small-max", "24"]);
  assert.equal(ok.smallMax, 24);
  assert.match(ok.src, /brand$/);
  assert.match(ok.out, /out$/);
  assert.equal(ok.pngSrc, "");
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--src", "a"]), /--out is required/);
  assert.throws(() => parseArgs(["--src", "a", "--out", "b", "--wat", "1"]), /unknown argument "--wat"/);
  assert.throws(() => parseArgs(["--src", "--out", "b"]), /--src needs a value/);
  assert.throws(() => parseArgs(["--src", "a", "--out", "b", "--small-max", "big"]), /whole number/);
});

test("parseArgs: with neither --src nor --png-src the PNG source is the master next to the brand", () => {
  const def = parseArgs(["--out", "out"]);
  assert.equal(def.pngSrc, DEFAULT_PNG_SRC);
  assert.match(DEFAULT_PNG_SRC.replace(/\\/g, "/"), /apps\/desktop\/branding\/agentforge\/source$/);
  assert.equal(def.src, "");
  assert.equal(def.apply, false);
  assert.equal(def.check, false);
  assert.equal(parseArgs(["--out", "out", "--apply"]).apply, true);
  assert.equal(parseArgs(["--out", "out", "--check", "--repo", "r"]).check, true);
  assert.equal(parseArgs(["--src", "brand", "--out", "out"]).pngSrc, "", "--src alone stays SVG mode");
});

test("needsMasterCut: only when the master is there and the cut is not", () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-src-"));
  try {
    assert.equal(needsMasterCut(dir), false, "an empty folder has nothing to cut");
    writeFileSync(join(dir, LOGO_MASTER), "webp");
    assert.equal(needsMasterCut(dir), true);
    writeFileSync(join(dir, LOGO_SOURCE), "png");
    assert.equal(needsMasterCut(dir), false, "an existing cut wins over the master");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("syncRepoFiles: reports what differs, writes only with apply, never creates an optional file", () => {
  const dir = mkdtempSync(join(tmpdir(), "brand-sync-"));
  const out = join(dir, "out");
  const repo = join(dir, "repo");
  const quiet = console.log;
  console.log = () => {};
  try {
    for (const r of REPLACEMENTS) {
      mkdirSync(dirname(join(out, r.file)), { recursive: true });
      writeFileSync(join(out, r.file), `kit ${r.file}`);
    }
    const same = REPLACEMENTS.find((r) => r.repo.endsWith("brand-art/mark-24.png"));
    const other = REPLACEMENTS.find((r) => r.repo.endsWith("brand-art/mark-32.png"));
    for (const [r, body] of [
      [same, `kit ${same.file}`],
      [other, "an older picture"],
    ]) {
      mkdirSync(dirname(join(repo, r.repo)), { recursive: true });
      writeFileSync(join(repo, r.repo), body);
    }
    const optional = REPLACEMENTS.filter((r) => r.optional).length;
    const expected = REPLACEMENTS.length - optional - 1; // every path but the identical one and the optional ones
    assert.equal(syncRepoFiles(out, repo, { apply: false }), expected);
    assert.equal(readFileSync(join(repo, other.repo), "utf8"), "an older picture", "a dry run writes nothing");
    assert.equal(existsSync(join(repo, "apps/web/public/brand/favicon.ico")), false);
    assert.equal(syncRepoFiles(out, repo, { apply: true }), expected);
    assert.equal(readFileSync(join(repo, other.repo), "utf8"), `kit ${other.file}`, "apply overwrites a different file");
    assert.equal(existsSync(join(repo, "apps/web/public/brand/favicon.ico")), true, "and creates a missing one");
    assert.equal(existsSync(join(repo, "apps/desktop/logo.png")), false, "but never an optional one");
    assert.equal(syncRepoFiles(out, repo, { apply: false }), 0, "a second look finds nothing to do");
  } finally {
    console.log = quiet;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the repo holds the master and every repo path the kit maps onto exists at the size the table says", () => {
  assert.ok(existsSync(join(DEFAULT_PNG_SRC, LOGO_MASTER)), `${LOGO_MASTER} is missing from ${DEFAULT_PNG_SRC}`);
  assert.equal(readFileSync(join(DEFAULT_PNG_SRC, LOGO_MASTER)).subarray(8, 12).toString("ascii"), "WEBP");
  const files = iconSet();
  const repoRoot = join(DEFAULT_PNG_SRC, "..", "..", "..", "..", "..");
  for (const r of REPLACEMENTS) {
    assert.ok(files.has(r.file), `${r.repo}: the kit makes no ${r.file}`);
    if (r.ico) continue;
    const size = readPngSize(files.get(r.file));
    assert.deepEqual([size.width, size.height], [r.width, r.height], `${r.file} for ${r.repo}`);
    const abs = join(repoRoot, r.repo);
    if (existsSync(abs)) {
      const have = readPngSize(readFileSync(abs));
      assert.deepEqual([have.width, have.height], [r.width, r.height], `the repo's ${r.repo}`);
    }
  }
});

test("parseArgs: PNG source mode, alone or with the wordmark dir", () => {
  const png = parseArgs(["--png-src", "renders", "--out", "out"]);
  assert.match(png.pngSrc, /renders$/);
  assert.equal(png.src, "");
  const both = parseArgs(["--png-src", "renders", "--src", "brand", "--out", "out", "--repo", "r"]);
  assert.match(both.pngSrc, /renders$/);
  assert.match(both.src, /brand$/);
  assert.match(both.repo, /r$/);
  assert.throws(() => parseArgs(["--png-src", "renders"]), /--out is required/);
});

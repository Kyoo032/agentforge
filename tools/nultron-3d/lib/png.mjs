// A small PNG codec on node's zlib: 8-bit, non-interlaced, greyscale / RGB / RGBA (what Chromium's canvas writes).
// Used by optimize-png.mjs. No dependency.
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }; // by PNG colour type

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undoes filter `type` on one scanline in place, given the previous (already unfiltered) line. */
function unfilterLine(type, line, prev, bpp) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    if (type === 1) line[i] = (line[i] + a) & 0xff;
    else if (type === 2) line[i] = (line[i] + b) & 0xff;
    else if (type === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
    else if (type === 4) line[i] = (line[i] + paeth(a, b, c)) & 0xff;
    else if (type !== 0) throw new Error(`unknown PNG filter ${type}`);
  }
}

/** { width, height, colourType, channels, pixels } where pixels is the raw scanline bytes without filter bytes. */
export function decodePng(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
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
  if (!ihdr) throw new Error("PNG has no IHDR");
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const [bitDepth, colourType, , , interlace] = ihdr.subarray(8, 13);
  const channels = CHANNELS[colourType];
  if (bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(`unsupported PNG (bit depth ${bitDepth}, colour type ${colourType}, interlace ${interlace})`);
  }
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error("PNG pixel data has the wrong length");
  const pixels = Buffer.alloc(stride * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    unfilterLine(raw[y * (stride + 1)], line, prev, channels);
    line.copy(pixels, y * stride);
    prev = line;
  }
  return { width, height, colourType, channels, pixels };
}

function filterLine(type, line, prev, bpp) {
  const out = Buffer.alloc(line.length);
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    const predictor = type === 0 ? 0 : type === 1 ? a : type === 2 ? b : type === 3 ? (a + b) >> 1 : paeth(a, b, c);
    out[i] = (line[i] - predictor) & 0xff;
  }
  return out;
}

/** Encodes decoded pixels. Every scanline takes the filter with the smallest sum of absolute residuals (the libpng heuristic). */
export function encodePng({ width, height, colourType, channels, pixels }) {
  const stride = width * channels;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const line = pixels.subarray(y * stride, (y + 1) * stride);
    let best = null;
    for (let type = 0; type < 5; type++) {
      const filtered = filterLine(type, line, prev, channels);
      let cost = 0;
      for (const v of filtered) cost += v < 128 ? v : 256 - v;
      if (!best || cost < best.cost) best = { type, filtered, cost };
    }
    rows.push(Buffer.from([best.type]), best.filtered);
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, colourType, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9, memLevel: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

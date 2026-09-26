import { crc32, deflateSync, inflateSync } from "node:zlib";

/**
 * Local page face for the book reader.
 *
 * This is a bitmap recognizer that runs on the machine. It does not call a hosted reader and it
 * does not share a code path with the document converter. A page drawn in this face round-trips.
 * A scan in another face comes back as a local result with no letters, which the caller shows
 * as-is instead of refusing the file with nowhere to go.
 */

const SCALE = 4;
const GLYPH_W = 5;
const GLYPH_H = 7;
const LETTER_GAP = 1;
const SPACE_W = 4;
const MARGIN = 3;

/** 5×7 uppercase face. Each row is five bits, left to right. */
const FACE: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type, "ascii");
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

/** Draw `text` as a grayscale PNG in the local page face. Uppercase letters and spaces only. */
export function renderPagePng(text: string): Uint8Array {
  const chars = text.toUpperCase().split("");
  let widthUnits = MARGIN * 2;
  for (const char of chars) {
    widthUnits += char === " " ? SPACE_W : GLYPH_W + LETTER_GAP;
  }
  const width = Math.max(1, widthUnits * SCALE);
  const height = (MARGIN * 2 + GLYPH_H) * SCALE;
  const pixels = Buffer.alloc(width * height, 255);
  let cursor = MARGIN;
  for (const char of chars) {
    if (char === " ") {
      cursor += SPACE_W;
      continue;
    }
    const glyph = FACE[char];
    if (!glyph) {
      cursor += GLYPH_W + LETTER_GAP;
      continue;
    }
    for (let row = 0; row < GLYPH_H; row += 1) {
      const bits = glyph[row] ?? "00000";
      for (let col = 0; col < GLYPH_W; col += 1) {
        if (bits[col] !== "1") {
          continue;
        }
        for (let sy = 0; sy < SCALE; sy += 1) {
          for (let sx = 0; sx < SCALE; sx += 1) {
            const x = (cursor + col) * SCALE + sx;
            const y = (MARGIN + row) * SCALE + sy;
            pixels[y * width + x] = 0;
          }
        }
      }
    }
    cursor += GLYPH_W + LETTER_GAP;
  }

  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png);
}

type Gray = { width: number; height: number; pixels: Uint8Array };

function decodePng(bytes: Uint8Array): Gray | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset + 8 <= bytes.length) {
    const length = Buffer.from(bytes.subarray(offset, offset + 4)).readUInt32BE(0);
    const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("ascii");
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) {
      return null;
    }
    const data = Buffer.from(bytes.subarray(start, end));
    if (type === "IHDR" && data.length >= 13) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (width < 1 || height < 1 || width > 4000 || height > 4000 || bitDepth !== 8 || colorType !== 0) {
    return null;
  }
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width + 1;
  if (inflated.length < stride * height) {
    return null;
  }
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    if (inflated[row] !== 0) {
      return null;
    }
    pixels.set(inflated.subarray(row + 1, row + 1 + width), y * width);
  }
  return { width, height, pixels };
}

function hamming(glyph: string[], rows: string[]): number {
  let distance = 0;
  for (let row = 0; row < GLYPH_H; row += 1) {
    const left = glyph[row] ?? "00000";
    const right = rows[row] ?? "00000";
    for (let col = 0; col < GLYPH_W; col += 1) {
      if (left[col] !== right[col]) {
        distance += 1;
      }
    }
  }
  return distance;
}

function matchGlyph(samples: string[]): string {
  let best = "?";
  let bestDistance = GLYPH_W * GLYPH_H;
  for (const [char, glyph] of Object.entries(FACE)) {
    const distance = hamming(glyph, samples);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = char;
    }
  }
  return bestDistance <= 6 ? best : "?";
}

/**
 * Read a PNG drawn in the local page face.
 * Returns the letters, or an empty string when the bitmap is not that face.
 */
export function readPagePng(bytes: Uint8Array): string {
  const image = decodePng(bytes);
  if (!image) {
    return "";
  }
  const ink = (x: number, y: number) => (image.pixels[y * image.width + x] ?? 255) < 128;
  const rowInk: number[] = [];
  for (let y = 0; y < image.height; y += 1) {
    let count = 0;
    for (let x = 0; x < image.width; x += 1) {
      if (ink(x, y)) {
        count += 1;
      }
    }
    rowInk.push(count);
  }
  const top = rowInk.findIndex((count) => count > 0);
  let bottom = rowInk.length - 1;
  while (bottom > top && (rowInk[bottom] ?? 0) === 0) {
    bottom -= 1;
  }
  if (top < 0 || bottom < top) {
    return "";
  }
  const bands: Array<{ start: number; end: number }> = [];
  let bandStart = -1;
  for (let y = top; y <= bottom + 1; y += 1) {
    const on = y <= bottom && (rowInk[y] ?? 0) > 0;
    if (on && bandStart < 0) {
      bandStart = y;
    } else if (!on && bandStart >= 0) {
      bands.push({ start: bandStart, end: y });
      bandStart = -1;
    }
  }
  let text = "";
  for (const band of bands) {
    const colInk: number[] = [];
    for (let x = 0; x < image.width; x += 1) {
      let count = 0;
      for (let y = band.start; y < band.end; y += 1) {
        if (ink(x, y)) {
          count += 1;
        }
      }
      colInk.push(count);
    }
    const glyphs: Array<{ start: number; end: number }> = [];
    let glyphStart = -1;
    for (let x = 0; x <= image.width; x += 1) {
      const on = x < image.width && (colInk[x] ?? 0) > 0;
      if (on && glyphStart < 0) {
        glyphStart = x;
      } else if (!on && glyphStart >= 0) {
        glyphs.push({ start: glyphStart, end: x });
        glyphStart = -1;
      }
    }
    let line = "";
    let previousEnd = -1;
    for (const glyph of glyphs) {
      if (previousEnd >= 0 && glyph.start - previousEnd > 2 * SCALE) {
        line += " ";
      }
      const samples: string[] = [];
      for (let row = 0; row < GLYPH_H; row += 1) {
        let bits = "";
        const y0 = band.start + Math.floor(((band.end - band.start) * row) / GLYPH_H);
        const y1 = band.start + Math.floor(((band.end - band.start) * (row + 1)) / GLYPH_H);
        for (let col = 0; col < GLYPH_W; col += 1) {
          const x0 = glyph.start + Math.floor(((glyph.end - glyph.start) * col) / GLYPH_W);
          const x1 = glyph.start + Math.floor(((glyph.end - glyph.start) * (col + 1)) / GLYPH_W);
          let dark = 0;
          let total = 0;
          for (let y = y0; y < Math.max(y1, y0 + 1); y += 1) {
            for (let x = x0; x < Math.max(x1, x0 + 1); x += 1) {
              total += 1;
              if (ink(x, y)) {
                dark += 1;
              }
            }
          }
          bits += total > 0 && dark * 2 >= total ? "1" : "0";
        }
        samples.push(bits);
      }
      line += matchGlyph(samples);
      previousEnd = glyph.end;
    }
    text = text ? `${text} ${line.trim()}` : line.trim();
  }
  return text;
}

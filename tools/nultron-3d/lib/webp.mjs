// Pixel size of a PNG or WebP file from its header, the same reading apps/web/lib/nultron-images.test.tsx does, so a render
// is judged by the check the app will apply to it. No decoding, no dependency.

/** { format, width, height, alpha } of a PNG, or of a WebP (VP8X, VP8L or VP8 chunk); null when it is neither. */
export function imageInfo(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length >= 26 && b.toString("latin1", 1, 4) === "PNG") {
    return { format: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 };
  }
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8X") {
      return {
        format: "webp",
        width: 1 + b.readUIntLE(24, 3),
        height: 1 + b.readUIntLE(27, 3),
        alpha: Boolean(b[20] & 0x10),
      };
    }
    if (chunk === "VP8L") {
      const bits = b.readUInt32LE(21);
      return {
        format: "webp",
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >> 14) & 0x3fff),
        alpha: Boolean((bits >> 28) & 1),
      };
    }
    if (chunk === "VP8 ") {
      return { format: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, alpha: false };
    }
  }
  return null;
}

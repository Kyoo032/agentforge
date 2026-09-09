import { open, stat } from "node:fs/promises";

export type ByteRange = { start: number; end: number };

const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

/**
 * Parse a single HTTP `Range` header against a body of `size` bytes.
 * Returns `null` when there is no usable range (serve the whole body) and
 * `"unsatisfiable"` when the client asked for bytes that do not exist.
 */
export function parseByteRange(header: string | undefined, size: number): ByteRange | null | "unsatisfiable" {
  if (!header) {
    return null;
  }
  const match = header.trim().match(RANGE_PATTERN);
  if (!match) {
    return null;
  }
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") {
    return null;
  }
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix <= 0 || size === 0) {
      return "unsatisfiable";
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || end < start) {
    return "unsatisfiable";
  }
  return { start, end };
}

export type RangedBytes = {
  status: 200 | 206 | 416;
  bytes: Uint8Array;
  headers: Record<string, string>;
};

function unsatisfiable(size: number): RangedBytes {
  return {
    status: 416,
    bytes: new Uint8Array(0),
    headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
  };
}

function whole(bytes: Uint8Array): RangedBytes {
  return { status: 200, bytes, headers: { "Accept-Ranges": "bytes", "Content-Length": String(bytes.byteLength) } };
}

function partial(bytes: Uint8Array, range: ByteRange, size: number): RangedBytes {
  return {
    status: 206,
    bytes,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": String(bytes.byteLength),
    },
  };
}

/** Slice `bytes` for a `Range` request. Never mutates the input. */
export function sliceByteRange(bytes: Uint8Array, header: string | undefined): RangedBytes {
  const size = bytes.byteLength;
  const range = parseByteRange(header, size);
  if (range === "unsatisfiable") {
    return unsatisfiable(size);
  }
  if (!range) {
    return whole(bytes);
  }
  return partial(bytes.slice(range.start, range.end + 1), range, size);
}

/**
 * Read a file for a `Range` request, touching only the requested bytes on
 * disk so scrubbing a large clip does not re-read the whole file per seek.
 */
export async function readByteRange(filePath: string, header: string | undefined): Promise<RangedBytes> {
  const size = (await stat(filePath)).size;
  const range = parseByteRange(header, size);
  if (range === "unsatisfiable") {
    return unsatisfiable(size);
  }
  const handle = await open(filePath, "r");
  try {
    if (!range) {
      const buffer = new Uint8Array(size);
      await handle.read(buffer, 0, size, 0);
      return whole(buffer);
    }
    const length = range.end - range.start + 1;
    const buffer = new Uint8Array(length);
    await handle.read(buffer, 0, length, range.start);
    return partial(buffer, range, size);
  } finally {
    await handle.close();
  }
}

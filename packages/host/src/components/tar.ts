/**
 * A minimal, deliberately unforgiving `.tgz` reader for npm tarballs. No new dependency: `node:zlib`
 * gunzips, and the ustar blocks are parsed here.
 *
 * SECURITY — these bytes came off the network, so this reader is the boundary that decides where a
 * file may land. It is pure: it returns entries, it never touches the disk (`unpack.ts` writes them),
 * and it refuses anything that is not a plain file or a directory inside the target. Absolute paths,
 * `..` segments, Windows drive letters, symlinks and hardlinks are all errors, not skips — a tarball
 * that contains one is not a tarball we unpack half of.
 */
import { gunzipSync } from "node:zlib";
import { ComponentError } from "./types";

const BLOCK = 512;
const NAME = { offset: 0, length: 100 } as const;
const MODE = { offset: 100, length: 8 } as const;
const SIZE = { offset: 124, length: 12 } as const;
const CHECKSUM = { offset: 148, length: 8 } as const;
const TYPEFLAG = 156;
const PREFIX = { offset: 345, length: 155 } as const;

/** npm publishes every file under a single `package/` directory; it is stripped, not trusted. */
const NPM_PREFIX = "package/";

const FILE_TYPES = new Set(["0", "\0", "7"]);
const DIRECTORY_TYPE = "5";
const PAX_TYPES = new Set(["x", "X", "g"]);

export type TarEntry = {
  /** Relative, forward-slashed, already proven not to escape the target. */
  readonly path: string;
  readonly data: Buffer;
  readonly mode: number;
  readonly directory: boolean;
};

export type TarLimits = {
  readonly maxTotalBytes: number;
  readonly maxEntries: number;
};

function fail(reason: string): never {
  throw new ComponentError("unpack_failed", reason);
}

function text(block: Buffer, field: { offset: number; length: number }): string {
  const raw = block.subarray(field.offset, field.offset + field.length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end === -1 ? raw.length : end).toString("ascii");
}

function octal(block: Buffer, field: { offset: number; length: number }, name: string): number {
  const value = text(block, field).trim();
  if (!value) {
    return 0;
  }
  if (!/^[0-7]+$/.test(value)) {
    return fail(`tar header field ${name} is not octal`);
  }
  return Number.parseInt(value, 8);
}

/** The classic ustar checksum: the header summed with its own checksum field read as spaces. */
function checksumMatches(block: Buffer): boolean {
  const stored = octal(block, CHECKSUM, "checksum");
  let unsigned = 0;
  for (let at = 0; at < BLOCK; at += 1) {
    const inField = at >= CHECKSUM.offset && at < CHECKSUM.offset + CHECKSUM.length;
    unsigned += inField ? 0x20 : block[at];
  }
  return unsigned === stored;
}

function isZeroBlock(block: Buffer): boolean {
  return block.every((byte) => byte === 0);
}

/** Reject before joining: a name that is absolute, a drive path, or climbs out of the target. */
function safeRelativePath(raw: string): string {
  const normalized = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalized || normalized === ".") {
    return "";
  }
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
    return fail(`tar entry ${JSON.stringify(raw)} is an absolute path`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    return fail(`tar entry ${JSON.stringify(raw)} escapes the component directory`);
  }
  return segments.join("/");
}

/** Strip npm's wrapper directory first, then validate what is left — never the other way round. */
function relativeEntryPath(raw: string): string {
  const slashed = raw.replace(/\\/g, "/");
  if (slashed === NPM_PREFIX || slashed === "package") {
    return "";
  }
  return safeRelativePath(slashed.startsWith(NPM_PREFIX) ? slashed.slice(NPM_PREFIX.length) : slashed);
}

/** `<len> key=value\n` records. Only `path` is honoured; everything else is ignored on purpose. */
function paxPath(data: Buffer): string | null {
  let cursor = 0;
  const body = data.toString("utf8");
  while (cursor < body.length) {
    const space = body.indexOf(" ", cursor);
    if (space === -1) {
      return null;
    }
    const length = Number.parseInt(body.slice(cursor, space), 10);
    if (!Number.isFinite(length) || length <= 0) {
      return null;
    }
    const record = body.slice(space + 1, cursor + length).replace(/\n$/, "");
    if (record.startsWith("path=")) {
      return record.slice("path=".length);
    }
    cursor += length;
  }
  return null;
}

function headerName(block: Buffer): string {
  const prefix = text(block, PREFIX);
  const name = text(block, NAME);
  return prefix ? `${prefix}/${name}` : name;
}

function gunzip(bytes: Buffer): Buffer {
  try {
    return gunzipSync(bytes);
  } catch (error) {
    return fail(`archive is not valid gzip: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

/**
 * Entries in archive order, with `package/` stripped. Throws `unpack_failed` on anything unexpected,
 * including a truncated archive or either cap being exceeded.
 */
export function readTarGz(bytes: Buffer, limits: TarLimits): TarEntry[] {
  const tar = gunzip(bytes);
  const entries: TarEntry[] = [];
  let total = 0;
  let overridePath: string | null = null;
  let offset = 0;

  while (offset + BLOCK <= tar.byteLength) {
    const block = tar.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (isZeroBlock(block)) {
      break;
    }
    if (!checksumMatches(block)) {
      return fail("tar header checksum does not match");
    }
    const size = octal(block, SIZE, "size");
    const dataEnd = offset + size;
    if (dataEnd > tar.byteLength) {
      return fail("tar archive is truncated");
    }
    const data = tar.subarray(offset, dataEnd);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    const typeflag = String.fromCharCode(block[TYPEFLAG] || 0x30);
    if (PAX_TYPES.has(typeflag)) {
      overridePath = paxPath(Buffer.from(data));
      continue;
    }
    const rawName = overridePath ?? headerName(block);
    overridePath = null;
    if (!FILE_TYPES.has(typeflag) && typeflag !== DIRECTORY_TYPE) {
      return fail(`tar entry ${JSON.stringify(rawName)} is not a regular file or directory (type ${typeflag})`);
    }
    const path = relativeEntryPath(rawName);
    if (!path) {
      continue;
    }
    if (entries.length >= limits.maxEntries) {
      return fail(`tar archive has more than ${limits.maxEntries} entries`);
    }
    const directory = typeflag === DIRECTORY_TYPE;
    total += directory ? 0 : size;
    if (total > limits.maxTotalBytes) {
      return fail(`tar archive unpacks to more than ${limits.maxTotalBytes} bytes`);
    }
    entries.push({
      path,
      data: directory ? Buffer.alloc(0) : Buffer.from(data),
      mode: octal(block, MODE, "mode") & 0o777,
      directory,
    });
  }
  if (entries.length === 0) {
    return fail("tar archive contains no files");
  }
  return entries;
}

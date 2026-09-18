/**
 * The tar reader is the one place downloaded bytes decide where a file lands, so every rejection it
 * owes is asserted here against hand-built ustar blocks: traversal, absolute paths, links, and both
 * caps. The happy path is built in-test with zlib so no fixture file is needed.
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readTarGz } from "./tar";
import { ComponentError } from "./types";

const BLOCK = 512;

type Header = {
  name: string;
  size?: number;
  mode?: number;
  typeflag?: string;
  linkname?: string;
};

function writeField(block: Buffer, text: string, offset: number, length: number): void {
  block.write(text.slice(0, length - 1), offset, "ascii");
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, "0");
}

function header({ name, size = 0, mode = 0o644, typeflag = "0", linkname = "" }: Header): Buffer {
  const block = Buffer.alloc(BLOCK, 0);
  writeField(block, name, 0, 100);
  writeField(block, octal(mode, 8), 100, 8);
  writeField(block, octal(0, 8), 108, 8);
  writeField(block, octal(0, 8), 116, 8);
  writeField(block, octal(size, 12), 124, 12);
  writeField(block, octal(0, 12), 136, 12);
  block.write(typeflag, 156, "ascii");
  writeField(block, linkname, 157, 100);
  block.write("ustar\0", 257, "ascii");
  block.write("00", 263, "ascii");
  // Checksum: the field is spaces while the sum is taken, then written back as octal + NUL + space.
  block.write(" ".repeat(8), 148, "ascii");
  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return block;
}

function padded(data: Buffer): Buffer {
  const remainder = data.byteLength % BLOCK;
  return remainder === 0 ? data : Buffer.concat([data, Buffer.alloc(BLOCK - remainder, 0)]);
}

function entry(head: Header, body = ""): Buffer {
  const data = Buffer.from(body, "utf8");
  return Buffer.concat([header({ ...head, size: data.byteLength }), padded(data)]);
}

function archive(...parts: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(BLOCK * 2, 0)]));
}

const LIMITS = { maxTotalBytes: 100_000, maxEntries: 50 } as const;

function read(bytes: Buffer) {
  return readTarGz(bytes, LIMITS);
}

function failureOf(bytes: Buffer): ComponentError {
  try {
    read(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(ComponentError);
    return error as ComponentError;
  }
  throw new Error("expected readTarGz to throw");
}

describe("readTarGz", () => {
  it("reads regular files and strips the leading package/ directory", () => {
    const entries = read(
      archive(
        entry({ name: "package/", typeflag: "5" }, ""),
        entry({ name: "package/index.js", mode: 0o644 }, "module.exports = 1;\n"),
        entry({ name: "package/lib/", typeflag: "5" }, ""),
        entry({ name: "package/lib/native.node", mode: 0o755 }, "BINARY"),
      ),
    );
    expect(entries.map((item) => item.path)).toEqual(["index.js", "lib", "lib/native.node"]);
    const index = entries.find((item) => item.path === "index.js");
    expect(index?.data.toString("utf8")).toBe("module.exports = 1;\n");
    expect(entries.find((item) => item.path === "lib/native.node")?.mode).toBe(0o755);
  });

  it("returns directory entries with no data and files with their bytes", () => {
    const entries = read(
      archive(entry({ name: "package/a/", typeflag: "5" }), entry({ name: "package/a/b.txt" }, "x")),
    );
    const dir = entries.find((item) => item.path === "a");
    expect(dir?.directory).toBe(true);
    expect(dir?.data.byteLength).toBe(0);
    expect(entries.find((item) => item.path === "a/b.txt")?.directory).toBe(false);
  });

  it("rejects a path that climbs out with ..", () => {
    expect(failureOf(archive(entry({ name: "package/../../evil.js" }, "x"))).code).toBe("unpack_failed");
  });

  it("rejects an absolute path", () => {
    expect(failureOf(archive(entry({ name: "/etc/passwd" }, "x"))).code).toBe("unpack_failed");
    expect(failureOf(archive(entry({ name: "package/C:/Windows/evil.dll" }, "x"))).code).toBe("unpack_failed");
  });

  it("rejects a symlink and a hardlink", () => {
    const symlink = archive(entry({ name: "package/link.js", typeflag: "2", linkname: "../../secrets" }));
    const hardlink = archive(entry({ name: "package/link.js", typeflag: "1", linkname: "index.js" }));
    expect(failureOf(symlink).code).toBe("unpack_failed");
    expect(failureOf(hardlink).code).toBe("unpack_failed");
  });

  it("rejects any entry type that is not a file or a directory", () => {
    expect(failureOf(archive(entry({ name: "package/dev", typeflag: "3" }))).code).toBe("unpack_failed");
  });

  it("rejects an archive whose unpacked bytes exceed the cap", () => {
    const big = entry({ name: "package/big.bin" }, "z".repeat(60_000));
    const error = failureOf(archive(big, entry({ name: "package/also.bin" }, "z".repeat(60_000))));
    expect(error.code).toBe("unpack_failed");
    expect(error.message).toContain("bytes");
  });

  it("rejects an archive with too many entries", () => {
    const many = Array.from({ length: 60 }, (_item, index) => entry({ name: `package/f${index}.txt` }, "x"));
    expect(failureOf(archive(...many)).code).toBe("unpack_failed");
  });

  it("rejects bytes that are not gzip at all", () => {
    expect(failureOf(Buffer.from("not a tarball")).code).toBe("unpack_failed");
  });

  it("rejects a truncated archive", () => {
    const truncated = gzipSync(header({ name: "package/index.js", size: 4096 }));
    expect(failureOf(truncated).code).toBe("unpack_failed");
  });

  it("applies a pax path override and never emits the pax entry itself", () => {
    // A pax record is `<total length> path=<value>\n`, the length counting its own digits.
    const record = "27 path=package/renamed.js\n";
    const entries = read(
      archive(
        entry({ name: "package/PaxHeader/x", typeflag: "x" }, record),
        entry({ name: "package/placeholder.js" }, "ok"),
      ),
    );
    expect(entries.map((item) => item.path)).toEqual(["renamed.js"]);
  });
});

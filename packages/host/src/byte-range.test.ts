import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseByteRange, readByteRange, sliceByteRange } from "./byte-range";

describe("parseByteRange", () => {
  it("returns null when no header is present", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
    expect(parseByteRange("", 100)).toBeNull();
  });

  it("parses a closed range", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
  });

  it("clamps an open-ended range to the last byte", () => {
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=0-500", 100)).toEqual({ start: 0, end: 99 });
  });

  it("supports suffix ranges", () => {
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("rejects unsatisfiable or malformed ranges", () => {
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=20-10", 100)).toBe("unsatisfiable");
    expect(parseByteRange("items=0-1", 100)).toBeNull();
    expect(parseByteRange("bytes=a-b", 100)).toBeNull();
  });
});

describe("sliceByteRange", () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

  it("serves the whole body with Accept-Ranges when no range is asked", () => {
    const out = sliceByteRange(bytes, undefined);
    expect(out.status).toBe(200);
    expect(Array.from(out.bytes)).toEqual(Array.from(bytes));
    expect(out.headers).toEqual({ "Accept-Ranges": "bytes", "Content-Length": "10" });
    expect(Array.from(bytes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("serves a partial body with Content-Range", () => {
    const out = sliceByteRange(bytes, "bytes=2-4");
    expect(out.status).toBe(206);
    expect(Array.from(out.bytes)).toEqual([2, 3, 4]);
    expect(out.headers).toEqual({ "Accept-Ranges": "bytes", "Content-Range": "bytes 2-4/10", "Content-Length": "3" });
  });

  it("answers 416 for an unsatisfiable range", () => {
    const out = sliceByteRange(bytes, "bytes=50-");
    expect(out.status).toBe(416);
    expect(out.bytes.length).toBe(0);
    expect(out.headers).toEqual({ "Accept-Ranges": "bytes", "Content-Range": "bytes */10" });
  });
});

describe("readByteRange", () => {
  async function fixture(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "byte-range-"));
    const file = path.join(dir, "clip.bin");
    await writeFile(file, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    return file;
  }

  it("reads the whole file without a range", async () => {
    const out = await readByteRange(await fixture(), undefined);
    expect(out.status).toBe(200);
    expect(Array.from(out.bytes)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out.headers["Content-Length"]).toBe("10");
  });

  it("reads only the requested slice", async () => {
    const out = await readByteRange(await fixture(), "bytes=7-");
    expect(out.status).toBe(206);
    expect(Array.from(out.bytes)).toEqual([7, 8, 9]);
    expect(out.headers["Content-Range"]).toBe("bytes 7-9/10");
  });

  it("answers 416 without opening the file body", async () => {
    const out = await readByteRange(await fixture(), "bytes=10-");
    expect(out.status).toBe(416);
    expect(out.headers["Content-Range"]).toBe("bytes */10");
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { buildZipBomb } from "@agentforge/core/docx/test-fixtures";
import { parseDocxOrThrow } from "./store-files";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "../../../core/src/docx/fixtures");
const REAL_DOCX = new Uint8Array(readFileSync(join(FIXTURES, "original-term-sheet.docx")));

async function codeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "no_error";
  } catch (error) {
    return error instanceof ApiError ? error.code : `unexpected:${String(error)}`;
  }
}

describe("legal docx caps", () => {
  it("refuses a zip that declares more inflated bytes than the cap, before inflating it", async () => {
    // A few hundred bytes of archive whose central directory claims 900 MB per entry.
    const bomb = await buildZipBomb(900 * 1024 * 1024);
    expect(bomb.byteLength).toBeLessThan(10_000);
    expect(await codeOf(parseDocxOrThrow(bomb))).toBe("docx_too_large");
  });

  it("still reads an ordinary Word file", async () => {
    const doc = await parseDocxOrThrow(REAL_DOCX);
    expect(doc.paragraphs.length).toBeGreaterThan(0);
  });

  it("keeps reporting non-Word bytes as an unsupported file", async () => {
    const notAZip = new TextEncoder().encode("not a zip at all");
    expect(await codeOf(parseDocxOrThrow(notAZip))).toBe("unsupported_content_type");
  });
});

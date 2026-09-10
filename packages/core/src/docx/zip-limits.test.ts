import { describe, expect, it } from "vitest";
import { buildZip, buildZipBomb } from "./__fixtures__/build-zip";
import { DOCX_MAX_INFLATED_BYTES, declaredInflatedBytes } from "./zip-limits";

describe("declaredInflatedBytes", () => {
  it("sums the declared uncompressed size of an ordinary archive", async () => {
    const zip = await buildZip([{ name: "word/document.xml", body: "<w:document/>" }]);
    expect(await declaredInflatedBytes(zip)).toBe("<w:document/>".length);
  });

  it("reports the inflated size a bomb claims without inflating it", async () => {
    const bomb = await buildZipBomb(900 * 1024 * 1024);
    const declared = await declaredInflatedBytes(bomb);
    expect(declared).toBeGreaterThan(DOCX_MAX_INFLATED_BYTES);
    // Two entries, each claiming 900 MB, from an archive of a few hundred bytes.
    expect(bomb.byteLength).toBeLessThan(10_000);
  });

  it("rejects bytes that are not a zip at all", async () => {
    await expect(declaredInflatedBytes(new TextEncoder().encode("not a zip"))).rejects.toThrow(/not a zip archive/);
  });
});

import { describe, expect, it } from "vitest";
import { renderPagePng } from "@agentforge/university";
import { readBookFile } from "./read-book";

describe("readBookFile", () => {
  it("reads a page drawn in the local face", async () => {
    const png = renderPagePng("LOCAL PAGE SCAN");
    const read = await readBookFile("en", { filename: "page.png", bytes: png });
    expect(read.kind).toBe("local-ocr");
    expect(read.text).toBe("LOCAL PAGE SCAN");
    expect(read.message).toMatch(/this machine/i);
  });

  it("returns a local empty result for a PNG that is not the page face", async () => {
    const png = renderPagePng("LOCAL PAGE SCAN");
    png[40] = png[40] === 0 ? 1 : 0;
    const read = await readBookFile("id", { filename: "scan.png", bytes: png });
    expect(read.kind === "local-ocr" || read.kind === "local-ocr-empty").toBe(true);
    expect(read.message.length).toBeGreaterThan(0);
    expect(read.message).not.toMatch(/needs_ocr/);
  });

  it("refuses a file that is not a page, with a local message", async () => {
    const read = await readBookFile("en", { filename: "notes.txt", bytes: new Uint8Array([1, 2, 3, 4]) });
    expect(read.kind).toBe("unsupported");
    expect(read.text).toBe("");
    expect(read.message).toMatch(/PNG|PDF/);
  });
});

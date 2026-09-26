import { describe, expect, it } from "vitest";
import { readPagePng, renderPagePng } from "./page-face";

describe("local page face", () => {
  it("reads a page it drew, on this machine", () => {
    const png = renderPagePng("LOCAL PAGE SCAN");
    expect(png[0]).toBe(137);
    expect(readPagePng(png)).toBe("LOCAL PAGE SCAN");
  });

  it("returns no letters for a bitmap that is not the page face", () => {
    const blank = renderPagePng("");
    expect(readPagePng(blank)).toBe("");
    expect(readPagePng(new Uint8Array([1, 2, 3, 4]))).toBe("");
  });
});

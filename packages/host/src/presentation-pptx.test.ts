import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildPresentationPptx } from "./presentation-pptx";
import { parsePresentationOutlineBody } from "./presentation-outline";

describe("buildPresentationPptx", () => {
  it("returns a non-empty pptx buffer and a .pptx filename", async () => {
    const outline = parsePresentationOutlineBody({
      title: "DPSBuddy Demo",
      slides: [
        { heading: "Why", bullets: ["Local owner", "Gateway-first"], notes: "Open strong" },
        { heading: "How", bullets: ["Prompt", "Preview", "Download"], notes: "" },
      ],
    });
    const { buffer, filename } = await buildPresentationPptx(outline);
    expect(filename).toBe("DPSBuddy-Demo.pptx");
    expect(buffer.byteLength).toBeGreaterThan(1000);
    const bytes = new Uint8Array(buffer);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it("sanitizes unsafe title characters in the filename", async () => {
    const { filename } = await buildPresentationPptx(
      parsePresentationOutlineBody({
        title: "Q3 / Plan: v2?",
        slides: [{ heading: "A", bullets: ["b"], notes: "" }],
      }),
    );
    expect(filename).toMatch(/\.pptx$/);
    expect(filename).not.toMatch(/[/?:]/);
  });

  it("builds section, split, and close layouts", async () => {
    const { buffer } = await buildPresentationPptx(
      parsePresentationOutlineBody({
        title: "Layouts",
        slides: [
          { kind: "section", heading: "Open", subhead: "Line", bullets: [], notes: "" },
          { kind: "split", heading: "Split", bullets: ["a", "b", "c"], aside: "Callout", notes: "" },
          { kind: "close", heading: "Ask", bullets: ["yes"], notes: "" },
        ],
      }),
    );
    expect(buffer.byteLength).toBeGreaterThan(1000);
    const bytes = new Uint8Array(buffer);
    expect(bytes[0]).toBe(0x50);
  });

  it("builds a deck with an Indonesian title-slide kicker", async () => {
    const { buffer } = await buildPresentationPptx(
      parsePresentationOutlineBody({
        title: "Pembaruan proyek",
        slides: [{ heading: "Keputusan", bullets: ["Ya atau tidak"], notes: "Tawarkan Kamis." }],
      }),
      { locale: "id" },
    );
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });

  it("writes an owner text shape into the slide XML", async () => {
    const { buffer } = await buildPresentationPptx(
      parsePresentationOutlineBody({
        title: "Marks",
        slides: [
          {
            heading: "One",
            bullets: ["Line"],
            notes: "",
            shapes: [
              { id: "s1", kind: "text", x: 10, y: 10, w: 30, h: 12, text: "Owner mark survives" },
              { id: "s2", kind: "ellipse", x: 50, y: 40, w: 16, h: 20, text: "" },
            ],
          },
        ],
      }),
    );
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    const xml = (await Promise.all(slides.map((name) => zip.file(name)?.async("string") ?? Promise.resolve("")))).join(
      "",
    );
    expect(xml).toContain("Owner mark survives");
    expect(xml).toContain('prst="ellipse"');
  });
});

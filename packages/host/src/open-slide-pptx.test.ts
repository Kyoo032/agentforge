import { draftOpenSlideDeck, setOpenSlideBlockText } from "@agentforge/core/open-slide";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildOpenSlidePptx } from "./open-slide-pptx";

describe("buildOpenSlidePptx", () => {
  it("writes one slide per page and keeps an edited line", async () => {
    const drafted = draftOpenSlideDeck({ prompt: "Saturday pickup", pageCount: "short", locale: "en" });
    const page = drafted.pages[1];
    const block = page?.blocks.find((item) => item.kind === "text");
    expect(page && block).toBeTruthy();
    if (!page || !block) {
      return;
    }
    const deck = setOpenSlideBlockText(drafted, page.id, block.id, "A claim you can say aloud");
    const { buffer, filename } = await buildOpenSlidePptx(deck);
    expect(filename).toBe("Saturday-pickup.pptx");
    const zip = await JSZip.loadAsync(buffer);
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
    expect(slides).toHaveLength(deck.pages.length);
    const xml = await Promise.all(slides.map((name) => zip.file(name)?.async("string") ?? ""));
    expect(xml.join("\n")).toContain("A claim you can say aloud");
    const notes = Object.keys(zip.files).filter((name) => /ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
    expect(notes.length).toBeGreaterThan(0);
  });
});

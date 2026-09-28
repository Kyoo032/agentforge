import { describe, expect, it } from "vitest";
import type { OpenSlideDeck } from "./deck";
import { draftOpenSlideDeck } from "./draft";
import { applyOpenSlideSkills } from "./skills";

const COPY = {
  note: "Say this page once, then stop. Do not add a number you were not given.",
  noFigure: "No figure supplied",
};

function drafted(): OpenSlideDeck {
  return draftOpenSlideDeck({
    prompt: "Saturday pickup",
    pageCount: "short",
    density: "light",
    locale: "en",
  });
}

describe("applyOpenSlideSkills", () => {
  it("leaves a drafted short deck inside its bracket with notes", () => {
    const result = applyOpenSlideSkills(drafted(), { copy: COPY });
    expect(result.report).toEqual({ length: "kept", notesFilled: 0, sourceRewrites: 0, figuresCleared: 0 });
    expect(result.deck.pages).toHaveLength(4);
    expect(result.deck.pages.every((page) => page.notes.trim().length > 0)).toBe(true);
  });

  it("trims a long deck down to the short bracket and keeps the close", () => {
    const base = drafted();
    const extra: OpenSlideDeck["pages"] = [
      ...base.pages,
      ...base.pages.map((page, index) => ({ ...page, id: `x${index + 1}` })),
    ];
    const result = applyOpenSlideSkills({ ...base, pages: extra }, { copy: COPY });
    expect(result.report.length).toBe("trimmed");
    expect(result.deck.pages).toHaveLength(5);
    expect(result.deck.pages[result.deck.pages.length - 1]?.role).toBe("closing");
  });

  it("fills an empty speaker note", () => {
    const base = drafted();
    const pages = base.pages.map((page, index) => (index === 1 ? { ...page, notes: "  " } : page));
    const result = applyOpenSlideSkills({ ...base, pages }, { copy: COPY });
    expect(result.report.notesFilled).toBe(1);
    expect(result.deck.pages[1]?.notes).toBe(COPY.note);
  });

  it("rewrites a page from the handed material and drops an invented figure", () => {
    const base = drafted();
    const source = "The counter opens at seven on Saturday for named bags.";
    const pages = base.pages.map((page, index) =>
      index === 1
        ? {
            ...page,
            blocks: page.blocks.map((block, blockIndex) => (blockIndex === 2 ? { ...block, text: "94%" } : block)),
          }
        : page,
    );
    const result = applyOpenSlideSkills(
      { ...base, pages },
      { sourceText: source, prompt: "Saturday pickup", copy: COPY },
    );
    const text = result.deck.pages.flatMap((page) => page.blocks.map((block) => block.text)).join("\n");
    expect(text).toContain(source);
    expect(text).not.toMatch(/\d/);
    expect(result.report.sourceRewrites).toBeGreaterThan(0);
    expect(result.report.figuresCleared).toBeGreaterThan(0);
  });

  it("keeps a figure the source already stated", () => {
    const base = drafted();
    const source = "The counter packed 12 named bags on Saturday.";
    const pages = base.pages.map((page, index) =>
      index === 1
        ? {
            ...page,
            blocks: page.blocks.map((block, blockIndex) => (blockIndex === 2 ? { ...block, text: "12 bags" } : block)),
          }
        : page,
    );
    const result = applyOpenSlideSkills(
      { ...base, pages },
      { sourceText: source, prompt: "Saturday pickup", copy: COPY },
    );
    expect(result.deck.pages[1]?.blocks[2]?.text).toBe("12 bags");
    expect(result.report.figuresCleared).toBe(0);
  });
});

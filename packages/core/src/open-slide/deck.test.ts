import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  duplicateOpenSlideBlock,
  nudgeOpenSlideBlock,
  OPEN_SLIDE_CANVAS_HEIGHT,
  OPEN_SLIDE_CANVAS_WIDTH,
  parseOpenSlideModelText,
  removeOpenSlideBlock,
  setOpenSlideAccent,
  setOpenSlideBlockText,
} from "./deck";
import { draftOpenSlideDeck } from "./draft";
import { OPEN_SLIDE_SYSTEM } from "./harness";

describe("open slide harness", () => {
  it("keeps the upstream canvas rules and names no URL", () => {
    expect(OPEN_SLIDE_SYSTEM).toContain("1920");
    expect(OPEN_SLIDE_SYSTEM).toContain("1080");
    expect(OPEN_SLIDE_SYSTEM).not.toMatch(/https?:/);
    expect(OPEN_SLIDE_SYSTEM.toLowerCase()).not.toContain("svgl");
  });

  it("ships the MIT notice for the ported rules", () => {
    const notice = readFileSync(new URL("./THIRD-PARTY-NOTICES.md", import.meta.url), "utf8");
    expect(notice).toContain("Copyright (c) 2026 Yiwei Ho");
    expect(notice).toContain("Permission is hereby granted");
  });
});

describe("draftOpenSlideDeck", () => {
  it("builds a short English deck inside the canvas", () => {
    const deck = draftOpenSlideDeck({
      prompt: "Saturday pickup",
      pageCount: "short",
      density: "light",
      motion: "static",
      locale: "en",
    });
    expect(deck.engine).toBe("open-slide");
    expect(deck.pages).toHaveLength(4);
    expect(deck.pages[0]?.role).toBe("cover");
    expect(deck.meta.title).toBe("Saturday pickup");
    expect(deck.brief.aesthetic).toMatch(/Calm editorial/);
    expect(deck.pages[0]?.notes).toMatch(/Read the title/);
    for (const page of deck.pages) {
      expect(page.notes.trim().length).toBeGreaterThan(0);
      for (const block of page.blocks) {
        expect(block.x).toBeGreaterThanOrEqual(0);
        expect(block.y).toBeGreaterThanOrEqual(0);
        expect(block.x + block.w).toBeLessThanOrEqual(OPEN_SLIDE_CANVAS_WIDTH);
        expect(block.y + block.h).toBeLessThanOrEqual(OPEN_SLIDE_CANVAS_HEIGHT);
      }
    }
  });

  it("writes Indonesian copy when the locale is id", () => {
    const deck = draftOpenSlideDeck({ prompt: "Pengambilan Sabtu", pageCount: "standard", locale: "id" });
    expect(deck.pages).toHaveLength(6);
    expect(deck.brief.aesthetic).toMatch(/Editorial tenang/);
    expect(deck.pages[0]?.notes).toMatch(/Bacakan judulnya/);
    const joined = deck.pages.flatMap((page) => page.blocks.map((block) => block.text)).join(" ");
    expect(joined).toMatch(/halaman/);
    expect(joined).not.toMatch(/One idea on each page/);
  });

  it("uses eleven pages for a deep bracket", () => {
    const deck = draftOpenSlideDeck({ prompt: "Roadmap", pageCount: "deep", locale: "en" });
    expect(deck.pages).toHaveLength(11);
  });
});

describe("open slide edits", () => {
  const deck = draftOpenSlideDeck({ prompt: "Saturday pickup", pageCount: "short", locale: "en" });
  const page = deck.pages[1];
  const block = page?.blocks.find((item) => item.kind === "text");

  it("nudges, rewrites text, duplicates, and refuses to empty a page", () => {
    expect(page && block).toBeTruthy();
    if (!page || !block) {
      return;
    }
    const moved = nudgeOpenSlideBlock(deck, page.id, block.id, 8, 0);
    const next = moved.pages[1]?.blocks.find((item) => item.id === block.id);
    expect(next?.x).toBe(block.x + 8);
    const written = setOpenSlideBlockText(moved, page.id, block.id, "A claim you can say aloud");
    expect(written.pages[1]?.blocks.find((item) => item.id === block.id)?.text).toBe("A claim you can say aloud");
    const copied = duplicateOpenSlideBlock(written, page.id, block.id);
    expect(copied.pages[1]?.blocks.length).toBe((page.blocks.length ?? 0) + 1);
    let stripped = copied;
    const blocks = copied.pages[1]?.blocks ?? [];
    for (const item of blocks.slice(1)) {
      stripped = removeOpenSlideBlock(stripped, page.id, item.id);
    }
    expect(stripped.pages[1]?.blocks.length).toBe(1);
    const stuck = removeOpenSlideBlock(stripped, page.id, stripped.pages[1]?.blocks[0]?.id ?? "");
    expect(stuck.pages[1]?.blocks.length).toBe(1);
  });

  it("clamps a nudge that would leave the canvas", () => {
    expect(page && block).toBeTruthy();
    if (!page || !block) {
      return;
    }
    const shoved = nudgeOpenSlideBlock(deck, page.id, block.id, 9_999, 0);
    const next = shoved.pages[1]?.blocks.find((item) => item.id === block.id);
    expect(next && next.x + next.w).toBeLessThanOrEqual(OPEN_SLIDE_CANVAS_WIDTH);
  });

  it("updates the accent token", () => {
    const next = setOpenSlideAccent(deck, "#112233");
    expect(next.design.palette.accent).toBe("#112233");
    expect(setOpenSlideAccent(deck, "nope").design.palette.accent).toBe(deck.design.palette.accent);
  });
});

describe("parseOpenSlideModelText", () => {
  it("reads a fenced payload and drops a font URL", () => {
    const deck = draftOpenSlideDeck({ prompt: "Saturday pickup", pageCount: "short", locale: "en" });
    const poisoned = {
      ...deck,
      design: { ...deck.design, fonts: { display: "https://evil.example/font.css", body: deck.design.fonts.body } },
    };
    const parsed = parseOpenSlideModelText(`\`\`\`json\n${JSON.stringify(poisoned)}\n\`\`\``);
    expect(parsed.meta.title).toBe("Saturday pickup");
    expect(parsed.design.fonts.display).toBe("system-ui, sans-serif");
  });
});

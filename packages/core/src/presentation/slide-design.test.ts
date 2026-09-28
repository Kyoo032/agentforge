import { describe, expect, it } from "vitest";
import {
  SLIDE_DESIGN_LIMITS,
  SLIDE_LAYOUTS,
  assignSlideLayout,
  fitDesignPage,
  fitSlideText,
  inspectSlideDesign,
  slideCrowdReasons,
  type DesignText,
} from "./slide-design";

function page(partial: Partial<DesignText> & Pick<DesignText, "role" | "title">): DesignText {
  return {
    id: partial.id ?? "p1",
    index: partial.index ?? 0,
    role: partial.role,
    title: partial.title,
    lines: partial.lines ?? [],
  };
}

describe("assignSlideLayout", () => {
  it("uses only the closed set", () => {
    const roles = [
      "cover",
      "agenda",
      "section",
      "content",
      "big-number",
      "quote",
      "comparison",
      "closing",
      "bullets",
      "split",
      "close",
    ];
    for (const [index, role] of roles.entries()) {
      const layout = assignSlideLayout({ role, lines: index === 0 ? [] : ["One line."] }, index);
      expect(SLIDE_LAYOUTS).toContain(layout);
    }
    expect(assignSlideLayout({ role: "cover", lines: [] }, 0)).toBe("title");
    expect(assignSlideLayout({ role: "quote", lines: ["This desk"] }, 3)).toBe("quote");
    expect(assignSlideLayout({ role: "big-number", lines: ["No figure supplied"] }, 2)).toBe("figure");
    expect(assignSlideLayout({ role: "comparison", lines: ["Left", "Right"] }, 4)).toBe("split");
    expect(assignSlideLayout({ role: "content", lines: ["a", "b", "c"] }, 1)).toBe("split");
    expect(assignSlideLayout({ role: "closing", lines: ["Ask for a yes."] }, 3)).toBe("section");
  });
});

describe("slideCrowdReasons", () => {
  it("rejects too many bullets", () => {
    const reasons = slideCrowdReasons(
      { title: "Named bags", lines: ["One.", "Two.", "Three.", "Four.", "Five.", "Six."] },
      "split",
    );
    expect(reasons).toContain("too_many_bullets");
  });

  it("rejects a title that does not fit", () => {
    const title = "Saturday pickup for every named bag on the counter";
    expect(title.length).toBeGreaterThan(SLIDE_DESIGN_LIMITS.titleChars);
    const reasons = slideCrowdReasons({ title, lines: ["One idea on this page."] }, "title");
    expect(reasons).toContain("title_overflow");
    expect(reasons).not.toContain("too_many_bullets");
  });

  it("rejects a wall of text", () => {
    const wall = "The counter ".repeat(30).trim();
    expect(wall.length).toBeGreaterThan(SLIDE_DESIGN_LIMITS.wallChars);
    const reasons = slideCrowdReasons({ title: "Named bags", lines: [wall] }, "split");
    expect(reasons).toContain("wall_of_text");
  });

  it("accepts a short title page", () => {
    expect(slideCrowdReasons({ title: "Saturday pickup", lines: ["One idea.", "Drafted here."] }, "title")).toEqual([]);
  });
});

describe("fitSlideText", () => {
  it("shortens a title without changing a figure", () => {
    const original = "Paid 12 bags on Saturday at the counter for the named order today";
    const fitted = fitSlideText(original, SLIDE_DESIGN_LIMITS.titleChars, SLIDE_DESIGN_LIMITS.titleWords);
    expect(fitted.length).toBeLessThanOrEqual(SLIDE_DESIGN_LIMITS.titleChars + 1);
    expect(fitted).toContain("12");
    expect(fitted).not.toMatch(/\d{3,}/);
    const runs = fitted.match(/\d+/g) ?? [];
    for (const run of runs) {
      expect(original).toContain(run);
    }
  });

  it("drops a digit word it cannot keep whole", () => {
    const fitted = fitSlideText("123456789012345678901234567890123456789012345", 10, 8);
    expect(fitted).not.toMatch(/\d/);
  });
});

describe("inspectSlideDesign", () => {
  it("names only the failing pages", () => {
    const pages = [
      page({ id: "cover", index: 0, role: "cover", title: "Saturday pickup", lines: ["One idea."] }),
      page({
        id: "crowd",
        index: 1,
        role: "content",
        title: "Named bags",
        lines: ["1", "2", "3", "4", "5", "6"],
      }),
    ];
    const failures = inspectSlideDesign(pages);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ id: "crowd", reasons: ["too_many_bullets"] });
  });

  it("repairs a crowded page without adding a line or a figure", () => {
    const original = page({
      id: "crowd",
      index: 1,
      role: "content",
      title: "Named bags are on the counter this Saturday morning for pickup",
      lines: ["The counter packed 12 bags.", "Two.", "Three.", "Four.", "Five.", "Six extra."],
    });
    const fitted = fitDesignPage(original, "split");
    expect(fitted.lines.length).toBeLessThanOrEqual(SLIDE_DESIGN_LIMITS.supporting.split);
    expect(fitted.lines.join(" ")).toContain("12");
    expect(fitted.title.length).toBeLessThanOrEqual(SLIDE_DESIGN_LIMITS.headingChars + 1);
    const digits = `${fitted.title} ${fitted.lines.join(" ")}`.match(/\d+/g) ?? [];
    expect(digits).toEqual(["12"]);
  });
});

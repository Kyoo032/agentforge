import { describe, expect, it } from "vitest";
import { titleFromParts } from "./thread-title";

describe("titleFromParts", () => {
  it("uses the first text part", () => {
    expect(titleFromParts([{ type: "text", text: "Map the meeting note" }])).toBe("Map the meeting note");
  });

  it("collapses whitespace and trims", () => {
    expect(titleFromParts("  two   lines\nhere  ")).toBe("two lines here");
  });

  it("caps long titles", () => {
    const title = titleFromParts("A".repeat(60));
    expect(title).toHaveLength(48);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("returns null when there is no text", () => {
    expect(titleFromParts([{ type: "image_url", image_url: { url: "/x.png" } }])).toBeNull();
  });
});

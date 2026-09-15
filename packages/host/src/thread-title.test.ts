import { describe, expect, it } from "vitest";
import {
  DEFAULT_THREAD_TITLE,
  DEFAULT_THREAD_TITLES,
  defaultThreadTitle,
  isDefaultThreadTitle,
  titleFromParts,
} from "./thread-title";

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

describe("defaultThreadTitle", () => {
  it("has both locales and keeps the exported English constant", () => {
    expect(defaultThreadTitle("en")).toBe("New thread");
    expect(defaultThreadTitle("id")).toBe("Percakapan baru");
    expect(DEFAULT_THREAD_TITLE).toBe("New thread");
    expect(defaultThreadTitle("de" as never)).toBe("New thread");
  });

  it("recognizes an untouched thread in either locale", () => {
    expect(isDefaultThreadTitle("New thread")).toBe(true);
    expect(isDefaultThreadTitle("Percakapan baru")).toBe(true);
    expect(isDefaultThreadTitle("Map the meeting note")).toBe(false);
    expect([...DEFAULT_THREAD_TITLES].sort()).toEqual(["New thread", "Percakapan baru"]);
  });
});

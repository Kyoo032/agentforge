import { describe, expect, it } from "vitest";
import { markdownPlainText, parseMarkdown, safeHref } from "./parse-markdown";

describe("parseMarkdown", () => {
  it("turns bold list items into structured blocks", () => {
    const blocks = parseMarkdown(
      "I can help with:\n- **Questions and writing:** draft and edit\n- **Research:** search the web",
    );
    expect(blocks[0]).toMatchObject({ type: "p" });
    expect(blocks[1]).toMatchObject({ type: "ul" });
    if (blocks[1]?.type !== "ul") {
      return;
    }
    expect(blocks[1].items[0]?.[0]).toMatchObject({ type: "strong" });
    expect(markdownPlainText("I can help with:\n- **Questions:** draft")).toContain("Questions");
    expect(markdownPlainText("I can help with:\n- **Questions:** draft")).not.toContain("**");
  });

  it("keeps fenced code raw and drops javascript links", () => {
    const blocks = parseMarkdown("```\n**not bold**\n```\n[x](javascript:alert(1))");
    expect(blocks[0]).toEqual({ type: "pre", value: "**not bold**" });
    expect(blocks[1]).toMatchObject({ type: "p" });
    if (blocks[1]?.type !== "p") {
      return;
    }
    expect(blocks[1].children.some((node) => node.type === "link")).toBe(false);
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://example.com")).toBe("https://example.com");
  });

  it("parses images and headings", () => {
    const blocks = parseMarkdown("## Title\n\n![cat](https://example.com/cat.png)");
    expect(blocks[0]).toMatchObject({ type: "h", level: 2 });
    expect(blocks[1]).toMatchObject({ type: "p" });
    if (blocks[1]?.type !== "p") {
      return;
    }
    expect(blocks[1].children[0]).toMatchObject({ type: "image", alt: "cat" });
  });
});
